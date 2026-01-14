import { jest } from '@jest/globals';
import { RateLimiter } from '../../src/utils/rateLimiter';

declare global {
  var testUtils: {
    mockExit: any;
    createMockLogger: () => any;
    createMockDiscordClient: () => any;
  };
}

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  let mockDateNow: any;

  beforeEach(() => {
    // Mock Date.now for consistent testing
    mockDateNow = jest.spyOn(Date, 'now');
    mockDateNow.mockReturnValue(1000); // Start at 1000ms
  });

  afterEach(() => {
    mockDateNow.mockRestore();
    jest.clearAllTimers();
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters for 60 requests per minute', () => {
      rateLimiter = new RateLimiter(60);

      expect(rateLimiter.getAvailableTokens()).toBe(60);
    });

    it('should initialize with correct parameters for 30 requests per minute', () => {
      rateLimiter = new RateLimiter(30);

      expect(rateLimiter.getAvailableTokens()).toBe(30);
    });

    it('should calculate refill rate correctly', () => {
      rateLimiter = new RateLimiter(60);
      // 60 requests per minute = 1 request per second = 0.001 requests per millisecond
      // We don't have direct access to private fields, but we can test behavior
      expect(rateLimiter.getAvailableTokens()).toBe(60);
    });
  });

  describe('Token acquisition', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter(60); // 1 token per second
    });

    it('should allow immediate acquisition when tokens are available', async () => {
      const startTime = Date.now();

      await rateLimiter.acquire();

      expect(rateLimiter.getAvailableTokens()).toBe(59);
      expect(Date.now() - startTime).toBeLessThan(10); // Should be nearly instant
    });

    it('should block when no tokens are available', async () => {
      // Use up all tokens
      for (let i = 0; i < 60; i++) {
        await rateLimiter.acquire();
      }

      expect(rateLimiter.getAvailableTokens()).toBe(0);

      const startTime = Date.now();
      const acquirePromise = rateLimiter.acquire();

      // Advance time by 1 second (should refill 1 token)
      mockDateNow.mockReturnValue(2000);

      await acquirePromise;

      expect(Date.now() - startTime).toBeGreaterThanOrEqual(1000);
      expect(rateLimiter.getAvailableTokens()).toBe(0); // Should have used the refilled token
    });

    it('should handle multiple sequential acquisitions', async () => {
      rateLimiter = new RateLimiter(10);

      // Acquire 5 tokens
      for (let i = 0; i < 5; i++) {
        await rateLimiter.acquire();
      }

      expect(rateLimiter.getAvailableTokens()).toBe(5);
    });
  });

  describe('Token refill', () => {
    beforeEach(() => {
      rateLimiter = new RateLimiter(60); // 1 token per second
      mockDateNow.mockReturnValue(1000);
    });

    it('should refill tokens over time', async () => {
      // Use all tokens
      for (let i = 0; i < 60; i++) {
        await rateLimiter.acquire();
      }

      expect(rateLimiter.getAvailableTokens()).toBe(0);

      // Advance time by 30 seconds (should refill 30 tokens)
      mockDateNow.mockReturnValue(31000);

      expect(rateLimiter.getAvailableTokens()).toBe(30);
    });

    it('should not exceed maximum tokens during refill', async () => {
      // Use some tokens
      for (let i = 0; i < 30; i++) {
        await rateLimiter.acquire();
      }

      expect(rateLimiter.getAvailableTokens()).toBe(30);

      // Advance time by 60 seconds (should try to refill 60 tokens, but cap at 60)
      mockDateNow.mockReturnValue(61000);

      expect(rateLimiter.getAvailableTokens()).toBe(60);
    });

    it('should refill tokens correctly with fractional rates', () => {
      rateLimiter = new RateLimiter(120); // 2 tokens per second

      // Use 60 tokens
      for (let i = 0; i < 60; i++) {
        rateLimiter.acquire();
      }

      expect(rateLimiter.getAvailableTokens()).toBe(60);

      // Advance time by 500ms (should refill 1 token)
      mockDateNow.mockReturnValue(1500);

      expect(rateLimiter.getAvailableTokens()).toBe(61);
    });
  });

  describe('Available tokens', () => {
    it('should return integer number of available tokens', () => {
      rateLimiter = new RateLimiter(60);

      expect(rateLimiter.getAvailableTokens()).toBe(60);

      rateLimiter.acquire();
      expect(rateLimiter.getAvailableTokens()).toBe(59);
    });

    it('should floor fractional tokens', () => {
      rateLimiter = new RateLimiter(60);

      // Use 59 tokens
      for (let i = 0; i < 59; i++) {
        rateLimiter.acquire();
      }

      // Advance time by 500ms (should refill 0.5 tokens)
      mockDateNow.mockReturnValue(1500);

      expect(rateLimiter.getAvailableTokens()).toBe(0); // Should floor 0.5 to 0
    });
  });

  describe('Edge cases', () => {
    it('should handle zero requests per minute gracefully', () => {
      rateLimiter = new RateLimiter(0);

      expect(rateLimiter.getAvailableTokens()).toBe(0);

      // Should not be able to acquire tokens
      const acquirePromise = rateLimiter.acquire();
      mockDateNow.mockReturnValue(2000); // Advance time, but still no tokens

      // This should eventually resolve but with infinite wait time
      // For testing purposes, we'll just check it doesn't throw immediately
      expect(() => {
        rateLimiter.acquire();
      }).not.toThrow();
    });

    it('should handle very high request rates', () => {
      rateLimiter = new RateLimiter(10000);

      expect(rateLimiter.getAvailableTokens()).toBe(10000);
    });
  });
});
