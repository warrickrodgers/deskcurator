/**
 * Anthropic AI Provider
 * Implementation for Claude API (to be completed when API key is available)
 */

import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIServiceConfig,
  AIServiceError,
} from '../types/ai.types';

export class AnthropicProvider implements AIProvider {
  public readonly name = 'anthropic';
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
    // TODO: Initialize Anthropic SDK when available
    // this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    // TODO: Implement Anthropic API call
    // Example structure:
    // const response = await this.client.messages.create({
    //   model: this.config.model || 'claude-sonnet-4-20250514',
    //   max_tokens: request.maxTokens || 4096,
    //   temperature: request.temperature || 0.7,
    //   messages: request.messages,
    // });

    throw new AIServiceError(
      'Anthropic provider not yet implemented',
      'NOT_IMPLEMENTED',
      501,
      false
    );
  }

  async streamComplete(
    request: AICompletionRequest,
    onChunk: (chunk: AIStreamChunk) => void
  ): Promise<void> {
    // TODO: Implement streaming for Anthropic
    // const stream = await this.client.messages.stream({
    //   model: this.config.model || 'claude-sonnet-4-20250514',
    //   max_tokens: request.maxTokens || 4096,
    //   temperature: request.temperature || 0.7,
    //   messages: request.messages,
    // });
    //
    // for await (const chunk of stream) {
    //   if (chunk.type === 'content_block_delta') {
    //     onChunk({
    //       content: chunk.delta.text,
    //       isComplete: false,
    //     });
    //   }
    // }

    throw new AIServiceError(
      'Anthropic provider not yet implemented',
      'NOT_IMPLEMENTED',
      501,
      false
    );
  }
}