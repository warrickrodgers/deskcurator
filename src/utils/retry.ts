/**
 * Retry Utility
 * Implements exponential backoff for failed requests, honouring API-specified
 * retry-after delays when available.
 */

import { AIServiceError, AIErrorType, RateLimitType } from '../types/ai.types';
import logger from './logger';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay?: number;
  shouldRetry?: (error: any) => boolean;
  /** Called just before each wait so callers can emit notifications. */
  onWait?: (waitMs: number, attempt: number, error: any) => void | Promise<void>;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  const {
    maxRetries,
    baseDelay,
    maxDelay = 60_000,
    shouldRetry = (error) => {
      if (error instanceof AIServiceError) {
        // RPD (daily quota): throw immediately so the job queue can schedule for midnight.
        // Retrying here would just block the thread for hours.
        if (error.type === AIErrorType.RATE_LIMIT && error.rateLimitType === RateLimitType.RPD) {
          return false;
        }
        return (
          error.type === AIErrorType.RATE_LIMIT ||
          error.type === AIErrorType.NETWORK_ERROR ||
          error.type === AIErrorType.SERVICE_UNAVAILABLE
        );
      }
      return false;
    },
    onWait,
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

      // Prefer the API-specified delay; fall back to exponential backoff.
      const apiDelay =
        error instanceof AIServiceError && error.retryAfter != null
          ? error.retryAfter
          : undefined;
      const delay = apiDelay ?? Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      logger.warn(
        `Request failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${(delay / 1000).toFixed(1)}s${apiDelay ? ' (API-specified)' : ' (backoff)'}...`,
        error instanceof Error ? error.message : error
      );

      await onWait?.(delay, attempt + 1, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}