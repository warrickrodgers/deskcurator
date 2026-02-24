# DeskCurator Development Roadmap

**Current Phase:** Phase 2 - Product Research & Storage COMPLETE
**Next Phase:** Phase 3 - Content Writer Agent
**Last Updated:** February 23, 2026

---

## Phase 0: Foundation COMPLETE

### Infrastructure
- [x] TypeScript configuration
- [x] Discord bot setup with interactive buttons
- [x] Environment configuration with validation (Zod)
- [x] Logger utility with file output (Winston)
- [x] Type definitions
- [x] Project structure
- [x] Bot successfully connects and sends notifications

**Status:** Bot is operational and ready for feature development

---

## Phase 1: AI Integration COMPLETE

**Objective:** Enable AI-powered content generation and analysis

### 1.1 AI Providers
- [x] Gemini provider (`src/services/gemini.provider.ts`) — streaming, error handling, retries
- [x] Anthropic/Claude provider (`src/services/anthropic.provider.ts`) — streaming support
- [x] Shared `IAIProvider` interface — providers are interchangeable
- [x] Active provider switchable via `config.ai.provider` (currently Gemini `gemini-2.5-flash`)

### 1.2 AI Service (`src/services/ai.service.ts`)
- [x] Provider selection and initialization
- [x] Rate limiting (token bucket, configurable per provider)
- [x] Exponential backoff retry logic (`src/utils/retry.ts`)
- [x] Token usage tracking across providers
- [x] Streaming and non-streaming completion support
- [x] Simple `ask()` helper for single-turn prompts

### 1.3 Prompt Templates (`src/agents/content-researcher/context/`)
- [x] System prompt for ContentResearcher agent
- [x] Pros/cons analysis prompt
- [x] Competitor analysis prompt
- [x] Affiliate summary generation prompt

### 1.4 AI Service Testing
- [x] Logger utility tests (`tests/utils/logger.test.ts`)
- [x] RateLimiter unit tests (`tests/utils/rateLimiter.test.ts`)
- [x] Application startup/shutdown integration tests (`tests/index.test.ts`)

**Deliverables:** Working AI service with dual-provider support, rate limiting, retries, and token tracking

---

## Phase 2: Product Research & Storage COMPLETE

**Objective:** Enable automated product research and data persistence

> **Approach change:** Amazon Product Advertising API / web scraping replaced with
> Tavily AI search API — faster to ship, no scraping maintenance, better result quality.

### 2.1 Web Search (`src/services/search.service.ts`)
- [x] Tavily API integration
- [x] Three parallel searches per product: general info, reviews, competitors
- [x] Result count and source tracking

### 2.2 ContentResearcher Agent (`src/agents/content-researcher/ContentResearcher.ts`)
- [x] End-to-end research pipeline (search → AI analysis → findings)
- [x] Semantic deduplication via ChromaDB (skip recently researched products)
- [x] Multi-source web search (info + review + competitor results)
- [x] AI-powered pros/cons analysis
- [x] AI-powered competitor analysis
- [x] Affiliate summary generation
- [x] Confidence scoring
- [x] Discord approval flow integration

### 2.3 Vector Storage — ChromaDB (`src/services/chroma.service.ts`)
- [x] ChromaDB client with cosine similarity collection
- [x] Gemini embedding generation (`gemini-embedding-001`)
- [x] Research deduplication at 0.85 similarity threshold
- [x] Store completed research embeddings for future dedup lookups

### 2.4 Relational Storage — SQLite (`src/services/database.service.ts`)
- [x] SQLite via `better-sqlite3`
- [x] Products, research jobs, and approval history tables
- [x] Persistent job state across restarts

### 2.5 Discord Bot Commands
- [x] `!research <product>` command triggers full research workflow
- [x] Interactive approval buttons (Approve / Request Changes)
- [x] Research result notifications in configured channel
- [x] Admin-only command gating

**Deliverables:** Fully operational research bot — takes a product name in Discord, researches it, and returns AI-analyzed findings with an approval flow

---

## Phase 3: Content Writer Agent (Hybrid Queue-Based) 🎯 NEXT

**Objective:** Generate multi-product affiliate content with queue-based parallel research

> **Architecture:** Hybrid approach — synchronous initial discovery + asynchronous parallel research queue

### 3.1 Database Schema Extensions (`src/services/database.service.ts`)
- [ ] Add `research_jobs` table (id, type, status, query, findings, parentJobId, priority, etc.)
- [ ] Add `article_jobs` table (id, title, type, status, researchJobIds, draftContent, etc.)
- [ ] Add job status enum types (pending, in_progress, awaiting_approval, approved, rejected, completed, failed)
- [ ] Add database methods: createResearchJob, updateResearchJob, getResearchJobs, createArticleJob, etc.
- [ ] Add migration system for schema updates

### 3.2 Job Queue Service (`src/services/jobQueue.service.ts`)
- [ ] Job creation and priority management
- [ ] Job status tracking and updates
- [ ] Polling mechanism for pending jobs
- [ ] Job relationship tracking (parent/child jobs)
- [ ] Job retry logic with configurable max retries

### 3.3 Update ContentResearcher Agent (Queue Support)
- [ ] Add polling loop to check database for pending research jobs
- [ ] Process jobs from database instead of only direct calls
- [ ] Update job status throughout workflow (pending → in_progress → awaiting_approval → approved)
- [ ] Link completed research to parent article jobs
- [ ] Increment article's completed research count when job approved
- [ ] Keep existing synchronous research capability for Writer's initial discovery phase

### 3.4 ContentWriter Agent (`src/agents/content-writer/ContentWriter.ts`)

#### Phase 1: Synchronous Initial Discovery
- [ ] `createArticle(request)` method — hybrid workflow entry point
- [ ] Call ContentResearcher **synchronously** for initial category/planning research
- [ ] Request Discord approval for initial research
- [ ] Extract categories/products from initial research findings

#### Phase 2: Queue Parallel Research
- [ ] Create ArticleJob in database (status: pending_research)
- [ ] Create multiple ResearchJobs for each product/category (status: pending, priority: 7)
- [ ] Link research jobs to article job (parentJobId, relatedJobIds)
- [ ] Notify Discord: "✅ Initial research complete, 🔍 Queued N product research jobs"

#### Phase 3: Polling & Article Generation
- [ ] `pollForCompletedResearch()` — continuous polling loop (every 10 seconds)
- [ ] Detect when all research jobs for an article are approved
- [ ] Generate article using AI with all research findings
- [ ] Request Discord approval for draft article
- [ ] Publish on final approval

### 3.5 Prompt Templates (`src/agents/content-writer/context/`)
- [ ] System prompt for ContentWriter agent
- [ ] Multi-product article generation prompt (intro, product sections, verdict, CTA)
- [ ] Single-product article generation prompt
- [ ] Initial discovery/planning prompt (for category extraction)
- [ ] SEO meta description prompt

### 3.6 Article Types Support
- [ ] Single-product article: "Best Standing Desk for WFH"
- [ ] Multi-product roundup: "5 Best Desk Items for WFH Setup"
- [ ] Comparison article: "Product A vs Product B"
- [ ] Category overview: "Standing Desks Buying Guide"

### 3.7 Content Quality & SEO
- [ ] Article structure templates (H1/H2/H3 hierarchy)
- [ ] Amazon affiliate link insertion (using `AMAZON_AFFILIATE_TAG`)
- [ ] Tone and style consistency (professional, helpful, not overly promotional)
- [ ] Readability scoring
- [ ] Meta description generation
- [ ] Keyword integration

### 3.8 Discord Commands
- [ ] `!write "<title>"` — Create multi-product article with hybrid workflow
  - Example: `!write "5 Best Desk Items For Your WFH Setup"`
- [ ] `!draft <jobId>` — Generate article from approved research (legacy single-product)
- [ ] `!status` — Show pending article and research jobs
- [ ] `!cancel <jobId>` — Cancel article or research job

### 3.9 Publishing Workflow
- [ ] Draft review and approval flow (Approve / Request Changes / Reject)
- [ ] Revision request handling (feedback integration)
- [ ] Export to markdown format
- [ ] Export to CMS-ready format (future: WordPress, Ghost, etc.)
- [ ] Track published article URLs

**Dependencies:** Phase 2 complete ✅  
**Estimated Time:** 4-6 hours  
**Deliverables:** 
- Queue-based job system operational
- Writer can create multi-product articles via hybrid sync/async workflow
- Full Discord command set for article management
- Publication-ready content with affiliate links

---

## Architecture Pattern: Hybrid Sync/Async

```
User: !write "5 Best Desk Items For Your WFH Setup"
  ↓
Writer (SYNC): Research categories directly
  ↓ (waits)
Researcher: Returns [Desks, Chairs, Monitors, Lamps, Keyboards]
  ↓
Writer (ASYNC): Creates 5 parallel ResearchJobs in database
  ↓
Researcher (polling): Processes jobs independently
  ↓
Writer (polling): Waits for all 5 approved
  ↓
Writer (SYNC): Generates final article
  ↓
Discord: Final approval
  ↓
Publish! 🚀
```

**Why Hybrid?**
- ✅ Fast initial discovery (sync = no polling delay)
- ✅ Efficient parallel research (async = 5 products at once)
- ✅ Resumable (jobs persist in database)
- ✅ Trackable (clear status per job)
- ✅ Scalable (can add more researcher instances)

**When to Use Sync vs Async:**
- **Sync:** Planning/discovery, fast decisions, sequential dependencies
- **Async:** Parallel work, long tasks, resumability needed

---

## Phase 4: Product Analyzer Agent PLANNED

**Objective:** Deeper product intelligence — spec comparison and market positioning

### 4.1 ProductAnalyzer Agent (`src/agents/product-analyzer/ProductAnalyzer.ts`)
- [ ] Spec extraction and normalization
- [ ] Price comparison across multiple sellers
- [ ] Specification table generation
- [ ] Market positioning assessment (budget / mid-range / premium)

### 4.2 Amazon Integration
- [ ] Affiliate link generation (env var `AMAZON_AFFILIATE_TAG` already wired)
- [ ] Product image retrieval
- [ ] Price and availability checking

---

## Phase 5: Advanced Features FUTURE

### 5.1 Multi-Agent Coordination
- [ ] Agent task handoff protocol
- [ ] Priority-based scheduling
- [ ] Batch research for multiple products

### 5.2 Analytics & Reporting
- [ ] Research quality metrics
- [ ] Content performance tracking
- [ ] Affiliate link click tracking
- [ ] `!stats` Discord dashboard command

### 5.3 Automation & Scheduling
- [ ] Scheduled / recurring research tasks
- [ ] Trend detection and alerting
- [ ] Seasonal product recommendations

### 5.4 Infrastructure
- [ ] Migrate SQLite to PostgreSQL for production scale
- [ ] Docker Compose for ChromaDB + app
- [ ] CI/CD pipeline

---

## Progress Tracking

### Overall Completion: ~55% (Phases 0-2 complete)

| Phase | Status | Completion | Notes |
|-------|--------|------------|-------|
| Phase 0: Foundation | Complete | 100% | Bot operational |
| Phase 1: AI Integration | Complete | 100% | Gemini + Anthropic, rate limiting, retries, token tracking |
| Phase 2: Product Research | Complete | 100% | Tavily search, ChromaDB, SQLite, full Discord flow |
| Phase 3: Content Writer | Next | 0% | Skeleton exists in ContentWriter.ts |
| Phase 4: Product Analyzer | Planned | 5% | Skeleton exists in ProductAnalyzer.ts |
| Phase 5: Advanced Features | Future | 0% | — |

---

## Current Priorities

**Immediate Next Steps (Phase 3):**
1. Implement `ContentWriter.ts` — generate article draft from `ResearchFindings`
2. Add prompts to `src/agents/content-writer/context/`
3. Extend Discord approval flow for draft review and revision requests
4. Add `!draft <jobId>` Discord command

**Blockers:** None
**Dependencies:** Phase 2 complete

---

## Notes & Decisions

### Technology Choices
- **AI Provider:** Google Gemini `gemini-2.5-flash` (primary), Anthropic Claude (available, swap via config)
- **Embeddings:** `gemini-embedding-001` (only model available on current free-tier API key)
- **Web Search:** Tavily API (replaced planned Amazon scraper)
- **Vector DB:** ChromaDB (local, cosine similarity, 0.85 dedup threshold)
- **Relational DB:** SQLite via `better-sqlite3` (migrate to PostgreSQL for production)

### Quality Standards
- All research must have ≥70% confidence score
- Human approval required before content generation
- No content published without final review

### Development Principles
- Build incrementally and test each phase
- Maintain type safety throughout
- Log everything (Winston, file + console)
- Fail gracefully with helpful error messages

---

## Update History

- **2026-01-13:** Project initialized, Phase 0 complete, Discord bot operational
- **2026-01-13:** Roadmap created, Phase 1 started
- **2026-02-23:** Phases 1 & 2 complete — dual AI providers, Tavily web search, ChromaDB embeddings, SQLite storage, full ContentResearcher agent operational and communicating via Discord

---

## Quick Commands Reference

```bash
# Start development server
npm run dev

# Build project
npm run build

# Run tests
npm test

# Lint
npm run lint

# View logs
tail -f logs/combined.log
tail -f logs/error.log
```

---

**Remember:** Update this document as you complete tasks. Check off items with `[x]` and advance the "Current Phase" header.
