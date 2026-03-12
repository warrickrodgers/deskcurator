/**
 * Gemini AI Provider
 * Implementation using Google's Generative AI SDK
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIModelConfig,
  AIMessage,
  AIServiceError,
  AIErrorType,
  RateLimitType,
  RateLimitStatus,
  StreamCallback,
  IAIProvider,
} from '../types/ai.types';

export class GeminiProvider implements IAIProvider {
  public readonly provider = AIProvider.GEMINI;
  public readonly modelConfig: AIModelConfig;
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;

  constructor(config: { apiKey: string; model?: string }) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.modelConfig = {
      provider: AIProvider.GEMINI,
      model: config.model || 'gemini-2.5-flash-lite',
    };
    this.model = this.client.getGenerativeModel({ model: this.modelConfig.model });
  }

  async generateCompletion(request: AICompletionRequest): Promise<AICompletionResponse> {
    try {
      const prompt = this.formatMessages(request.messages);

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: request.config?.maxTokens,
          temperature: request.config?.temperature,
        },
      });

      const response = result.response;
      const text = response.text();

      const usage = response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        : undefined;

      return {
        content: text,
        provider: AIProvider.GEMINI,
        model: this.modelConfig.model,
        usage,
        finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason?.toString()),
        timestamp: new Date(),
      };
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  async generateStreamingCompletion(
    request: AICompletionRequest,
    callback: StreamCallback
  ): Promise<AICompletionResponse> {
    try {
      const prompt = this.formatMessages(request.messages);

      const result = await this.model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: request.config?.maxTokens,
          temperature: request.config?.temperature,
        },
      });

      let fullText = '';

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        callback({ content: chunkText, isComplete: false });
      }

      const response = await result.response;
      const usage = response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        : undefined;

      callback({ content: '', isComplete: true, usage });

      return {
        content: fullText,
        provider: AIProvider.GEMINI,
        model: this.modelConfig.model,
        usage,
        finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason?.toString()),
        timestamp: new Date(),
      };
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  async checkRateLimit(): Promise<RateLimitStatus> {
    return {
      requestsRemaining: 60,
      resetTime: new Date(Date.now() + 60000),
      isLimited: false,
    };
  }

  estimateTokenCount(messages: AIMessage[]): number {
    const text = messages.map((m) => m.content).join(' ');
    return Math.ceil(text.length / 4);
  }

  private formatMessages(messages: AIMessage[]): string {
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

  private mapFinishReason(
    reason?: string
  ): 'stop' | 'length' | 'content_filter' | 'error' | undefined {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default:
        return undefined;
    }
  }

  /**
   * Parse the Gemini API-recommended retry delay from a 429 error message.
   * Looks for "Please retry in 25.83s" or a JSON "retryDelay":"25s" field.
   * Returns milliseconds, or undefined if not found.
   */
  private parseRetryAfterMs(message: string): number | undefined {
    const textMatch = message.match(/[Pp]lease retry in (\d+\.?\d*)s/);
    if (textMatch) {
      return Math.ceil(parseFloat(textMatch[1]) * 1000);
    }
    const jsonMatch = message.match(/"retryDelay"\s*:\s*"(\d+\.?\d*)s"/);
    if (jsonMatch) {
      return Math.ceil(parseFloat(jsonMatch[1]) * 1000);
    }
    return undefined;
  }

  /** Returns milliseconds until the next UTC midnight. */
  private msUntilMidnight(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }

  /**
   * Classifies a 429 error as TPM (tokens-per-minute) or RPD (requests-per-day).
   * RPD indicators: quota metric contains "per_day", or the API-specified retryDelay > 1 hour.
   */
  private classifyRateLimit(message: string): { rateLimitType: RateLimitType; retryAfterMs?: number } {
    const retryAfterMs = this.parseRetryAfterMs(message);

    const isRpd =
      message.includes('per_day') ||
      message.includes('requests_per_day') ||
      message.includes('DAILY') ||
      // A retryDelay over 1 hour is a strong signal that this is a daily quota reset
      (retryAfterMs !== undefined && retryAfterMs > 3_600_000);

    if (isRpd) {
      return { rateLimitType: RateLimitType.RPD, retryAfterMs: retryAfterMs ?? this.msUntilMidnight() };
    }

    return { rateLimitType: RateLimitType.TPM, retryAfterMs };
  }

  private handleError(error: any): AIServiceError {
    const message = error.message || 'Unknown error occurred';
    const statusCode = error.status ?? error.statusCode;

    // 503 Service Unavailable — transient overload, retry after 30 minutes
    if (statusCode === 503 || message.includes('Service Unavailable') || message.includes('503')) {
      return new AIServiceError(
        `Service unavailable (high demand): ${message}`,
        AIErrorType.SERVICE_UNAVAILABLE,
        AIProvider.GEMINI,
        503,
        30 * 60 * 1000, // 30 minutes
      );
    }

    if (statusCode === 429 || (statusCode !== 403 && (message.includes('rate limit') || message.includes('RESOURCE_EXHAUSTED')))) {
      const { rateLimitType, retryAfterMs } = this.classifyRateLimit(message);
      return new AIServiceError(
        `Rate limit exceeded (${rateLimitType.toUpperCase()}): ${message}`,
        AIErrorType.RATE_LIMIT,
        AIProvider.GEMINI,
        429,
        retryAfterMs,
        undefined,
        rateLimitType,
      );
    }
    if (statusCode === 403 || message.includes('quota') || message.includes('permission') || message.includes('not found') || message.includes('does not exist')) {
      return new AIServiceError(
        `Model access error (check model name/API tier): ${message}`,
        AIErrorType.INVALID_REQUEST,
        AIProvider.GEMINI,
        statusCode ?? 403
      );
    }
    if (message.includes('API key') || message.includes('authentication') || statusCode === 401) {
      return new AIServiceError(
        `Invalid API key: ${message}`,
        AIErrorType.AUTHENTICATION,
        AIProvider.GEMINI,
        401
      );
    }
    if (message.includes('safety') || message.includes('blocked')) {
      return new AIServiceError(
        'Content blocked by safety filters',
        AIErrorType.CONTENT_FILTER,
        AIProvider.GEMINI,
        400
      );
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return new AIServiceError(
        'Network error - unable to reach Gemini API',
        AIErrorType.NETWORK_ERROR,
        AIProvider.GEMINI
      );
    }

    return new AIServiceError(message, AIErrorType.UNKNOWN, AIProvider.GEMINI, statusCode);
  }
}
