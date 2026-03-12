import * as fs from 'fs';
import logger from './utils/logger';
import discordService from './services/discord';
import { databaseService } from './services/database.service';
import { chromaService } from './services/chroma.service';
import ContentResearcher from './agents/content-researcher/ContentResearcher';
import ContentWriter from './agents/content-writer/ContentWriter';
import SeoOptimizer from './agents/seo-optimizer/SeoOptimizer';
import config from './config/env';

async function main() {
  try {
    logger.info('Starting DeskCurator...');
    logger.info(`Environment: ${config.nodeEnv}`);

    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }

    databaseService.initialize();
    await chromaService.initialize();
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

    const contentResearcher = new ContentResearcher();
    const seoOptimizer = new SeoOptimizer();
    const contentWriter = new ContentWriter(contentResearcher, seoOptimizer);

    await contentResearcher.start();
    await contentWriter.start();

    // Send startup notification to each channel with relevant commands
    await Promise.all([
      discordService.sendNotification(
        '**DeskCurator Bot Online** 🔬\n\n' +
        '`!research <product>` — research a product and request approval',
        config.discord.researcherChannelId
      ),
      discordService.sendNotification(
        '**DeskCurator Bot Online** ✍️\n\n' +
        '`!write "<title>"` — create an article (hybrid sync/async workflow)\n' +
        '`!retry-write <articleId>` — retry writing using existing approved research\n' +
        '`!seo-report <articleId>` — print full SEO audit for an article\n' +
        '`!status` — show all article jobs\n' +
        '`!cancel <jobId>` — cancel an article or research job',
        config.discord.writerChannelId
      ),
      discordService.sendNotification(
        '**DeskCurator Bot Online** 🔍\n\n' +
        'SEO audit reports will appear here automatically after each article is approved.\n' +
        'Use `!seo-report <articleId>` in the writer channel to retrieve a report at any time.',
        config.discord.seoChannelId
      ),
    ]);

    // Register Discord command: !research <product name>
    discordService.registerResearchHandler(async (productQuery) => {
      const result = await contentResearcher.researchProduct(productQuery);
      if (!result) {
        await discordService.sendNotification(
          `Research for **${productQuery}** was skipped (duplicate) or rejected.`,
          config.discord.researcherChannelId
        );
      }
    });

    // Register Discord command: !write "<title>"
    discordService.registerWriteHandler(async (title) => {
      await contentWriter.createArticle({
        title,
        articleType: 'multi_product',
        productCount: 5,
      });
    });

    // Register Discord command: !status
    discordService.registerStatusHandler(async () => {
      const articles = databaseService.getAllArticleJobs();
      if (articles.length === 0) {
        await discordService.sendNotification(
          '📋 **Status:** No article jobs found.',
          config.discord.writerChannelId
        );
        return;
      }

      const lines = articles.slice(0, 10).map((a) =>
        `• **${a.title}** [${a.status}] — research ${a.completedResearchCount}/${a.requiredResearchCount} | ID: \`${a.id}\``
      );

      await discordService.sendNotification(
        `📋 **Article Jobs (${articles.length} total):**\n${lines.join('\n')}`,
        config.discord.writerChannelId
      );
    });

    // Register Discord command: !cancel <jobId>
    discordService.registerCancelHandler(async (jobId) => {
      const article = databaseService.getArticleJobById(jobId);
      if (article) {
        databaseService.updateArticleJob(jobId, { status: 'rejected' });
        await discordService.sendNotification(
          `🚫 Article \`${jobId}\` ("${article.title}") cancelled.`,
          config.discord.writerChannelId
        );
        return;
      }

      const queueJob = databaseService.getQueueResearchJobById(jobId);
      if (queueJob) {
        databaseService.updateQueueResearchJob(jobId, { status: 'rejected' });
        await discordService.sendNotification(
          `🚫 Research job \`${jobId}\` ("${queueJob.query}") cancelled.`,
          config.discord.writerChannelId
        );
        return;
      }

      await discordService.sendNotification(
        `❓ No job found with ID \`${jobId}\`.`,
        config.discord.writerChannelId
      );
    });

    // Register Discord command: !retry-write <articleId>
    discordService.registerRetryWriteHandler(async (articleId) => {
      await contentWriter.retryWrite(articleId);
    });

    // Register Discord command: !seo-report <articleId>
    discordService.registerSeoReportHandler(async (articleId) => {
      const article = databaseService.getArticleJobById(articleId);
      if (!article) {
        await discordService.sendNotification(
          `❓ No article found with ID \`${articleId}\`.`,
          config.discord.writerChannelId
        );
        return;
      }
      if (!article.seoReport) {
        await discordService.sendNotification(
          `⚠️ No SEO report for article \`${articleId}\` ("${article.title}") — status is **${article.status}**.\nSEO runs automatically after you approve the article draft.`,
          config.discord.seoChannelId
        );
        return;
      }
      const report = JSON.parse(article.seoReport);
      const scoreEmoji = report.seoScore >= 80 ? '🟢' : report.seoScore >= 60 ? '🟡' : '🔴';
      const lines = [
        `${scoreEmoji} **SEO Report** — \`${articleId}\``,
        `📄 "${article.title}"`,
        `**Score:** ${report.seoScore}/100 · **Words:** ${report.wordCount} · **Grade:** ${report.readabilityGrade} · **Intent:** ${report.searchIntent}`,
        `**Primary keyword:** \`${report.keywords?.primary ?? 'n/a'}\``,
        `**Secondary:** ${(report.keywords?.secondary ?? []).map((k: string) => `\`${k}\``).join(', ') || 'none'}`,
        '',
        `✅ **Passed (${report.passed?.length ?? 0}):**`,
        ...(report.passed ?? []).map((p: string) => `  • ${p}`),
        '',
        `⚠️ **Warnings (${report.warnings?.length ?? 0}):**`,
        ...(report.warnings?.length ? report.warnings.map((w: string) => `  • ${w}`) : ['  none']),
        '',
        `❌ **Failures (${report.failures?.length ?? 0}):**`,
        ...(report.failures?.length ? report.failures.map((f: string) => `  • ${f}`) : ['  none']),
      ];
      if (report.competitorGaps?.length) {
        lines.push('', `💡 **Competitor gaps:**`, ...report.competitorGaps.map((g: string) => `  • ${g}`));
      }
      await discordService.sendNotification(
        lines.join('\n'),
        config.discord.seoChannelId
      );
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await contentWriter.stop();
      await contentResearcher.stop();
      databaseService.close();
      try {
        await Promise.all([
          discordService.sendNotification('DeskCurator shutting down. 👋', config.discord.researcherChannelId),
          discordService.sendNotification('DeskCurator shutting down. 👋', config.discord.writerChannelId),
        ]);
      } catch {
        // best-effort
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
