import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, 'Discord bot token is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
  DISCORD_GUILD_ID: z.string().min(1, 'Discord guild ID is required'),
  DISCORD_NOTIFICATION_CHANNEL_ID: z.string().min(1, 'Notification channel ID is required'),
  DISCORD_ADMIN_USER_ID: z.string().min(1, 'Admin user ID is required'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AMAZON_AFFILIATE_TAG: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

type Env = z.infer<typeof envSchema>;

let env: Env;

try {
  env = envSchema.parse(process.env);
  
  // Validate at least one AI API key is provided
  if (!env.ANTHROPIC_API_KEY && !env.OPENAI_API_KEY) {
    throw new Error('Either ANTHROPIC_API_KEY or OPENAI_API_KEY must be provided');
  }
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Environment validation failed:');
    error.issues.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
  } else {
    console.error('❌ Environment error:', error);
  }
  process.exit(1);
}

export const config = {
  discord: {
    token: env.DISCORD_BOT_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    guildId: env.DISCORD_GUILD_ID,
    notificationChannelId: env.DISCORD_NOTIFICATION_CHANNEL_ID,
    adminUserId: env.DISCORD_ADMIN_USER_ID,
  },
  ai: {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
  },
  amazon: {
    affiliateTag: env.AMAZON_AFFILIATE_TAG,
  },
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
} as const;

export default config;
