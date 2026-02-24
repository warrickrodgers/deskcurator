/**
 * AI Service Types
 * 
 * Core type definitions for the AI service layer supporting multiple providers
 * (Gemini, Anthropic) with unified interfaces for messages, responses, and configurations.
 */

/**
 * Supported AI providers
 */
export enum AIProvider {
  GEMINI = 'gemini',
  ANTHROPIC = 'anthropic'
}

/**
 * Message roles in a conversation
 */
export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system'
}

/**
 * Base message structure for AI conversations
 */
export interface AIMessage {
  role: MessageRole;
  content: string;
  timestamp?: Date;
}

/**
 * AI model configuration options
 */
export interface AIModelConfig {
  provider: AIProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

/**
 * Token usage tracking
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}

/**
 * Token usage tracker class for managing token consumption across requests
 */
export class TokenUsageTracker {
  private usage: Map<AIProvider, TokenUsage>;
  private requestCount: Map<AIProvider, number>;
  private startTime: Date;

  constructor() {
    this.usage = new Map();
    this.requestCount = new Map();
    this.startTime = new Date();
    
    // Initialize for all providers
    Object.values(AIProvider).forEach(provider => {
      this.usage.set(provider, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0
      });
      this.requestCount.set(provider, 0);
    });
  }

  /**
   * Track token usage for a request
   */
  track(provider: AIProvider, usage: TokenUsage): void {
    const current = this.usage.get(provider)!;
    
    this.usage.set(provider, {
      promptTokens: current.promptTokens + usage.promptTokens,
      completionTokens: current.completionTokens + usage.completionTokens,
      totalTokens: current.totalTokens + usage.totalTokens,
      estimatedCost: (current.estimatedCost || 0) + (usage.estimatedCost || 0)
    });
    
    this.requestCount.set(provider, (this.requestCount.get(provider) || 0) + 1);
  }

  /**
   * Get usage for a specific provider
   */
  getUsage(provider: AIProvider): TokenUsage {
    return { ...this.usage.get(provider)! };
  }

  /**
   * Get total usage across all providers
   */
  getTotalUsage(): TokenUsage {
    let total: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCost: 0
    };

    this.usage.forEach(usage => {
      total.promptTokens += usage.promptTokens;
      total.completionTokens += usage.completionTokens;
      total.totalTokens += usage.totalTokens;
      total.estimatedCost = (total.estimatedCost || 0) + (usage.estimatedCost || 0);
    });

    return total;
  }

  /**
   * Get request count for a provider
   */
  getRequestCount(provider: AIProvider): number {
    return this.requestCount.get(provider) || 0;
  }

  /**
   * Get total request count across all providers
   */
  getTotalRequestCount(): number {
    let total = 0;
    this.requestCount.forEach(count => total += count);
    return total;
  }

  /**
   * Get tracker uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Reset all tracking data
   */
  reset(): void {
    this.usage.clear();
    this.requestCount.clear();
    this.startTime = new Date();
    
    // Re-initialize for all providers
    Object.values(AIProvider).forEach(provider => {
      this.usage.set(provider, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0
      });
      this.requestCount.set(provider, 0);
    });
  }

  /**
   * Get a summary report of all usage
   */
  getSummary(): {
    totalUsage: TokenUsage;
    byProvider: Record<string, TokenUsage & { requests: number }>;
    uptime: number;
    totalRequests: number;
  } {
    const byProvider: Record<string, TokenUsage & { requests: number }> = {};
    
    Object.values(AIProvider).forEach(provider => {
      const usage = this.getUsage(provider);
      byProvider[provider] = {
        ...usage,
        requests: this.getRequestCount(provider)
      };
    });

    return {
      totalUsage: this.getTotalUsage(),
      byProvider,
      uptime: this.getUptime(),
      totalRequests: this.getTotalRequestCount()
    };
  }
}

/**
 * AI completion request structure
 */
export interface AICompletionRequest {
  messages: AIMessage[];
  config?: Partial<AIModelConfig>;
  stream?: boolean;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * AI completion response structure
 */
export interface AICompletionResponse {
  content: string;
  provider: AIProvider;
  model: string;
  usage?: TokenUsage;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
  timestamp: Date;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * AI response structure (backward compatibility)
 * @deprecated Use AICompletionResponse instead
 */
export interface AIResponse {
  content: string;
  provider: AIProvider;
  model: string;
  usage?: TokenUsage;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'error';
  timestamp: Date;
}

/**
 * Streaming response chunk
 */
export interface AIStreamChunk {
  content: string;
  isComplete: boolean;
  usage?: TokenUsage;
  provider?: AIProvider;
  model?: string;
}

/**
 * Callback function for streaming responses
 */
export type StreamCallback = (chunk: AIStreamChunk) => void | Promise<void>;

/**
 * Error types for AI operations
 */
export enum AIErrorType {
  RATE_LIMIT = 'rate_limit',
  INVALID_REQUEST = 'invalid_request',
  AUTHENTICATION = 'authentication',
  SERVER_ERROR = 'server_error',
  NETWORK_ERROR = 'network_error',
  CONTENT_FILTER = 'content_filter',
  UNKNOWN = 'unknown'
}

/**
 * AI-specific error class
 */
export class AIServiceError extends Error {
  constructor(
    message: string,
    public type: AIErrorType,
    public provider: AIProvider,
    public statusCode?: number,
    public retryAfter?: number,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'AIServiceError';
    
    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AIServiceError);
    }
  }
}

/**
 * @deprecated Use AIServiceError instead
 */
export class AIError extends AIServiceError {
  constructor(
    message: string,
    type: AIErrorType,
    provider: AIProvider,
    statusCode?: number,
    retryAfter?: number
  ) {
    super(message, type, provider, statusCode, retryAfter);
    this.name = 'AIError';
  }
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxTokensPerMinute?: number;
  maxRequestsPerDay?: number;
}

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  requestsRemaining: number;
  tokensRemaining?: number;
  resetTime: Date;
  isLimited: boolean;
}

/**
 * Base interface for AI providers
 */
export interface IAIProvider {
  readonly provider: AIProvider;
  readonly modelConfig: AIModelConfig;
  
  /**
   * Generate a completion from a request
   */
  generateCompletion(
    request: AICompletionRequest
  ): Promise<AICompletionResponse>;
  
  /**
   * Generate a streaming completion
   */
  generateStreamingCompletion(
    request: AICompletionRequest,
    callback: StreamCallback
  ): Promise<AICompletionResponse>;
  
  /**
   * Check rate limit status
   */
  checkRateLimit(): Promise<RateLimitStatus>;
  
  /**
   * Estimate token count for messages
   */
  estimateTokenCount(messages: AIMessage[]): number;
}

/**
 * Conversation history management
 */
export interface ConversationHistory {
  id: string;
  messages: AIMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Prompt template variable
 */
export interface PromptVariable {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

/**
 * Prompt template structure
 */
export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  variables: PromptVariable[];
  systemPrompt?: string;
  exampleMessages?: AIMessage[];
}

/**
 * Compiled prompt ready for AI provider
 */
export interface CompiledPrompt {
  messages: AIMessage[];
  modelConfig?: Partial<AIModelConfig>;
}

/**
 * AI service configuration
 */
export interface AIServiceConfig {
  defaultProvider: AIProvider;
  geminiConfig?: {
    apiKey: string;
    model: string;
    rateLimit: RateLimitConfig;
  };
  anthropicConfig?: {
    apiKey: string;
    model: string;
    rateLimit: RateLimitConfig;
  };
  enableTokenTracking?: boolean;
  enableCostEstimation?: boolean;
}

/**
 * Cost estimation for different providers
 */
export interface CostEstimate {
  provider: AIProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCost: number;
  currency: string;
}

/**
 * Batch processing request
 */
export interface BatchRequest {
  id: string;
  messages: AIMessage[];
  config?: Partial<AIModelConfig>;
  priority?: number;
}

/**
 * Batch processing result
 */
export interface BatchResult {
  requestId: string;
  response?: AICompletionResponse;
  error?: AIServiceError;
  processingTime: number;
}

/**
 * AI service metrics
 */
export interface AIMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokensUsed: number;
  totalCost: number;
  averageResponseTime: number;
  byProvider: Record<AIProvider, {
    requests: number;
    tokens: number;
    cost: number;
  }>;
}

/**
 * Content safety check result
 */
export interface SafetyCheckResult {
  isSafe: boolean;
  categories: {
    category: string;
    severity: 'low' | 'medium' | 'high';
    blocked: boolean;
  }[];
  confidence: number;
}