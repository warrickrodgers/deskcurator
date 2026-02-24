import { jest } from '@jest/globals';

declare global {
  var testUtils: {
    mockExit: any;
    createMockLogger: () => any;
    createMockDiscordClient: () => any;
  };
}

describe('Logger Utility', () => {
  let mockConfig: any;
  let mockFs: any;
  let mockPath: any;
  let mockWinston: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockConfig = {
      logLevel: 'info',
    };

    mockFs = {
      existsSync: jest.fn().mockReturnValue(false),
      mkdirSync: jest.fn(),
    };

    mockPath = {
      join: jest.fn((...args) => args.join('/')),
    };

    mockWinston = {
      format: {
        combine: jest.fn(),
        timestamp: jest.fn(),
        errors: jest.fn(),
        printf: jest.fn(),
        colorize: jest.fn(),
      },
      transports: {
        Console: jest.fn(),
        File: jest.fn(),
      },
      createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
      }),
    };

    // Mock modules
    jest.doMock('winston', () => mockWinston);
    jest.doMock('../config/env', () => ({
      default: mockConfig,
    }));
    jest.doMock('fs', () => mockFs);
    jest.doMock('path', () => mockPath);
    jest.doMock('process', () => ({
      cwd: jest.fn().mockReturnValue('/test/dir'),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Logger initialization', () => {
    it('should create logs directory if it does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);

      // Import the logger module
      await import('../../src/utils/logger');

      // Verify logs directory creation
      expect(mockFs.existsSync).toHaveBeenCalledWith('/test/dir/logs');
      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/test/dir/logs', { recursive: true });
    });

    it('should not create logs directory if it already exists', async () => {
      mockFs.existsSync.mockReturnValue(true);

      // Import the logger module
      await import('../../src/utils/logger');

      // Verify logs directory was checked but not created
      expect(mockFs.existsSync).toHaveBeenCalledWith('/test/dir/logs');
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should create winston logger with correct configuration', async () => {
      // Import the logger module
      await import('../../src/utils/logger');

      // Verify winston.createLogger was called with correct config
      expect(mockWinston.createLogger).toHaveBeenCalledWith({
        level: 'info',
        format: expect.any(Function), // The combined format
        transports: expect.arrayContaining([
          expect.any(Object), // Console transport
          expect.any(Object), // Error log file transport
          expect.any(Object), // Combined log file transport
        ]),
      });
    });

    it('should configure console transport with colorize format', async () => {
      // Import the logger module
      await import('../../src/utils/logger');

      // Verify Console transport was created with colorize
      expect(mockWinston.transports.Console).toHaveBeenCalledWith({
        format: expect.any(Function), // Combined format with colorize
      });
    });

    it('should configure file transports for error and combined logs', async () => {
      // Import the logger module
      await import('../../src/utils/logger');

      // Verify File transports were created
      expect(mockWinston.transports.File).toHaveBeenCalledWith({
        filename: '/test/dir/logs/error.log',
        level: 'error',
      });
      expect(mockWinston.transports.File).toHaveBeenCalledWith({
        filename: '/test/dir/logs/combined.log',
      });
    });
  });

  describe('Logger format', () => {
    it('should combine multiple format functions', async () => {
      // Import the logger module
      await import('../../src/utils/logger');

      // Verify format.combine was called with timestamp, errors, and printf
      expect(mockWinston.format.combine).toHaveBeenCalled();
      expect(mockWinston.format.timestamp).toHaveBeenCalledWith({
        format: 'YYYY-MM-DD HH:mm:ss',
      });
      expect(mockWinston.format.errors).toHaveBeenCalledWith({ stack: true });
      expect(mockWinston.format.printf).toHaveBeenCalled();
    });
  });

  describe('Logger export', () => {
    it('should export the created logger instance', async () => {
      const mockLoggerInstance = { info: jest.fn(), error: jest.fn() };
      mockWinston.createLogger.mockReturnValue(mockLoggerInstance);

      // Import the logger module
      const loggerModule = await import('../../src/utils/logger');

      // Verify the exported logger is the winston logger instance
      expect(loggerModule.default).toBe(mockLoggerInstance);
    });
  });
});
