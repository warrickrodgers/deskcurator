import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, 'Discord bot token is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
  DISCORD_GUILD_ID: z.string().min(1, 'Discord guild ID is required'),
  DISCORD_RESEARCHER_CHANNEL_ID: z.string().min(1, 'Researcher channel ID is required'),
  DISCORD_WRITER_CHANNEL_ID: z.string().min(1, 'Writer channel ID is required'),
  DISCORD_ADMIN_USER_ID: z.string().min(1, 'Admin user ID is required'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().min(1, 'Gemini API key is required'),
  TAVILY_API_KEY: z.string().min(1, 'Tavily API key is required'),
  CHROMADB_URL: z.string().url().default('http://localhost:8000'),
  AMAZON_AFFILIATE_TAG: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

type Env = z.infer<typeof envSchema>;

let env: Env;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Environment validation failed:');
    error.issues.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  } else {
    console.error('Environment error:', error);
  }
  process.exit(1);
}

export const config = {
  discord: {
    token: env.DISCORD_BOT_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    guildId: env.DISCORD_GUILD_ID,
    researcherChannelId: env.DISCORD_RESEARCHER_CHANNEL_ID,
    writerChannelId: env.DISCORD_WRITER_CHANNEL_ID,
    adminUserId: env.DISCORD_ADMIN_USER_ID,
  },
  ai: {
    // Active provider — ContentResearcher uses Gemini
    provider: 'gemini' as 'gemini' | 'anthropic',
    // Gemini config (used by ai.service.ts and chroma.service.ts)
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      // Lightweight model used by ContentResearcher for structured data extraction
      model: 'gemini-3.1-flash-lite-preview',
      // Capable model used by ContentWriter for full article generation
      writerModel: 'gemini-3-flash-preview',
      rateLimitPerMinute: 60,
      maxRetries: 3,
      retryDelay: 1000,
    },
    // Anthropic config (placeholder for future use)
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: 'claude-sonnet-4-20250514',
      rateLimitPerMinute: 60,
      maxRetries: 3,
      retryDelay: 1000,
    },
  },
  tavily: {
    apiKey: env.TAVILY_API_KEY,
  },
  chromadb: {
    url: env.CHROMADB_URL,
  },
  amazon: {
    affiliateTag: env.AMAZON_AFFILIATE_TAG,
  },
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
};

export default config;
