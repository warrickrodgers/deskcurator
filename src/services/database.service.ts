import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { QueueResearchJob, ArticleJob, ResearchJobStatus, ArticleJobStatus } from '../types/jobs';

const DB_PATH = path.join(process.cwd(), 'data', 'deskcurator.db');

interface ProductRow {
  id: string;
  name: string;
  category: string;
  price?: number;
  url: string;
  affiliate_link?: string;
  created_at: string;
}

interface ResearchJobRow {
  id: string;
  product_id: string;
  status: string;
  confidence_score?: number;
  search_query: string;
  started_at: string;
  completed_at?: string;
}

export class DatabaseService {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || DB_PATH;
  }

  initialize(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createTables();
    logger.info(`DatabaseService initialized at ${this.dbPath}`);
  }

  private get conn(): Database.Database {
    if (!this.db) throw new Error('DatabaseService not initialized — call initialize() first');
    return this.db;
  }

  private createTables(): void {
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL,
        url TEXT NOT NULL,
        affiliate_link TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS research_jobs (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
        confidence_score REAL,
        search_query TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      CREATE TABLE IF NOT EXISTS approval_history (
        id TEXT PRIMARY KEY,
        research_job_id TEXT NOT NULL,
        discord_message_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','needs_edit')),
        feedback TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        responded_at TEXT,
        FOREIGN KEY (research_job_id) REFERENCES research_jobs(id)
      );

      CREATE TABLE IF NOT EXISTS queue_research_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('product','category','comparison')),
        status TEXT NOT NULL CHECK(status IN ('pending','in_progress','awaiting_approval','approved','rejected','failed')),
        priority INTEGER NOT NULL DEFAULT 5,
        query TEXT NOT NULL,
        requested_by TEXT NOT NULL CHECK(requested_by IN ('writer','user')),
        parent_job_id TEXT,
        findings TEXT,
        discord_message_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        failure_reason TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3
      );

      CREATE TABLE IF NOT EXISTS article_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('pending_research','writing','awaiting_approval','approved','rejected','published','failed')),
        title TEXT NOT NULL,
        article_type TEXT NOT NULL CHECK(article_type IN ('single_product','multi_product','comparison','roundup')),
        research_job_ids TEXT NOT NULL DEFAULT '[]',
        required_research_count INTEGER NOT NULL DEFAULT 0,
        completed_research_count INTEGER NOT NULL DEFAULT 0,
        draft_content TEXT,
        final_content TEXT,
        discord_message_id TEXT,
        discord_thread_id TEXT,
        published_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        published_at TEXT
      );
    `);

    // Additive migrations — safe to run on existing DBs
    const migrations = [
      `ALTER TABLE article_jobs ADD COLUMN discord_thread_id TEXT`,
      `ALTER TABLE queue_research_jobs ADD COLUMN scheduled_after TEXT`,
      `ALTER TABLE article_jobs ADD COLUMN scheduled_after TEXT`,
    ];
    for (const sql of migrations) {
      try { this.conn.exec(sql); } catch { /* column already exists */ }
    }
  }

  // ── Products ──────────────────────────────────────────────────────────────

  insertProduct(product: {
    id: string;
    name: string;
    category: string;
    price?: number;
    url: string;
    affiliateLink?: string;
  }): void {
    this.conn
      .prepare(
        `INSERT OR REPLACE INTO products (id, name, category, price, url, affiliate_link)
         VALUES (@id, @name, @category, @price, @url, @affiliateLink)`
      )
      .run({ ...product, price: product.price ?? null, affiliateLink: product.affiliateLink ?? null });
  }

  getProductById(id: string): ProductRow | undefined {
    return this.conn
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(id) as ProductRow | undefined;
  }

  // ── Research Jobs ─────────────────────────────────────────────────────────

  insertResearchJob(job: {
    id: string;
    productId: string;
    status: string;
    searchQuery: string;
  }): void {
    this.conn
      .prepare(
        `INSERT INTO research_jobs (id, product_id, status, search_query)
         VALUES (@id, @productId, @status, @searchQuery)`
      )
      .run(job);
  }

  updateResearchJobStatus(id: string, status: string, confidenceScore?: number): void {
    this.conn
      .prepare(
        `UPDATE research_jobs
         SET status = ?, confidence_score = ?, completed_at = datetime('now')
         WHERE id = ?`
      )
      .run(status, confidenceScore ?? null, id);
  }

  getResearchJobById(id: string): ResearchJobRow | undefined {
    return this.conn
      .prepare('SELECT * FROM research_jobs WHERE id = ?')
      .get(id) as ResearchJobRow | undefined;
  }

  // ── Approval History ──────────────────────────────────────────────────────

  insertApprovalRecord(record: {
    id: string;
    researchJobId: string;
    status: string;
    discordMessageId?: string;
  }): void {
    this.conn
      .prepare(
        `INSERT INTO approval_history (id, research_job_id, status, discord_message_id)
         VALUES (@id, @researchJobId, @status, @discordMessageId)`
      )
      .run({ ...record, discordMessageId: record.discordMessageId ?? null });
  }

  updateApprovalStatus(id: string, status: string, feedback?: string): void {
    this.conn
      .prepare(
        `UPDATE approval_history
         SET status = ?, feedback = ?, responded_at = datetime('now')
         WHERE id = ?`
      )
      .run(status, feedback ?? null, id);
  }

  // ── Queue Research Jobs ───────────────────────────────────────────────────

  createQueueResearchJob(job: {
    id: string;
    type: QueueResearchJob['type'];
    query: string;
    requestedBy: QueueResearchJob['requestedBy'];
    parentJobId?: string;
    priority?: number;
    maxRetries?: number;
  }): void {
    this.conn
      .prepare(
        `INSERT INTO queue_research_jobs
           (id, type, status, priority, query, requested_by, parent_job_id, retry_count, max_retries)
         VALUES (@id, @type, 'pending', @priority, @query, @requestedBy, @parentJobId, 0, @maxRetries)`
      )
      .run({
        ...job,
        priority: job.priority ?? 5,
        parentJobId: job.parentJobId ?? null,
        maxRetries: job.maxRetries ?? 3,
      });
  }

  updateQueueResearchJob(
    id: string,
    fields: Partial<{
      status: ResearchJobStatus;
      findings: string;
      discordMessageId: string;
      startedAt: string;
      completedAt: string;
      failureReason: string;
      retryCount: number;
      scheduledAfter: string;
    }>
  ): void {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (fields.status !== undefined) { setClauses.push('status = @status'); params.status = fields.status; }
    if (fields.findings !== undefined) { setClauses.push('findings = @findings'); params.findings = fields.findings; }
    if (fields.discordMessageId !== undefined) { setClauses.push('discord_message_id = @discordMessageId'); params.discordMessageId = fields.discordMessageId; }
    if (fields.startedAt !== undefined) { setClauses.push('started_at = @startedAt'); params.startedAt = fields.startedAt; }
    if (fields.completedAt !== undefined) { setClauses.push('completed_at = @completedAt'); params.completedAt = fields.completedAt; }
    if (fields.failureReason !== undefined) { setClauses.push('failure_reason = @failureReason'); params.failureReason = fields.failureReason; }
    if (fields.retryCount !== undefined) { setClauses.push('retry_count = @retryCount'); params.retryCount = fields.retryCount; }
    if (fields.scheduledAfter !== undefined) { setClauses.push('scheduled_after = @scheduledAfter'); params.scheduledAfter = fields.scheduledAfter; }

    if (setClauses.length === 0) return;
    this.conn.prepare(`UPDATE queue_research_jobs SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  }

  private static readonly QUEUE_JOB_COLS = `
    id, type, status, priority, query,
    requested_by   AS requestedBy,
    parent_job_id  AS parentJobId,
    findings,
    discord_message_id AS discordMessageId,
    created_at     AS createdAt,
    started_at     AS startedAt,
    completed_at   AS completedAt,
    failure_reason AS failureReason,
    retry_count    AS retryCount,
    max_retries    AS maxRetries,
    scheduled_after AS scheduledAfter
  `;

  getNextPendingResearchJob(): QueueResearchJob | undefined {
    return this.conn
      .prepare(
        `SELECT ${DatabaseService.QUEUE_JOB_COLS}
         FROM queue_research_jobs
         WHERE status = 'pending'
           AND (scheduled_after IS NULL OR scheduled_after <= datetime('now'))
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`
      )
      .get() as QueueResearchJob | undefined;
  }

  /**
   * Reset stale in_progress jobs whose started_at exceeds the given threshold.
   * Jobs with retries remaining are returned to 'pending'; those without are marked 'failed'.
   * Returns the number of jobs recovered.
   */
  recoverStaleInProgressJobs(thresholdMinutes = 30): number {
    const threshold = `datetime('now', '-${thresholdMinutes} minutes')`;
    const retried = this.conn
      .prepare(
        `UPDATE queue_research_jobs
         SET status = 'pending',
             retry_count = retry_count + 1,
             failure_reason = 'Job timed out — recovered after stale threshold'
         WHERE status = 'in_progress'
           AND started_at < ${threshold}
           AND retry_count < max_retries`
      )
      .run();
    const exhausted = this.conn
      .prepare(
        `UPDATE queue_research_jobs
         SET status = 'failed',
             completed_at = datetime('now'),
             failure_reason = 'Job timed out — no retries remaining'
         WHERE status = 'in_progress'
           AND started_at < ${threshold}
           AND retry_count >= max_retries`
      )
      .run();
    return (retried.changes ?? 0) + (exhausted.changes ?? 0);
  }

  getQueueResearchJobsByIds(ids: string[]): QueueResearchJob[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.conn
      .prepare(
        `SELECT ${DatabaseService.QUEUE_JOB_COLS}
         FROM queue_research_jobs
         WHERE id IN (${placeholders})`
      )
      .all(...ids) as QueueResearchJob[];
  }

  getQueueResearchJobById(id: string): QueueResearchJob | undefined {
    return this.conn
      .prepare(
        `SELECT ${DatabaseService.QUEUE_JOB_COLS}
         FROM queue_research_jobs
         WHERE id = ?`
      )
      .get(id) as QueueResearchJob | undefined;
  }

  // ── Article Jobs ──────────────────────────────────────────────────────────

  createArticleJob(job: {
    id: string;
    title: string;
    articleType: ArticleJob['articleType'];
    status: ArticleJobStatus;
    requiredResearchCount?: number;
  }): void {
    this.conn
      .prepare(
        `INSERT INTO article_jobs (id, status, title, article_type, required_research_count)
         VALUES (@id, @status, @title, @articleType, @requiredResearchCount)`
      )
      .run({ ...job, requiredResearchCount: job.requiredResearchCount ?? 0 });
  }

  updateArticleJob(
    id: string,
    fields: Partial<{
      status: ArticleJobStatus;
      researchJobIds: string;
      requiredResearchCount: number;
      draftContent: string;
      finalContent: string;
      discordMessageId: string;
      discordThreadId: string;
      publishedUrl: string;
      completedAt: string;
      publishedAt: string;
      scheduledAfter: string;
    }>
  ): void {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (fields.status !== undefined) { setClauses.push('status = @status'); params.status = fields.status; }
    if (fields.researchJobIds !== undefined) { setClauses.push('research_job_ids = @researchJobIds'); params.researchJobIds = fields.researchJobIds; }
    if (fields.requiredResearchCount !== undefined) { setClauses.push('required_research_count = @requiredResearchCount'); params.requiredResearchCount = fields.requiredResearchCount; }
    if (fields.draftContent !== undefined) { setClauses.push('draft_content = @draftContent'); params.draftContent = fields.draftContent; }
    if (fields.finalContent !== undefined) { setClauses.push('final_content = @finalContent'); params.finalContent = fields.finalContent; }
    if (fields.discordMessageId !== undefined) { setClauses.push('discord_message_id = @discordMessageId'); params.discordMessageId = fields.discordMessageId; }
    if (fields.discordThreadId !== undefined) { setClauses.push('discord_thread_id = @discordThreadId'); params.discordThreadId = fields.discordThreadId; }
    if (fields.publishedUrl !== undefined) { setClauses.push('published_url = @publishedUrl'); params.publishedUrl = fields.publishedUrl; }
    if (fields.completedAt !== undefined) { setClauses.push('completed_at = @completedAt'); params.completedAt = fields.completedAt; }
    if (fields.publishedAt !== undefined) { setClauses.push('published_at = @publishedAt'); params.publishedAt = fields.publishedAt; }
    if (fields.scheduledAfter !== undefined) { setClauses.push('scheduled_after = @scheduledAfter'); params.scheduledAfter = fields.scheduledAfter; }

    if (setClauses.length === 0) return;
    this.conn.prepare(`UPDATE article_jobs SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  }

  private static readonly ARTICLE_JOB_COLS = `
    id, status, title,
    article_type               AS articleType,
    research_job_ids           AS researchJobIds,
    required_research_count    AS requiredResearchCount,
    completed_research_count   AS completedResearchCount,
    draft_content              AS draftContent,
    final_content              AS finalContent,
    discord_message_id         AS discordMessageId,
    discord_thread_id          AS discordThreadId,
    published_url              AS publishedUrl,
    created_at                 AS createdAt,
    completed_at               AS completedAt,
    published_at               AS publishedAt,
    scheduled_after            AS scheduledAfter
  `;

  getArticleJobsByStatus(status: ArticleJobStatus): ArticleJob[] {
    return this.conn
      .prepare(
        `SELECT ${DatabaseService.ARTICLE_JOB_COLS}
         FROM article_jobs
         WHERE status = ?
           AND (scheduled_after IS NULL OR scheduled_after <= datetime('now'))`
      )
      .all(status) as ArticleJob[];
  }

  getArticleJobById(id: string): ArticleJob | undefined {
    return this.conn
      .prepare(
        `SELECT ${DatabaseService.ARTICLE_JOB_COLS}
         FROM article_jobs
         WHERE id = ?`
      )
      .get(id) as ArticleJob | undefined;
  }

  getAllArticleJobs(): ArticleJob[] {
    return this.conn
      .prepare(
        `SELECT ${DatabaseService.ARTICLE_JOB_COLS}
         FROM article_jobs
         ORDER BY created_at DESC`
      )
      .all() as ArticleJob[];
  }

  incrementArticleResearchCount(articleId: string): void {
    this.conn
      .prepare(
        `UPDATE article_jobs SET completed_research_count = completed_research_count + 1 WHERE id = ?`
      )
      .run(articleId);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    this.db?.close();
    this.db = null;
    logger.info('DatabaseService closed');
  }
}

export const databaseService = new DatabaseService();
