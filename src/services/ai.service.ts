/**
 * AI Service
 * Main service that orchestrates AI provider calls with rate limiting,
 * retry logic, and token usage tracking
 */

import {
  AIProvider,
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
import { logger } from '../utils/logger';

export class AIService {
  private provider: IAIProvider;
  private rateLimiter: RateLimiter;
  private tokenTracker: TokenUsageTracker;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor() {
    // Initialize provider based on config
    const providerType = config.ai.provider;
    const providerConfig =
      providerType === 'anthropic'
        ? config.ai.anthropic
        : config.ai.gemini;

    this.provider = this.createProvider(providerType, providerConfig);
    this.rateLimiter = new RateLimiter(providerConfig.rateLimitPerMinute);
    this.maxRetries = providerConfig.maxRetries;
    this.retryDelay = providerConfig.retryDelay;

    // Initialize token usage tracker
    this.tokenTracker = new TokenUsageTracker();

    logger.info(`AIService initialized with provider: ${providerType}`);
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
          'INVALID_REQUEST' as any,
          AIProvider.GEMINI // Default fallback
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

// Export singleton instance
export const aiService = new AIService();