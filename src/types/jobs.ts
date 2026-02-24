export type ResearchJobStatus =
  | 'pending'
  | 'in_progress'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'failed';

export type ArticleJobStatus =
  | 'pending_research'
  | 'writing'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'published'
  | 'failed';

export type ResearchJobType = 'product' | 'category' | 'comparison';

export type ArticleType = 'single_product' | 'multi_product' | 'comparison' | 'roundup';

export interface QueueResearchJob {
  id: string;
  type: ResearchJobType;
  status: ResearchJobStatus;
  priority: number;
  query: string;
  requestedBy: 'writer' | 'user';
  parentJobId?: string;
  /** JSON-serialized ResearchFindings */
  findings?: string;
  discordMessageId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  retryCount: number;
  maxRetries: number;
}

export interface ArticleJob {
  id: string;
  status: ArticleJobStatus;
  title: string;
  articleType: ArticleType;
  /** JSON-serialized string[] of QueueResearchJob ids */
  researchJobIds: string;
  requiredResearchCount: number;
  completedResearchCount: number;
  draftContent?: string;
  finalContent?: string;
  discordMessageId?: string;
  discordThreadId?: string;
  publishedUrl?: string;
  createdAt: string;
  completedAt?: string;
  publishedAt?: string;
}

export interface ArticleRequest {
  title: string;
  articleType: ArticleType;
  /** Number of products to research — defaults to 5 for multi_product */
  productCount?: number;
}
