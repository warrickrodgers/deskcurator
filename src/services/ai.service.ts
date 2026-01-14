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
} from '../types/ai.types';
import { config } from '../config';
import { GeminiProvider } from './gemini.provider';
import { AnthropicProvider } from './anthropic.provider';
import { RateLimiter } from '../utils/rateLimiter';
import { retryWithBackoff } from '../utils/retry';

export class AIService {
  private provider: AIProvider;
  private rateLimiter: RateLimiter;
  private tokenUsage: TokenUsageTracker;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor() {
    // Initialize provider based on config
    const providerConfig =
      config.ai.provider === 'anthropic'
        ? config.ai.anthropic
        : config.ai.gemini;

    this.provider = this.createProvider(config.ai.provider, providerConfig);
    this.rateLimiter = new RateLimiter(providerConfig.rateLimitPerMinute);
    this.maxRetries = providerConfig.maxRetries;
    this.retryDelay = providerConfig.retryDelay;

    // Initialize token usage tracker
    this.tokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastReset: new Date(),
    };
  }

  private createProvider(
    providerName: string,
    providerConfig: any
  ): AIProvider {
    switch (providerName) {
      case 'anthropic':
        return new AnthropicProvider(providerConfig);
      case 'gemini':
        return new GeminiProvider(providerConfig);
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  /**
   * Complete a chat request with automatic rate limiting and retries
   */
  async complete(
    request: AICompletionRequest
  ): Promise<AICompletionResponse> {
    // Apply rate limiting
    await this.rateLimiter.acquire();

    // Execute with retry logic
    const response = await retryWithBackoff(
      () => this.provider.complete(request),
      {
        maxRetries: this.maxRetries,
        baseDelay: this.retryDelay,
      }
    );

    // Track token usage
    this.updateTokenUsage(response.usage);

    return response;
  }

  /**
   * Stream a chat completion with automatic rate limiting
   */
  async streamComplete(
    request: AICompletionRequest,
    onChunk: (chunk: AIStreamChunk) => void
  ): Promise<void> {
    // Apply rate limiting
    await this.rateLimiter.acquire();

    // Execute with retry logic
    await retryWithBackoff(
      () => this.provider.streamComplete(request, (chunk) => {
        // Track usage from final chunk
        if (chunk.isComplete && chunk.usage) {
          this.updateTokenUsage(chunk.usage);
        }
        onChunk(chunk);
      }),
      {
        maxRetries: this.maxRetries,
        baseDelay: this.retryDelay,
      }
    );
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
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: 'system' as const, content: systemPrompt });
    }

    messages.push({ role: 'user' as const, content: prompt });

    if (options?.stream) {
      let fullResponse = '';
      
      await this.streamComplete(
        {
          messages,
          maxTokens: options.maxTokens || config.defaults.maxTokens,
          temperature: options.temperature || config.defaults.temperature,
          stream: true,
        },
        (chunk) => {
          if (!chunk.isComplete) {
            fullResponse += chunk.content;
          }
        }
      );

      return fullResponse;
    } else {
      const response = await this.complete({
        messages,
        maxTokens: options?.maxTokens || config.defaults.maxTokens,
        temperature: options?.temperature || config.defaults.temperature,
      });

      return response.content;
    }
  }

  /**
   * Get current token usage statistics
   */
  getTokenUsage(): TokenUsageTracker {
    return { ...this.tokenUsage };
  }

  /**
   * Reset token usage statistics
   */
  resetTokenUsage(): void {
    this.tokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastReset: new Date(),
    };
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
  getProviderInfo(): { name: string; model: string } {
    const providerConfig =
      config.ai.provider === 'anthropic'
        ? config.ai.anthropic
        : config.ai.gemini;

    return {
      name: this.provider.name,
      model: providerConfig.model,
    };
  }

  private updateTokenUsage(usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): void {
    if (usage) {
      this.tokenUsage.promptTokens += usage.promptTokens;
      this.tokenUsage.completionTokens += usage.completionTokens;
      this.tokenUsage.totalTokens += usage.totalTokens;
    }
    this.tokenUsage.requestCount += 1;
  }
}

// Export singleton instance
export const aiService = new AIService();