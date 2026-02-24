import * as fs from 'fs';
import logger from './utils/logger';
import discordService from './services/discord';
import { databaseService } from './services/database.service';
import { chromaService } from './services/chroma.service';
import ContentResearcher from './agents/content-researcher/ContentResearcher';
import config from './config/env';

async function main() {
  try {
    logger.info('Starting DeskCurator...');
    logger.info(`Environment: ${config.nodeEnv}`);

    // Ensure logs directory exists
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    // Initialize SQLite database (synchronous)
    databaseService.initialize();

    // Initialize ChromaDB connection (requires docker-compose up -d)
    await chromaService.initialize();

    // Connect to Discord
    await discordService.connect();

    // Wait for Discord bot ready
    await new Promise<void>((resolve) => {
      const checkReady = setInterval(() => {
        if (discordService.isConnected()) {
          clearInterval(checkReady);
          resolve();
        }
      }, 100);
    });

    logger.info('DeskCurator is ready!');

    await discordService.sendNotification(
      '**DeskCurator Bot Online**\n\nAll systems operational. ContentResearcher is ready.'
    );

    // Initialize and start the ContentResearcher agent
    const contentResearcher = new ContentResearcher();
    await contentResearcher.start();

    // Register Discord command: !research <product name>
    discordService.registerResearchHandler(async (productQuery) => {
      const result = await contentResearcher.researchProduct(productQuery);
      if (!result) {
        await discordService.sendNotification(
          `Research for **${productQuery}** was skipped (duplicate) or rejected.`
        );
      }
    });

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await contentResearcher.stop();
      databaseService.close();
      try {
        await discordService.sendNotification('DeskCurator is shutting down. See you soon!');
      } catch {
        // best-effort notification
      }
      await discordService.disconnect();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

main();
