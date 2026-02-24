/**
 * Rate Limiter
 * Implements token bucket algorithm for rate limiting
 */

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(requestsPerMinute: number) {
    this.maxTokens = requestsPerMinute;
    this.tokens = requestsPerMinute;
    this.lastRefill = Date.now();
    this.refillRate = requestsPerMinute / 60000; // Convert to per millisecond
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = timePassed * this.refillRate;
    
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait until a token is available
    const timeToWait = (1 - this.tokens) / this.refillRate;
    await new Promise(resolve => setTimeout(resolve, timeToWait));
    
    this.refill();
    this.tokens -= 1;
  }

  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}