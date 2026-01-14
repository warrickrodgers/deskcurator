import { jest } from '@jest/globals';

declare global {
  var testUtils: {
    mockExit: any;
    createMockLogger: () => any;
    createMockDiscordClient: () => any;
  };
}

describe('Main Application', () => {
  let mockLogger: any;
  let mockDiscordService: any;
  let mockConfig: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mocks
    mockLogger = global.testUtils.createMockLogger();
    mockDiscordService = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      sendNotification: jest.fn(),
      isConnected: jest.fn(),
    };
    mockConfig = {
      nodeEnv: 'test',
    };

    // Mock the logger module
    jest.doMock('../src/utils/logger', () => ({
      default: mockLogger,
    }));

    // Mock the discord service
    jest.doMock('../src/services/discord', () => ({
      default: mockDiscordService,
    }));

    // Mock the config
    jest.doMock('../src/config/env', () => ({
      default: mockConfig,
    }));

    // Mock fs for logs directory creation
    const mockFs = {
      existsSync: jest.fn().mockReturnValue(false),
      mkdirSync: jest.fn(),
    };
    jest.doMock('fs', () => mockFs);
  });

  afterEach(() => {
    // Restore all mocks
    jest.restoreAllMocks();
  });

  describe('Application startup', () => {
    it('should initialize logger and config', async () => {
      // Import the main module (this will trigger the main function)
      const mainModule = await import('../src/index');

      // Verify that logger was called with startup messages
      expect(mockLogger.info).toHaveBeenCalledWith('🚀 Starting DeskCurator...');
      expect(mockLogger.info).toHaveBeenCalledWith('Environment: test');
    });

    it('should create logs directory if it does not exist', async () => {
      const fs = require('fs');

      // Import the main module
      await import('../src/index');

      // Verify logs directory creation was attempted
      expect(fs.existsSync).toHaveBeenCalledWith('logs');
      expect(fs.mkdirSync).toHaveBeenCalledWith('logs');
    });

    it('should attempt to connect to Discord', async () => {
      mockDiscordService.isConnected.mockReturnValue(true);

      // Import the main module
      await import('../src/index');

      // Verify Discord connection was attempted
      expect(mockDiscordService.connect).toHaveBeenCalled();
    });

    it('should send startup notification when connected', async () => {
      mockDiscordService.isConnected.mockReturnValue(true);

      // Import the main module
      await import('../src/index');

      // Verify startup notification was sent
      expect(mockDiscordService.sendNotification).toHaveBeenCalledWith(
        '🤖 **DeskCurator Bot Online**\n\nAll systems operational. Ready to begin content research!'
      );
    });

    it('should handle graceful shutdown on SIGINT', async () => {
      mockDiscordService.isConnected.mockReturnValue(true);

      // Import the main module
      await import('../src/index');

      // Simulate SIGINT
      process.emit('SIGINT');

      // Verify shutdown procedures
      expect(mockLogger.info).toHaveBeenCalledWith('📴 Shutting down gracefully...');
      expect(mockDiscordService.sendNotification).toHaveBeenCalledWith(
        '👋 DeskCurator is shutting down. See you soon!'
      );
      expect(mockDiscordService.disconnect).toHaveBeenCalled();
    });

    it('should handle graceful shutdown on SIGTERM', async () => {
      mockDiscordService.isConnected.mockReturnValue(true);

      // Import the main module
      await import('../src/index');

      // Simulate SIGTERM
      process.emit('SIGTERM');

      // Verify shutdown procedures
      expect(mockLogger.info).toHaveBeenCalledWith('📴 Received SIGTERM, shutting down...');
      expect(mockDiscordService.disconnect).toHaveBeenCalled();
    });

    it('should handle connection failures', async () => {
      mockDiscordService.connect.mockRejectedValue(new Error('Connection failed'));

      // Spy on process.exit
      const exitSpy = global.testUtils.mockExit;

      // Import the main module (this should trigger the error handling)
      await import('../src/index');

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify error was logged and process exited
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to start application:', expect.any(Error));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
