import { randomUUID } from 'crypto';
import { databaseService } from './database.service';
import { QueueResearchJob, ArticleJob, ArticleJobStatus, ArticleType, ResearchJobType } from '../types/jobs';

export interface EnqueueResearchParams {
  query: string;
  type?: ResearchJobType;
  parentJobId?: string;
  priority?: number;
  requestedBy?: QueueResearchJob['requestedBy'];
  maxRetries?: number;
}

export interface CreateArticleParams {
  title: string;
  articleType: ArticleType;
  status?: ArticleJobStatus;
  requiredResearchCount?: number;
}

export class JobQueueService {
  /**
   * Create a new research job in the queue and return its id.
   */
  enqueueResearch(params: EnqueueResearchParams): string {
    const id = randomUUID();
    databaseService.createQueueResearchJob({
      id,
      type: params.type ?? 'product',
      query: params.query,
      requestedBy: params.requestedBy ?? 'writer',
      parentJobId: params.parentJobId,
      priority: params.priority ?? 7,
      maxRetries: params.maxRetries ?? 3,
    });
    return id;
  }

  /**
   * Atomically fetch the next pending job and mark it in_progress.
   * Returns undefined if the queue is empty.
   */
  dequeueNext(): QueueResearchJob | undefined {
    const job = databaseService.getNextPendingResearchJob();
    if (!job) return undefined;

    databaseService.updateQueueResearchJob(job.id, {
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    });

    // Re-fetch to return the updated row
    return databaseService.getQueueResearchJobById(job.id);
  }

  /**
   * Create a new article job and return its id.
   */
  createArticle(params: CreateArticleParams): string {
    const id = randomUUID();
    databaseService.createArticleJob({
      id,
      title: params.title,
      articleType: params.articleType,
      status: params.status ?? 'pending_research',
      requiredResearchCount: params.requiredResearchCount ?? 0,
    });
    return id;
  }

  getArticleJob(id: string): ArticleJob | undefined {
    return databaseService.getArticleJobById(id);
  }

  getQueueResearchJob(id: string): QueueResearchJob | undefined {
    return databaseService.getQueueResearchJobById(id);
  }
}

export const jobQueueService = new JobQueueService();
