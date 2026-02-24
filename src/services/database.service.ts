import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

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
    `);
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

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    this.db?.close();
    this.db = null;
    logger.info('DatabaseService closed');
  }
}

export const databaseService = new DatabaseService();
