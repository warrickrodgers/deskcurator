# 🏗️ Queue-Based Architecture Design

**Phase:** Phase 2 - Content Writer with Queue System  
**Purpose:** Enable multi-product articles with parallel research workflows  
**Created:** January 13, 2026

---

## 🎯 Vision: Multi-Product Article Example (Hybrid Approach)

**User Command:**
```
!write "5 Best Desk Items For Your WFH Setup"
```

**System Workflow (Hybrid: Sync Initial + Queue Parallel):**
1. Writer Agent receives request
2. Writer calls Researcher **SYNCHRONOUSLY**: "Find top 5 WFH desk product categories"
3. Researcher does research → Posts to Discord for approval
4. Admin approves → Returns: [Standing Desks, Ergonomic Chairs, Monitor Arms, Desk Lamps, Keyboard Trays]
5. Writer now has categories, creates **5 parallel Research Jobs** in database:
   - Job #1: Research best standing desk
   - Job #2: Research best ergonomic chair
   - Job #3: Research best monitor arm
   - Job #4: Research best desk lamp
   - Job #5: Research best keyboard tray
6. Writer creates ArticleJob in database (status: waiting_for_research)
7. Researcher polls database, picks up jobs, processes them
8. Each job posts to Discord for approval independently
9. Writer polls database, waiting for all 5 research jobs to be approved
10. Once all approved, Writer generates final article with all 5 products + affiliate links
11. Final article posted to Discord for approval
12. Publish!

**Why This Hybrid Approach?**
- ✅ **Fast Initial Discovery:** Synchronous call gets categories immediately, no polling delay
- ✅ **Efficient Parallel Research:** Queue-based allows 5 products to be researched independently
- ✅ **Resumable:** If bot crashes during parallel research, jobs persist
- ✅ **Better UX:** User sees category results quickly, then parallel research begins
- ✅ **Flexible:** Can do sync calls for fast decisions, queue for long-running parallel work

---

## 📊 Database Schema

### ResearchJob Table
```typescript
interface ResearchJob {
  id: string;                          // UUID
  type: 'product' | 'category' | 'comparison';
  status: 'pending' | 'in_progress' | 'awaiting_approval' | 'approved' | 'rejected' | 'completed' | 'failed';
  priority: number;                    // 1-10, higher = more urgent
  
  // Request details
  query: string;                       // "best standing desk for WFH"
  category?: string;                   // "desk equipment"
  additionalContext?: string;          // Extra instructions for researcher
  
  // Relationships
  requestedBy: 'writer' | 'user';      // Who requested this research
  parentJobId?: string;                // If part of multi-job article
  relatedJobIds?: string[];            // Other jobs in same article
  
  // Results
  findings?: ResearchFindings;         // Populated when complete
  discordMessageId?: string;           // For tracking approval message
  
  // Metadata
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
  retryCount: number;
  maxRetries: number;
}
```

### ArticleJob Table
```typescript
interface ArticleJob {
  id: string;                          // UUID
  status: 'pending_research' | 'research_complete' | 'writing' | 'awaiting_approval' | 'approved' | 'rejected' | 'published' | 'failed';
  
  // Article details
  title: string;                       // "5 Best Desk Items For Your WFH Setup"
  articleType: 'single_product' | 'multi_product' | 'comparison' | 'roundup';
  targetWordCount?: number;
  
  // Research tracking
  researchJobIds: string[];            // All research jobs for this article
  requiredResearchCount: number;       // How many research jobs needed
  completedResearchCount: number;      // How many are done
  
  // Content
  outline?: string;                    // Article structure
  draftContent?: string;               // Generated article
  finalContent?: string;               // After edits
  
  // Publishing
  discordMessageId?: string;           // Approval message
  publishedUrl?: string;               // Where it was published
  
  // Metadata
  createdAt: Date;
  completedAt?: Date;
  publishedAt?: Date;
}
```

---

## 🔄 Agent Workflows

### Writer Agent Workflow (Hybrid Approach)

```typescript
// src/agents/ContentWriter.ts

class ContentWriter {
  
  async createArticle(request: ArticleRequest): Promise<void> {
    try {
      logger.info(`Starting article: "${request.title}"`);
      
      // PHASE 1: SYNCHRONOUS - Get initial research to make decisions
      logger.info('Phase 1: Initial discovery (synchronous)...');
      const initialResearch = await this.contentResearcher.research({
        query: `Find top ${request.productCount} product categories for: ${request.topic}`,
        type: 'category',
      });
      
      // Request approval for initial research
      const initialApproval = await discord.requestApproval({
        type: 'research',
        data: initialResearch,
      });
      
      if (!initialApproval.approved) {
        logger.info('Initial research rejected, aborting article');
        return;
      }
      
      // Extract categories from research
      const categories = this.extractCategories(initialResearch);
      logger.info(`Found ${categories.length} categories: ${categories.join(', ')}`);
      
      // PHASE 2: ASYNCHRONOUS - Queue parallel research jobs
      logger.info('Phase 2: Creating parallel research jobs...');
      
      // Create article job
      const articleJob = await db.createArticleJob({
        title: request.title,
        articleType: 'multi_product',
        status: 'pending_research',
      });
      
      // Create research jobs for each category
      const researchJobs = await Promise.all(
        categories.map(category => 
          db.createResearchJob({
            query: `Find the best ${category} for ${request.topic}`,
            type: 'product',
            parentJobId: articleJob.id,
            requestedBy: 'writer',
            priority: 7, // High priority for active article
          })
        )
      );
      
      // Link research jobs to article
      await db.updateArticleJob(articleJob.id, {
        researchJobIds: researchJobs.map(j => j.id),
        requiredResearchCount: researchJobs.length,
      });
      
      // Notify Discord
      await discord.sendNotification(
        `📝 Article: "${request.title}"\n` +
        `✅ Initial research complete: ${categories.length} categories found\n` +
        `🔍 Queued ${researchJobs.length} product research jobs\n` +
        `⏳ Waiting for research to complete...`
      );
      
      logger.info(`Article ${articleJob.id} waiting for ${researchJobs.length} research jobs`);
      
    } catch (error) {
      logger.error('Failed to create article:', error);
      throw error;
    }
  }
  
  // Polling loop - runs continuously
  async pollForCompletedResearch(): Promise<void> {
    logger.info('Starting article polling loop...');
    
    while (true) {
      try {
        // Find articles waiting for research
        const pendingArticles = await db.getArticleJobs({
          status: 'pending_research',
        });
        
        for (const article of pendingArticles) {
          // Check if all research is done
          const researchJobs = await db.getResearchJobs({
            ids: article.researchJobIds,
          });
          
          const allApproved = researchJobs.every(
            job => job.status === 'approved'
          );
          
          if (allApproved) {
            logger.info(`All research complete for article ${article.id}, starting writing...`);
            await this.writeArticle(article, researchJobs);
          } else {
            const completed = researchJobs.filter(j => j.status === 'approved').length;
            logger.debug(
              `Article ${article.id}: ${completed}/${researchJobs.length} research jobs complete`
            );
          }
        }
        
      } catch (error) {
        logger.error('Error in article polling loop:', error);
      }
      
      // Poll every 10 seconds
      await sleep(10000);
    }
  }
  
  private async writeArticle(
    article: ArticleJob,
    research: ResearchJob[]
  ): Promise<void> {
    try {
      // Update status
      await db.updateArticleJob(article.id, {
        status: 'writing',
      });
      
      logger.info(`Writing article ${article.id}...`);
      
      // Generate content using AI with all research findings
      const content = await aiService.generateArticle({
        title: article.title,
        productCount: research.length,
        research: research.map(r => r.findings),
        includeAffiliateLinks: true,
      });
      
      // Save draft
      await db.updateArticleJob(article.id, {
        draftContent: content,
        status: 'awaiting_approval',
      });
      
      logger.info(`Article ${article.id} draft complete, requesting approval...`);
      
      // Request approval
      const approval = await discord.requestApproval({
        type: 'content',
        data: content,
      });
      
      if (approval.approved) {
        logger.info(`Article ${article.id} approved, publishing...`);
        await this.publishArticle(article.id, content);
      } else {
        logger.info(`Article ${article.id} rejected`);
        await db.updateArticleJob(article.id, {
          status: 'rejected',
        });
        
        if (approval.feedback) {
          // TODO: Handle revision requests
          logger.info(`Feedback received: ${approval.feedback}`);
        }
      }
      
    } catch (error) {
      logger.error(`Failed to write article ${article.id}:`, error);
      await db.updateArticleJob(article.id, {
        status: 'failed',
      });
    }
  }
  
  private async publishArticle(articleId: string, content: string): Promise<void> {
    // TODO: Implement actual publishing logic
    logger.info(`Publishing article ${articleId}...`);
    
    await db.updateArticleJob(articleId, {
      status: 'published',
      publishedAt: new Date(),
      finalContent: content,
    });
    
    await discord.sendNotification(
      `🎉 Article published successfully!\n` +
      `Article ID: ${articleId}`
    );
  }
  
  private extractCategories(research: ResearchFindings): string[] {
    // Parse AI response to extract category list
    // This would use the AI's structured output or parse from summary
    // For now, simplified example:
    const summary = research.summary;
    // Extract categories from summary text
    // TODO: Implement robust category extraction
    return ['Standing Desk', 'Ergonomic Chair', 'Monitor Arm', 'Desk Lamp', 'Keyboard Tray'];
  }
}
```

### Researcher Agent Workflow

```typescript
// src/agents/ContentResearcher.ts

class ContentResearcher {
  
  // Polling loop - runs continuously
  async pollForPendingJobs(): Promise<void> {
    while (true) {
      // Find highest priority pending job
      const job = await db.getNextResearchJob({
        status: 'pending',
        orderBy: 'priority DESC',
        limit: 1,
      });
      
      if (job) {
        await this.processResearchJob(job);
      }
      
      // Poll every 5 seconds
      await sleep(5000);
    }
  }
  
  private async processResearchJob(job: ResearchJob): Promise<void> {
    try {
      // Mark as in progress
      await db.updateResearchJob(job.id, {
        status: 'in_progress',
        startedAt: new Date(),
      });
      
      // Do the actual research
      const findings = await this.conductResearch(job.query, job.type);
      
      // Save findings
      await db.updateResearchJob(job.id, {
        findings,
        status: 'awaiting_approval',
      });
      
      // Request approval
      const approval = await discord.requestApproval({
        type: 'research',
        data: findings,
      });
      
      if (approval.approved) {
        await db.updateResearchJob(job.id, {
          status: 'approved',
          completedAt: new Date(),
        });
        
        // Increment completed count on parent article
        if (job.parentJobId) {
          await db.incrementArticleResearchCount(job.parentJobId);
        }
      } else {
        await db.updateResearchJob(job.id, {
          status: 'rejected',
        });
      }
      
    } catch (error) {
      logger.error(`Research job ${job.id} failed:`, error);
      
      // Retry logic
      if (job.retryCount < job.maxRetries) {
        await db.updateResearchJob(job.id, {
          status: 'pending',
          retryCount: job.retryCount + 1,
        });
      } else {
        await db.updateResearchJob(job.id, {
          status: 'failed',
          failureReason: error.message,
        });
      }
    }
  }
}
```

---

## 🗄️ Database Choice

### Phase 2 Options:

**Option 1: SQLite (Recommended for MVP)**
- ✅ Simple, file-based, no server needed
- ✅ Perfect for single-instance bot
- ✅ Easy to backup (just copy .db file)
- ✅ TypeScript support via `better-sqlite3`
- ❌ Not great for multiple bot instances

**Option 2: PostgreSQL (Production-ready)**
- ✅ Robust, proven, widely used
- ✅ Great for scaling to multiple bots
- ✅ Advanced querying capabilities
- ❌ Requires separate database server
- ❌ More complex setup

**Option 3: In-Memory + File Persistence (Quick Start)**
- ✅ Zero dependencies initially
- ✅ Use Map/Array in memory
- ✅ Serialize to JSON file periodically
- ❌ Not production-ready
- ❌ Can lose data on crash

**Recommendation:** Start with **SQLite**, easy migration to PostgreSQL later.

---

## 📁 File Structure

```
src/
├── agents/
│   ├── ContentResearcher.ts      # Polls for research jobs
│   └── ContentWriter.ts          # Polls for completed research
│
├── services/
│   ├── database.ts               # Database connection & queries
│   ├── jobQueue.ts               # Job queue management
│   └── anthropic.ts              # AI service (existing)
│
├── models/
│   ├── ResearchJob.ts            # ResearchJob type & methods
│   └── ArticleJob.ts             # ArticleJob type & methods
│
├── database/
│   ├── schema.sql                # Database schema
│   ├── migrations/               # Schema migrations
│   └── seeds/                    # Test data
│
└── types/
    └── jobs.ts                   # Job-related types
```

---

## 🚀 Implementation Plan

### Step 1: Database Setup
- [ ] Choose database (SQLite recommended)
- [ ] Create schema for ResearchJob and ArticleJob
- [ ] Build database service with CRUD operations
- [ ] Add migration system

### Step 2: Job Queue System
- [ ] Implement job creation
- [ ] Implement job status updates
- [ ] Add polling mechanism
- [ ] Add priority queuing

### Step 3: Update Researcher Agent
- [ ] Add polling loop for pending jobs
- [ ] Process jobs from database instead of direct calls
- [ ] Update job status throughout workflow
- [ ] Handle retries and failures

### Step 4: Build Writer Agent
- [ ] Research planning logic (multi-step)
- [ ] Create research jobs in database
- [ ] Poll for completed research
- [ ] Generate article when all research ready
- [ ] Article approval workflow

### Step 5: Discord Commands
- [ ] `!research <query>` - Manual research job
- [ ] `!write <title>` - Create article job
- [ ] `!status` - Show pending/active jobs
- [ ] `!cancel <job-id>` - Cancel job

---

## 🎯 Example: "5 Desk Items" Article Flow (Hybrid)

```
T+0s:  User: "!write 5 Best Desk Items For Your WFH Setup"
T+1s:  Writer: Starts article creation

// PHASE 1: SYNCHRONOUS - Initial Discovery
T+2s:  Writer: Calls Researcher DIRECTLY (synchronous)
       Query: "Find top 5 WFH desk product categories"
T+10s: Researcher: Completes research
T+11s: Discord: "@Admin - Category research complete [Approve/Reject]"
T+15s: Admin: Clicks "Approve"
T+16s: Writer: Receives categories: [Standing Desks, Chairs, Monitor Arms, Lamps, Keyboards]

// PHASE 2: ASYNCHRONOUS - Parallel Product Research
T+17s: Writer: Creates ArticleJob (ID: art-123, status: pending_research)
T+18s: Writer: Creates 5 ResearchJobs in database:
       - res-001: "Best standing desk for WFH" (status: pending)
       - res-002: "Best ergonomic chair for WFH" (status: pending)
       - res-003: "Best monitor arm for WFH" (status: pending)
       - res-004: "Best desk lamp for WFH" (status: pending)
       - res-005: "Best keyboard tray for WFH" (status: pending)

T+19s: Discord: "✅ Initial research complete: 5 categories found"
              "🔍 Queued 5 product research jobs"
              "⏳ Waiting for research to complete..."

// Researcher polls database every 5 seconds, picks up jobs
T+20s: Researcher: Picks up res-001 (standing desk)
T+35s: Researcher: Completes res-001, requests approval
T+36s: Discord: "@Admin - Standing desk research complete [Approve/Reject]"
T+40s: Admin: Approves
T+41s: Database: res-001 status → approved, art-123 completedCount → 1/5

T+45s: Researcher: Picks up res-002 (chair)
T+60s: Researcher: Completes res-002, requests approval
T+61s: Discord: "@Admin - Ergonomic chair research complete [Approve/Reject]"
T+65s: Admin: Approves
T+66s: Database: res-002 status → approved, art-123 completedCount → 2/5

... (process continues for res-003, res-004, res-005) ...

// PHASE 3: ARTICLE WRITING - Once all research approved
T+5m:  Database: All 5 research jobs approved (art-123 completedCount → 5/5)
T+5m:  Writer (polling): Detects all research complete for art-123
T+5m:  Writer: Updates art-123 status → writing
T+6m:  Writer: Generates full article using AI + all 5 research findings
T+7m:  Writer: Saves draft, updates art-123 status → awaiting_approval
T+7m:  Discord: "@Admin - Article draft ready [Approve/Reject/Edit]"
       Shows: Full article with all 5 products + affiliate links
T+10m: Admin: Approves
T+10m: Writer: Updates art-123 status → published
T+10m: Writer: Publishes article
T+10m: Discord: "🎉 Article published successfully!"
```

**Key Points:**
- Initial discovery is **synchronous** (fast decision making)
- Parallel research is **asynchronous** via database queue (resumable, trackable)
- Writer polls database, not blocked during parallel research
- Admin approves each research job independently as they complete
- Final article generation happens only when ALL research approved

---

## 💡 Key Benefits

1. **Hybrid Flexibility:** Fast synchronous calls for decisions, async queue for parallel work
2. **Parallel Processing:** Multiple research jobs can run simultaneously  
3. **Resumable:** If bot crashes, queued jobs persist in database
4. **Trackable:** Clear status for every job
5. **Flexible:** Easy to add new job types
6. **Scalable:** Can add more researcher instances
7. **Auditable:** Full history of all jobs
8. **Better UX:** Users see initial results fast, then parallel work happens in background

---

## 🤔 When to Use Sync vs Async

### Use **Synchronous** (Direct Call) When:
- ✅ Need immediate result to make next decision (e.g., "what categories should I research?")
- ✅ Single sequential research task
- ✅ Writer needs to wait anyway before proceeding
- ✅ Fast operation (<30 seconds expected)
- ✅ Planning/discovery phase

**Example:** Writer needs categories before knowing what products to research

### Use **Asynchronous** (Queue) When:
- ✅ Multiple independent tasks that can run in parallel
- ✅ Long-running research (>1 minute)
- ✅ Want system to be resumable if crash occurs
- ✅ Don't need results immediately
- ✅ Want to track progress independently per task

**Example:** Researching 5 different products simultaneously

### The Pattern:
```
Sync: Planning/Discovery (What do I need to do?)
  ↓
Async: Parallel Execution (Do all the things!)
  ↓
Sync: Final Assembly (Put it all together)
```

---

## 🔮 Future Enhancements

- **Job Prioritization:** VIP articles get higher priority
- **Scheduled Jobs:** "Research this every Monday"
- **Job Dependencies:** "Don't start Job B until Job A completes"
- **Batch Processing:** Process multiple low-priority jobs together
- **Analytics:** Track average research time, success rates
- **Web Dashboard:** View all jobs in browser UI

---

This architecture will let you build sophisticated multi-product articles while keeping the system manageable and scalable! 🚀