import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import logger from '../../utils/logger';
import discordService from '../../services/discord';
import { aiService } from '../../services/ai.service';
import { databaseService } from '../../services/database.service';
import { jobQueueService } from '../../services/jobQueue.service';
import {
  WRITER_SYSTEM_PROMPT,
  categoryDiscoveryPrompt,
  categoryExtractionPrompt,
  articleGenerationPrompt,
  seoMetaPrompt,
} from './context';
import { ArticleRequest, ResearchFindings, ApprovalRequest } from '../../types';
import { ArticleJob, QueueResearchJob } from '../../types/jobs';
import ContentResearcher from '../content-researcher/ContentResearcher';
import config from '../../config/env';

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'articles');
const POLL_INTERVAL_MS = 10_000;

export class ContentWriter {
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly contentResearcher: ContentResearcher) {
    logger.info('ContentWriter agent initialized');
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.schedulePoll();
    logger.info('ContentWriter agent started — polling every 10s for completed research');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('ContentWriter agent stopped');
  }

  // ── Public entry point ────────────────────────────────────────────────────

  /**
   * Hybrid workflow entry point triggered by !write "<title>".
   *
   * Phase 1 (sync): Run initial category discovery research via ContentResearcher.
   * Phase 2 (async): Queue N parallel product research jobs and return immediately.
   */
  async createArticle(request: ArticleRequest): Promise<void> {
    const productCount = request.productCount ?? 5;
    logger.info(`ContentWriter: starting article "${request.title}" (${productCount} products)`);

    // Create the Discord thread immediately so all subsequent messages are threaded
    let threadId: string | undefined;
    try {
      threadId = await discordService.createArticleThread(request.title);
    } catch (error) {
      logger.warn('Could not create article thread — notifications will go to writer channel');
    }

    const notify = (msg: string) =>
      discordService.sendNotification(msg, threadId ?? config.discord.writerChannelId);

    try {
      // ── PHASE 1: Synchronous initial discovery ───────────────────────────
      logger.info('Phase 1: initial category discovery (synchronous)…');
      await notify(`🔍 **Phase 1:** Running initial category discovery for **"${request.title}"**…`);

      const discoveryQuery = `Find the top ${productCount} most important product categories someone would need for: ${request.title}`;
      const initialFindings = await this.contentResearcher.researchProduct(discoveryQuery);

      if (!initialFindings) {
        await notify(`❌ Aborted — initial research was rejected or skipped.`);
        return;
      }

      // Extract categories from initial research
      const categories = await this.extractCategories(initialFindings, productCount);
      logger.info(`Identified ${categories.length} categories: ${categories.join(', ')}`);

      // ── PHASE 2: Queue parallel research jobs ────────────────────────────
      logger.info('Phase 2: queuing parallel product research jobs…');

      const articleId = jobQueueService.createArticle({
        title: request.title,
        articleType: request.articleType,
        status: 'pending_research',
        requiredResearchCount: categories.length,
      });

      // Persist the thread ID so the polling loop can use it later
      if (threadId) {
        databaseService.updateArticleJob(articleId, { discordThreadId: threadId });
      }

      const researchJobIds: string[] = categories.map((category) =>
        jobQueueService.enqueueResearch({
          query: `Best ${category} for: ${request.title}`,
          type: 'product',
          parentJobId: articleId,
          priority: 7,
        })
      );

      databaseService.updateArticleJob(articleId, {
        researchJobIds: JSON.stringify(researchJobIds),
        requiredResearchCount: researchJobIds.length,
      });

      logger.info(`Article ${articleId} created — queued ${researchJobIds.length} research jobs`);

      await notify(
        `✅ **Phase 1 complete** — found ${categories.length} categories:\n` +
        categories.map((c, i) => `  ${i + 1}. ${c}`).join('\n') +
        `\n\n🔍 **Phase 2:** Queued **${researchJobIds.length}** product research jobs\n` +
        `⏳ Awaiting research approvals in <#${config.discord.researcherChannelId}>\n` +
        `📋 Article ID: \`${articleId}\``
      );
    } catch (error) {
      logger.error(`ContentWriter.createArticle failed for "${request.title}":`, error);
      await notify(`❌ Failed to start article: ${(error as Error).message}`);
    }
  }

  // ── Polling loop ──────────────────────────────────────────────────────────

  private schedulePoll(): void {
    if (!this.isRunning) return;
    this.pollTimer = setTimeout(async () => {
      await this.pollForCompletedResearch();
      this.schedulePoll();
    }, POLL_INTERVAL_MS);
  }

  private async pollForCompletedResearch(): Promise<void> {
    try {
      const pendingArticles = databaseService.getArticleJobsByStatus('pending_research');

      for (const article of pendingArticles) {
        const ids: string[] = JSON.parse(article.researchJobIds ?? '[]');
        if (ids.length === 0) continue;

        const researchJobs = databaseService.getQueueResearchJobsByIds(ids);
        const approved = researchJobs.filter((j) => j.status === 'approved');
        // 'rejected' (exhausted retries, returned null) and 'failed' (threw exception) are both terminal
        const terminal = researchJobs.filter((j) => j.status === 'failed' || j.status === 'rejected');

        logger.debug(
          `Article ${article.id}: ${approved.length}/${researchJobs.length} approved, ${terminal.length} terminal (failed/rejected)`
        );

        if (approved.length === researchJobs.length) {
          logger.info(`All research approved for article ${article.id} — starting writing`);
          await this.writeArticle(article, researchJobs);
        } else if (terminal.length > 0 && approved.length + terminal.length === researchJobs.length) {
          if (approved.length > 0) {
            logger.warn(
              `Article ${article.id}: ${terminal.length} jobs failed/rejected, writing with ${approved.length} approved results`
            );
            await this.writeArticle(article, approved);
          } else {
            logger.error(`Article ${article.id}: all research jobs failed/rejected — marking failed`);
            databaseService.updateArticleJob(article.id, { status: 'failed' });
            await this.notifyArticle(
              article,
              `❌ **Article failed** — all research jobs failed or were rejected.\nID: \`${article.id}\``
            );
          }
        }
      }
    } catch (error) {
      logger.error('ContentWriter polling error:', error);
    }
  }

  // ── Article writing ───────────────────────────────────────────────────────

  private async writeArticle(
    article: ArticleJob,
    researchJobs: QueueResearchJob[]
  ): Promise<void> {
    try {
      databaseService.updateArticleJob(article.id, { status: 'writing' });
      logger.info(`Writing article ${article.id}: "${article.title}"`);
      await this.notifyArticle(article, `✍️ **Writing article…** All research approved. Generating draft now…`);

      const researchItems: ResearchFindings[] = researchJobs
        .filter((j) => j.findings)
        .map((j) => JSON.parse(j.findings!) as ResearchFindings);

      if (researchItems.length === 0) {
        throw new Error('No research findings available to write article');
      }

      const draft = await aiService.ask(
        articleGenerationPrompt(
          article.title,
          article.articleType,
          researchItems,
          config.amazon.affiliateTag
        ),
        WRITER_SYSTEM_PROMPT
      );

      const metaDescription = await aiService.ask(
        seoMetaPrompt(article.title, draft),
        WRITER_SYSTEM_PROMPT
      );

      const fullDraft = `${draft}\n\n---\n*Meta description: ${metaDescription.trim()}*`;

      databaseService.updateArticleJob(article.id, {
        draftContent: fullDraft,
        status: 'awaiting_approval',
      });

      logger.info(`Article ${article.id} draft complete — requesting Discord approval`);

      const approvalId = randomUUID();
      const discordPreview =
        `**Article Draft: "${article.title}"**\n\n` +
        fullDraft.substring(0, 3800) +
        (fullDraft.length > 3800 ? '\n\n*(truncated — full content saved locally)*' : '');

      const approvalRequest: ApprovalRequest = {
        id: approvalId,
        type: 'content',
        data: discordPreview,
        status: 'pending',
        requestedAt: new Date(),
      };

      // Post approval in the article thread (or writer channel as fallback)
      const targetChannelId = article.discordThreadId ?? config.discord.writerChannelId;
      const { approved, feedback } = await discordService.requestApproval(
        approvalRequest,
        targetChannelId
      );

      if (approved) {
        logger.info(`Article ${article.id} approved — publishing`);
        await this.publishArticle(article, fullDraft);
      } else {
        databaseService.updateArticleJob(article.id, { status: 'rejected' });
        logger.info(`Article ${article.id} rejected${feedback ? ` — feedback: ${feedback}` : ''}`);
        if (feedback) {
          await this.notifyArticle(
            article,
            `📝 **Article rejected.**\nFeedback: ${feedback}`
          );
        }
      }
    } catch (error) {
      logger.error(`Failed to write article ${article.id}:`, error);
      databaseService.updateArticleJob(article.id, { status: 'failed' });
      await this.notifyArticle(
        article,
        `❌ **Writing failed:** ${(error as Error).message}`
      );
    }
  }

  private async publishArticle(article: ArticleJob, content: string): Promise<void> {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const filename = `${article.id}.md`;
    const filepath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(filepath, content, 'utf8');

    databaseService.updateArticleJob(article.id, {
      status: 'published',
      finalContent: content,
      publishedAt: new Date().toISOString(),
    });

    logger.info(`Article ${article.id} published to ${filepath}`);

    await this.notifyArticle(
      article,
      `🎉 **Article published!**\n` +
      `📁 File: \`output/articles/${filename}\``
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Send a notification into the article's thread, or the writer channel as fallback.
   */
  private notifyArticle(article: ArticleJob, message: string): Promise<void> {
    const targetId = article.discordThreadId ?? config.discord.writerChannelId;
    return discordService.sendNotification(message, targetId);
  }

  private async extractCategories(
    findings: ResearchFindings,
    count: number
  ): Promise<string[]> {
    try {
      const raw = await aiService.ask(
        categoryExtractionPrompt(findings.summary, count),
        WRITER_SYSTEM_PROMPT
      );
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) {
        return parsed.slice(0, count);
      }
      throw new Error('Unexpected JSON shape');
    } catch {
      logger.warn('Category extraction from summary failed — using discovery prompt');
    }

    try {
      const raw = await aiService.ask(
        categoryDiscoveryPrompt(findings.product.name, count),
        WRITER_SYSTEM_PROMPT
      );
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed) && parsed.every((c) => typeof c === 'string')) {
        return parsed.slice(0, count);
      }
    } catch {
      logger.warn('Category discovery fallback also failed — using pros as category hints');
    }

    return findings.pros.slice(0, count).map((p) => p.split(' ').slice(0, 3).join(' '));
  }
}

export default ContentWriter;
