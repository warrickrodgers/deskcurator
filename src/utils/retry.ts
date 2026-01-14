/**
 * Retry Utility
 * Implements exponential backoff for failed requests
 */

import { AIServiceError } from '../types/ai.types';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay?: number;
  shouldRetry?: (error: any) => boolean;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const {
    maxRetries,
    baseDelay,
    maxDelay = 30000,
    shouldRetry = (error) => {
      if (error instanceof AIServiceError) {
        return error.retryable;
      }
      return false;
    },
  } = config;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const delay = Math.min(
        baseDelay * Math.pow(2, attempt),
        maxDelay
      );

      console.warn(
        `Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`,
        error instanceof Error ? error.message : error
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}