import logger from './utils/logger';
import discordService from './services/discord';
import config from './config/env';

async function main() {
  try {
    logger.info('🚀 Starting DeskCurator...');
    logger.info(`Environment: ${config.nodeEnv}`);

    // Create logs directory if it doesn't exist
    const fs = require('fs');
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    // Connect to Discord
    await discordService.connect();

    // Wait for bot to be ready
    await new Promise((resolve) => {
      const checkReady = setInterval(() => {
        if (discordService.isConnected()) {
          clearInterval(checkReady);
          resolve(true);
        }
      }, 100);
    });

    logger.info('✅ DeskCurator is ready!');

    // Send startup notification
    await discordService.sendNotification(
      '🤖 **DeskCurator Bot Online**\n\nAll systems operational. Ready to begin content research!'
    );

    // TODO: Initialize agents
    // const contentResearcher = new ContentResearcher();
    // await contentResearcher.start();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('📴 Shutting down gracefully...');
      await discordService.sendNotification(
        '👋 DeskCurator is shutting down. See you soon!'
      );
      await discordService.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('📴 Received SIGTERM, shutting down...');
      await discordService.disconnect();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

main();