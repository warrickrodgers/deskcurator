/**
 * Anthropic AI Provider
 * Stub implementation — not yet wired up. Gemini is the active provider.
 */

import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIModelConfig,
  AIMessage,
  AIServiceError,
  AIErrorType,
  RateLimitStatus,
  StreamCallback,
  IAIProvider,
} from '../types/ai.types';

export class AnthropicProvider implements IAIProvider {
  public readonly provider = AIProvider.ANTHROPIC;
  public readonly modelConfig: AIModelConfig;

  constructor(config: { apiKey: string; model?: string }) {
    this.modelConfig = {
      provider: AIProvider.ANTHROPIC,
      model: config.model || 'claude-sonnet-4-20250514',
    };
  }

  async generateCompletion(_request: AICompletionRequest): Promise<AICompletionResponse> {
    throw new AIServiceError(
      'Anthropic provider not yet implemented',
      AIErrorType.INVALID_REQUEST,
      AIProvider.ANTHROPIC,
      501
    );
  }

  async generateStreamingCompletion(
    _request: AICompletionRequest,
    _callback: StreamCallback
  ): Promise<AICompletionResponse> {
    throw new AIServiceError(
      'Anthropic provider not yet implemented',
      AIErrorType.INVALID_REQUEST,
      AIProvider.ANTHROPIC,
      501
    );
  }

  async checkRateLimit(): Promise<RateLimitStatus> {
    return {
      requestsRemaining: 0,
      resetTime: new Date(),
      isLimited: true,
    };
  }

  estimateTokenCount(messages: AIMessage[]): number {
    const text = messages.map((m) => m.content).join(' ');
    return Math.ceil(text.length / 4);
  }
}
