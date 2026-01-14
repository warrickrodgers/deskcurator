/**
 * Gemini AI Provider
 * Implementation using Google's Generative AI SDK
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIStreamChunk,
  AIServiceConfig,
  AIServiceError,
} from '../types/ai.types';

export class GeminiProvider implements AIProvider {
  public readonly name = 'gemini';
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = this.client.getGenerativeModel({
      model: config.model || 'gemini-2.0-flash-exp',
    });
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    try {
      // Convert messages to Gemini format
      const prompt = this.formatMessages(request.messages);

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
        },
      });

      const response = result.response;
      const text = response.text();

      // Extract usage information if available
      const usage = response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        : undefined;

      return {
        content: text,
        usage,
        model: this.config.model,
        finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
      };
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  async streamComplete(
    request: AICompletionRequest,
    onChunk: (chunk: AIStreamChunk) => void
  ): Promise<void> {
    try {
      const prompt = this.formatMessages(request.messages);

      const result = await this.model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
        },
      });

      let accumulatedText = '';

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        accumulatedText += chunkText;

        onChunk({
          content: chunkText,
          isComplete: false,
        });
      }

      // Send final chunk with usage info
      const response = await result.response;
      const usage = response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        : undefined;

      onChunk({
        content: '',
        isComplete: true,
        usage,
      });
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  private formatMessages(messages: AICompletionRequest['messages']): string {
    // Gemini's generateContent API is simpler - we'll format messages as a prompt
    // System messages become part of the instruction, user/assistant alternate
    return messages
      .map((msg) => {
        switch (msg.role) {
          case 'system':
            return `[System Instructions]: ${msg.content}`;
          case 'user':
            return `User: ${msg.content}`;
          case 'assistant':
            return `Assistant: ${msg.content}`;
          default:
            return msg.content;
        }
      })
      .join('\n\n');
  }

  private mapFinishReason(reason?: string): string {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'unknown';
    }
  }

  private handleError(error: any): AIServiceError {
    // Handle Gemini-specific errors
    const message = error.message || 'Unknown error occurred';
    
    // Rate limit errors
    if (message.includes('quota') || message.includes('rate limit')) {
      return new AIServiceError(
        'Rate limit exceeded',
        'RATE_LIMIT_EXCEEDED',
        429,
        true
      );
    }

    // Invalid API key
    if (message.includes('API key') || message.includes('authentication')) {
      return new AIServiceError(
        'Invalid API key',
        'INVALID_API_KEY',
        401,
        false
      );
    }

    // Content filter
    if (message.includes('safety') || message.includes('blocked')) {
      return new AIServiceError(
        'Content blocked by safety filters',
        'CONTENT_FILTERED',
        400,
        false
      );
    }

    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return new AIServiceError(
        'Network error - unable to reach Gemini API',
        'NETWORK_ERROR',
        undefined,
        true
      );
    }

    // Default error
    return new AIServiceError(
      message,
      'UNKNOWN_ERROR',
      error.statusCode,
      false
    );
  }
}