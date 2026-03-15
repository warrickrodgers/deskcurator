import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import logger from '../../utils/logger';
import discordService from '../../services/discord';
import { writerAiService } from '../../services/ai.service';
import { databaseService } from '../../services/database.service';
import { jobQueueService } from '../../services/jobQueue.service';
import {
  WRITER_SYSTEM_PROMPT,
  articleGenerationPrompt,
  articleRevisionPrompt,
  seoMetaPrompt,
} from './context';
import { ArticleRequest, ResearchFindings, ApprovalRequest } from '../../types';
import { ArticleJob, QueueResearchJob } from '../../types/jobs';
import { AIServiceError, AIErrorType, RateLimitType } from '../../types/ai.types';
import ContentResearcher from '../content-researcher/ContentResearcher';
import SeoOptimizer from '../seo-optimizer/SeoOptimizer';
import config from '../../config/env';

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'articles');
const POLL_INTERVAL_MS = 10_000;

export class ContentWriter {
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly contentResearcher: ContentResearcher,
    private readonly seoOptimizer: SeoOptimizer
  ) {
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

  // ── Public entry points ───────────────────────────────────────────────────

  /**
   * Manual retry triggered by !retry-write <articleId>.
   *
   * Skips research entirely — looks up existing approved research for the article
   * and attempts to write it again. Useful after a 503 or RPD failure.
   */
  async retryWrite(articleId: string): Promise<void> {
    const article = databaseService.getArticleJobById(articleId);
    if (!article) throw new Error(`No article found with ID: ${articleId}`);

    const ids: string[] = JSON.parse(article.researchJobIds ?? '[]');
    if (ids.length === 0) {
      throw new Error(`Article ${articleId} has no research jobs — run !write to start from scratch`);
    }

    const researchJobs = databaseService.getQueueResearchJobsByIds(ids);
    const approved = researchJobs.filter((j) => j.status === 'approved');

    if (approved.length === 0) {
      throw new Error(
        `No approved research for article ${articleId} (${researchJobs.length} jobs found, none approved)`
      );
    }

    logger.info(`retryWrite: article ${articleId} — forcing write with ${approved.length}/${researchJobs.length} approved research jobs`);
    await this.writeArticle(article, approved);
  }

  /**
   * Hybrid workflow entry point triggered by !write "<title>".
   *
   * Phase 1 (sync): Run initial category discovery research via ContentResearcher.
   * Phase 2 (async): Queue N parallel product research jobs and return immediately.
   */
  async createArticle(request: ArticleRequest): Promise<void> {
    // 5 is the upper bound — the discovery AI can return fewer if not enough products exist
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
      // ── PHASE 1: AI product discovery + validation ────────────────────────
      logger.info('Phase 1: AI product discovery…');
      await notify(`🔍 **Phase 1:** Discovering products for **"${request.title}"**…`);

      const discovered = await this.contentResearcher.discoverProducts(request.title);

      if (discovered.length === 0) {
        await notify(`❌ Aborted — no products could be discovered for this topic.`);
        return;
      }

      // Take up to productCount of the validated discoveries
      const categories = discovered.slice(0, productCount);
      logger.info(`Discovered ${discovered.length} products, selecting ${categories.length}: ${categories.join(', ')}`);

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
          query: this.buildResearchQuery(category, request.title),
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

      const draft = await writerAiService.ask(
        articleGenerationPrompt(
          article.title,
          article.articleType,
          researchItems,
          config.amazon.affiliateTag
        ),
        WRITER_SYSTEM_PROMPT
      );

      logger.debug(`Article request submitted and the prompt was ${articleGenerationPrompt(
          article.title,
          article.articleType,
          researchItems,
          config.amazon.affiliateTag
        )}`)

      const metaDescription = await writerAiService.ask(
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
        databaseService.updateArticleJob(article.id, { status: 'approved' });
        logger.info(`Article ${article.id} approved — running SEO optimization`);
        await this.notifyArticle(article, `🔍 **SEO optimization in progress…**`);

        const MAX_REVISIONS = 2;
        let currentDraft = fullDraft;
        let publishContent: string | null = null;

        for (let attempt = 0; attempt <= MAX_REVISIONS; attempt++) {
          const seoResult = await this.seoOptimizer.run(article.id, researchItems.length);

          if (seoResult.decision === 'approved') {
            publishContent = seoResult.optimizedMarkdown;
            break;
          }

          if (seoResult.decision === 'fail') {
            databaseService.updateArticleJob(article.id, { status: 'failed' });
            await this.notifyArticle(
              article,
              `❌ **SEO audit failed** — article does not meet minimum quality standards.\n` +
              seoResult.improvementSuggestions.map((s) => `  • ${s}`).join('\n')
            );
            return;
          }

          // decision === 'revise'
          if (attempt >= MAX_REVISIONS) {
            databaseService.updateArticleJob(article.id, { status: 'manual_review' });
            await this.notifyArticle(
              article,
              `⚠️ **Manual review required** — article failed SEO after ${MAX_REVISIONS} revision attempts.\n` +
              `ID: \`${article.id}\`\n` +
              seoResult.improvementSuggestions.map((s) => `  • ${s}`).join('\n')
            );
            return;
          }

          // Regenerate with SEO feedback
          const revisionNumber = attempt + 1;
          databaseService.updateArticleJob(article.id, {
            status: 'seo_revising',
            revisionCount: revisionNumber,
          });
          await this.notifyArticle(
            article,
            `🔄 **Revision ${revisionNumber}/${MAX_REVISIONS}** — rewriting to address SEO feedback…`
          );
          logger.info(`Article ${article.id}: revision ${revisionNumber}/${MAX_REVISIONS}`);

          const revisedDraft = await writerAiService.ask(
            articleRevisionPrompt(
              article.title,
              article.articleType,
              researchItems,
              currentDraft,
              seoResult.improvementSuggestions,
              config.amazon.affiliateTag
            ),
            WRITER_SYSTEM_PROMPT
          );

          const revisedMeta = await writerAiService.ask(
            seoMetaPrompt(article.title, revisedDraft),
            WRITER_SYSTEM_PROMPT
          );

          currentDraft = `${revisedDraft}\n\n---\n*Meta description: ${revisedMeta.trim()}*`;

          // Save revised draft and re-approve for SEO to pick up
          databaseService.updateArticleJob(article.id, {
            draftContent: currentDraft,
            status: 'approved',
          });
        }

        if (publishContent === null) {
          // Exhausted loop without resolving — shouldn't happen, but guard anyway
          databaseService.updateArticleJob(article.id, { status: 'manual_review' });
          await this.notifyArticle(article, `⚠️ **Manual review required** — SEO loop exhausted.\nID: \`${article.id}\``);
          return;
        }

        await this.publishArticle(article, publishContent);
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
      // RPD (daily quota) — put article back in queue, scheduled for after midnight
      if (
        error instanceof AIServiceError &&
        error.type === AIErrorType.RATE_LIMIT &&
        error.rateLimitType === RateLimitType.RPD
      ) {
        const resumeAt = new Date(Date.now() + (error.retryAfter ?? 0));
        databaseService.updateArticleJob(article.id, {
          status: 'pending_research',
          scheduledAfter: resumeAt.toISOString(),
        });
        logger.warn(`Article ${article.id} paused until ${resumeAt.toUTCString()} (RPD limit)`);
        await this.notifyArticle(
          article,
          `⏸️ **Article paused** — Gemini daily quota hit.\nWill resume after **${resumeAt.toUTCString()}**.`
        );
        return;
      }

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
  /**
   * Build the per-product research query from a discovered topic/category.
   *
   * If the topic looks like a specific product name (starts with a capital letter
   * and is short, e.g. "Herman Miller Aeron"), research it directly.
   * Otherwise frame it within the article context.
   */
  private buildResearchQuery(topic: string, articleTitle: string): string {
    const looksLikeProduct = /^[A-Z]/.test(topic) && topic.split(' ').length <= 5;
    return looksLikeProduct
      ? `${topic} review and specifications`
      : `Best ${topic} for ${articleTitle}`;
  }

  private notifyArticle(article: ArticleJob, message: string): Promise<void> {
    const targetId = article.discordThreadId ?? config.discord.writerChannelId;
    return discordService.sendNotification(message, targetId);
  }

}

export default ContentWriter;
