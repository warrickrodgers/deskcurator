/**
 * AI Service
 * Main service that orchestrates AI provider calls with rate limiting,
 * retry logic, and token usage tracking
 */

import {
  AIProvider,
  AIErrorType,
  RateLimitType,
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIServiceError,
  TokenUsageTracker,
  IAIProvider,
  MessageRole,
  AIMessage,
} from '../types/ai.types';
import { config } from '../config';
import { GeminiProvider } from './gemini.provider';
import { AnthropicProvider } from './anthropic.provider';
import { RateLimiter } from '../utils/rateLimiter';
import { retryWithBackoff } from '../utils/retry';
import logger from '../utils/logger';
import discordService from './discord';

export class AIService {
  private provider: IAIProvider;
  private rateLimiter: RateLimiter;
  private tokenTracker: TokenUsageTracker;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  private async notifyRateLimit(waitMs: number, attempt: number, error?: any): Promise<void> {
    let msg: string;

    if (error instanceof AIServiceError && error.type === AIErrorType.SERVICE_UNAVAILABLE) {
      const waitMin = Math.round(waitMs / 60_000);
      msg = `🔴 **Gemini 503** (service unavailable, attempt ${attempt}/${this.maxRetries + 1}) — waiting **${waitMin}m** before retry.`;
    } else if (error instanceof AIServiceError && error.rateLimitType === RateLimitType.RPD) {
      const retryAt = new Date(Date.now() + waitMs);
      msg = `🚫 **Gemini daily quota hit** — job will be rescheduled after **${retryAt.toUTCString()}**.`;
    } else {
      const waitSec = (waitMs / 1000).toFixed(0);
      msg = `⏳ **Gemini rate limit hit** (attempt ${attempt}/${this.maxRetries + 1}) — waiting **${waitSec}s** before retry.`;
    }

    try {
      await discordService.sendNotification(msg, config.discord.writerChannelId);
    } catch {
      // Discord unavailable — already logged by the service; don't block the retry
    }
  }

  constructor(modelOverride?: string) {
    // Initialize provider based on config
    const providerType = config.ai.provider;
    const providerConfig =
      providerType === 'anthropic'
        ? config.ai.anthropic
        : config.ai.gemini;

    const effectiveConfig = modelOverride
      ? { ...providerConfig, model: modelOverride }
      : providerConfig;

    this.provider = this.createProvider(providerType, effectiveConfig);
    this.rateLimiter = new RateLimiter(providerConfig.rateLimitPerMinute);
    this.maxRetries = providerConfig.maxRetries;
    this.retryDelay = providerConfig.retryDelay;

    // Initialize token usage tracker
    this.tokenTracker = new TokenUsageTracker();

    logger.info(`AIService initialized with provider: ${providerType}, model: ${effectiveConfig.model}`);
  }

  private createProvider(
    providerType: string,
    providerConfig: any
  ): IAIProvider {
    switch (providerType) {
      case 'anthropic':
        return new AnthropicProvider(providerConfig);
      case 'gemini':
        return new GeminiProvider(providerConfig);
      default:
        throw new AIServiceError(
          `Unknown provider: ${providerType}`,
          AIErrorType.INVALID_REQUEST,
          AIProvider.GEMINI
        );
    }
  }

  /**
   * Complete a chat request with automatic rate limiting and retries
   */
  async complete(
    request: AICompletionRequest
  ): Promise<AICompletionResponse> {
    try {
      // Apply rate limiting
      await this.rateLimiter.acquire();

      // Execute with retry logic
      const response = await retryWithBackoff(
        () => this.provider.generateCompletion(request),
        {
          maxRetries: this.maxRetries,
          baseDelay: this.retryDelay,
          onWait: (waitMs, attempt, error) => this.notifyRateLimit(waitMs, attempt, error),
        }
      );

      // Track token usage
      if (response.usage) {
        this.tokenTracker.track(this.provider.provider, response.usage);
      }

      logger.debug('Completion successful', {
        provider: response.provider,
        tokens: response.usage?.totalTokens,
      });

      return response;
    } catch (error) {
      logger.error('Completion failed', { error });
      throw error;
    }
  }

  /**
   * Stream a chat completion with automatic rate limiting
   */
  async streamComplete(
    request: AICompletionRequest,
    onChunk: (chunk: AIStreamChunk) => void
  ): Promise<AICompletionResponse> {
    try {
      // Apply rate limiting
      await this.rateLimiter.acquire();

      // Ensure stream flag is set
      const streamRequest = { ...request, stream: true };

      // Execute with retry logic
      const response = await retryWithBackoff(
        () => this.provider.generateStreamingCompletion(streamRequest, (chunk) => {
          // Track usage from final chunk
          if (chunk.isComplete && chunk.usage) {
            this.tokenTracker.track(this.provider.provider, chunk.usage);
          }
          onChunk(chunk);
        }),
        {
          maxRetries: this.maxRetries,
          baseDelay: this.retryDelay,
          onWait: (waitMs, attempt, error) => this.notifyRateLimit(waitMs, attempt, error),
        }
      );

      logger.debug('Streaming completion successful', {
        provider: response.provider,
        tokens: response.usage?.totalTokens,
      });

      return response;
    } catch (error) {
      logger.error('Streaming completion failed', { error });
      throw error;
    }
  }

  /**
   * Simple helper for single-turn completions
   */
  async ask(
    prompt: string,
    systemPrompt?: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      stream?: boolean;
    }
  ): Promise<string> {
    const messages: AIMessage[] = [];

    if (systemPrompt) {
      messages.push({ 
        role: MessageRole.SYSTEM, 
        content: systemPrompt 
      });
    }

    messages.push({ 
      role: MessageRole.USER, 
      content: prompt 
    });

    const request: AICompletionRequest = {
      messages,
      config: {
        provider: this.provider.provider,
        model: this.provider.modelConfig.model,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      },
      stream: options?.stream || false,
    };

    if (options?.stream) {
      let fullResponse = '';
      
      await this.streamComplete(
        request,
        (chunk) => {
          if (!chunk.isComplete) {
            fullResponse += chunk.content;
          }
        }
      );

      return fullResponse;
    } else {
      const response = await this.complete(request);
      return response.content;
    }
  }

  /**
   * Get current token usage statistics
   */
  getTokenUsage(): TokenUsageTracker {
    return this.tokenTracker;
  }

  /**
   * Get usage for specific provider
   */
  getProviderUsage(provider: AIProvider) {
    return this.tokenTracker.getUsage(provider);
  }

  /**
   * Get total usage across all providers
   */
  getTotalUsage() {
    return this.tokenTracker.getTotalUsage();
  }

  /**
   * Get usage summary
   */
  getUsageSummary() {
    return this.tokenTracker.getSummary();
  }

  /**
   * Reset token usage statistics
   */
  resetTokenUsage(): void {
    this.tokenTracker.reset();
    logger.info('Token usage statistics reset');
  }

  /**
   * Get available rate limit tokens
   */
  getAvailableRequests(): number {
    return this.rateLimiter.getAvailableTokens();
  }

  /**
   * Get provider information
   */
  getProviderInfo(): { 
    name: string; 
    provider: AIProvider;
    model: string;
  } {
    return {
      name: this.provider.provider,
      provider: this.provider.provider,
      model: this.provider.modelConfig.model,
    };
  }

  /**
   * Estimate token count for messages
   */
  estimateTokenCount(messages: AIMessage[]): number {
    return this.provider.estimateTokenCount(messages);
  }

  /**
   * Check rate limit status
   */
  async checkRateLimit() {
    return this.provider.checkRateLimit();
  }
}

// Researcher instance — lightweight model for structured data extraction
export const aiService = new AIService();

// Writer instance — more capable model for full article generation
export const writerAiService = new AIService(config.ai.gemini.writerModel);