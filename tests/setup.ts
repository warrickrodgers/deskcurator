import { jest } from '@jest/globals';

declare global {
  var testUtils: {
    mockExit: any;
    createMockLogger: () => any;
    createMockDiscordClient: () => any;
  };
}

// Mock Discord.js
jest.mock('discord.js', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      login: jest.fn(),
      destroy: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      emit: jest.fn(),
      user: { id: '123456789', username: 'TestBot' },
      channels: {
        fetch: jest.fn(),
      },
    })),
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 4,
    },
    Events: {
      ClientReady: 'ready',
      MessageCreate: 'messageCreate',
    },
  };
});

// Mock Winston logger
jest.mock('winston', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };

  return {
    createLogger: jest.fn(() => mockLogger),
    format: {
      combine: jest.fn(),
      timestamp: jest.fn(),
      printf: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
    },
    transports: {
      Console: jest.fn(),
      File: jest.fn(),
    },
  };
});

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    Anthropic: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

// Mock Axios
jest.mock('axios', () => {
  return {
    create: jest.fn(() => ({
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    })),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
});

// Mock dotenv
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock fs module for file operations
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
}));

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Global test utilities
global.testUtils = {
  mockExit,
  createMockLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
  createMockDiscordClient: () => ({
    login: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    user: { id: '123456789', username: 'TestBot' },
    channels: {
      fetch: jest.fn(),
    },
  }),
};
