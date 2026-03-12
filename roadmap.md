# DeskCurator Development Roadmap

**Current Phase:** Phase 3 - Content Writer Agent COMPLETE
**Next Phase:** Phase 4 - SEO Optimizer Agent
**Last Updated:** March 12, 2026

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
- [x] Active provider switchable via `config.ai.provider` (currently Gemini)

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

## Phase 3: Content Writer Agent COMPLETE

**Objective:** Generate multi-product affiliate content with queue-based parallel research

> **Architecture:** Hybrid approach — synchronous initial discovery + asynchronous parallel research queue

### 3.1 Database Schema Extensions (`src/services/database.service.ts`)
- [x] `queue_research_jobs` table (id, type, status, query, findings, parentJobId, priority, scheduledAfter, etc.)
- [x] `article_jobs` table (id, title, type, status, researchJobIds, draftContent, scheduledAfter, etc.)
- [x] Job status enums (pending, in_progress, awaiting_approval, approved, rejected, completed, failed)
- [x] Database methods: createResearchJob, updateResearchJob, getResearchJobs, createArticleJob, etc.
- [x] Additive migration system for schema updates (safe on existing databases)
- [x] `scheduled_after` column on both job tables for RPD pause/resume

### 3.2 Job Queue Service (`src/services/jobQueue.service.ts`)
- [x] Job creation and priority management
- [x] Job status tracking and updates
- [x] Polling mechanism with `scheduled_after` filtering (skips jobs paused for rate limits)
- [x] Job relationship tracking (parent/child jobs)
- [x] Job retry logic with configurable max retries

### 3.3 ContentResearcher Agent — Queue Support
- [x] Polling loop checks `queue_research_jobs` every 5s
- [x] Processes jobs from database queue, not only direct calls
- [x] Updates job status throughout workflow (pending → in_progress → approved/rejected)
- [x] Links completed research to parent article jobs
- [x] Increments article's completed research count on approval
- [x] Synchronous research capability preserved for Writer's initial discovery phase

### 3.4 ContentResearcher Agent — Quality Gates
- [x] **Product validation pre-flight** — Gemini validates every topic is a real purchasable product (brand + model) before running expensive searches; `skipValidation: true` option for discovery queries
- [x] **75% confidence threshold** — research scoring below threshold is auto-rejected and never sent for Discord approval
- [x] Confidence scoring based on: high-credibility source count, pros/cons richness, source count, Tavily relevance scores

### 3.5 ContentWriter Agent (`src/agents/content-writer/ContentWriter.ts`)

#### Phase 1: Synchronous Initial Discovery
- [x] `createArticle(request)` method — hybrid workflow entry point
- [x] Creates Discord thread in #writer-editor
- [x] Calls ContentResearcher synchronously with `skipValidation: true` for topic-level discovery
- [x] Context-aware discovery query (`buildDiscoveryQuery`) — product-focused, no accessories
- [x] Extracts 3–5 specific named products (brand + model) from discovery findings via AI

#### Phase 2: Queue Parallel Research
- [x] Creates ArticleJob in database (status: pending_research)
- [x] Creates 3–5 ResearchJobs for each discovered product (status: pending, priority: 7)
- [x] Links research jobs to article job (parentJobId)
- [x] Notifies Discord thread: "Queued N research jobs"

#### Phase 3: Polling & Article Generation
- [x] `pollForCompletedResearch()` — continuous polling loop (every 10 seconds)
- [x] Respects `scheduled_after` on article_jobs (skips articles paused for rate limits)
- [x] Detects when all research jobs for an article are approved
- [x] Generates buyer's guide article using structured research data via Gemini Flash
- [x] Requests Discord approval for draft in article thread
- [x] Publishes on final approval (writes `output/articles/<id>.md`)

### 3.6 Prompt Templates (`src/agents/content-writer/context/`)
- [x] WRITER_SYSTEM_PROMPT — buyer's guide tone and style rules
- [x] `categoryDiscoveryPrompt` — requests 3–N brand+model named products for an article title
- [x] `categoryExtractionPrompt` — extracts 3–N named products from existing research summary
- [x] `articleGenerationPrompt` — structured buyer's guide: intro, comparison table, product sections, buying considerations, verdict, FAQ; per-type formatting rules for multi_product / single_product / comparison / roundup
- [x] `seoMetaPrompt` — 150–160 char SEO meta description

### 3.7 Article Types Support
- [x] Single-product deep-dive: sections for Overview, Specs, Strengths, Weaknesses, Who It Suits, Verdict
- [x] Multi-product buyer's guide: per-product H3 with positioning, specs, pros/cons, "Best for"
- [x] Comparison article: At a Glance, Build, Stability, Value, Verdict + comparison table
- [x] Roundup: quick-reference per-product H3 + "Quick Picks" by use case

### 3.8 Intelligent Error Handling & Rate Limiting
- [x] **503 Service Unavailable** — 30-min pause, then retry (up to maxRetries)
- [x] **429 TPM** — exponential backoff per attempt
- [x] **429 RPD** — throw immediately (no retry wasted); job/article sets `scheduled_after` to midnight
- [x] RPD classification via response keywords ("per_day", "DAILY") or retryDelay > 1 hour
- [x] Dual AI instances: `aiService` (Gemini Flash Lite, researcher) + `writerAiService` (Gemini Flash, writer)

### 3.9 Discord Commands
- [x] `!write "<title>"` — create multi-product article with hybrid workflow
- [x] `!status` — show pending article and research jobs
- [x] `!cancel <jobId>` — cancel article or research job
- [x] `!retry-write <articleId>` — manually retry article generation using existing approved research

**Deliverables:**
- Queue-based job system operational
- Writer creates multi-product buyer's guide articles via hybrid sync/async workflow
- Pre-flight product validation prevents researching non-products
- 75% confidence threshold gates low-quality research
- Intelligent rate limit handling (TPM backoff, RPD midnight reschedule, 503 30-min pause)
- `!retry-write` command for manual article regeneration without re-researching

---

## Architecture Pattern: Hybrid Sync/Async

```
User: !write "Best Standing Desks for Tall People"
  ↓
Writer (SYNC): Research discovery query (skipValidation: true)
  ↓ (waits for approval)
Researcher: Returns [Uplift V2 Commercial, FlexiSpot E7 Pro, Jarvis Bamboo, Autonomous SmartDesk Pro]
  ↓
Writer (ASYNC): Creates 4 parallel ResearchJobs in database
  ↓
Researcher (polling): Validates, searches, scores, and processes each job
  ↓
Writer (polling): Waits for all 4 approved
  ↓
Writer (SYNC): Generates buyer's guide article via Gemini Flash
  ↓
Discord: Final approval
  ↓
Publish! output/articles/<id>.md
```

**Why Hybrid?**
- Fast initial discovery (sync = no polling delay)
- Efficient parallel research (async = multiple products at once)
- Resumable (jobs persist in database, survive restarts)
- Trackable (clear status per job)
- Rate-limit resilient (RPD pauses until midnight, TPM backs off, 503 waits 30 min)

---

## Phase 4: SEO Optimizer Agent PLANNED

**Objective:** Maximise organic reach by applying deterministic SEO rules and AI-validated keyword strategy to every article before publication

> **Pipeline position:** SEO Optimizer runs between ContentWriter's draft and the final Discord approval — the writer produces the draft, the optimizer transforms it, and the admin reviews the SEO-enhanced version.

### 4.1 SEOOptimizer Agent (`src/agents/seo-optimizer/SEOOptimizer.ts`)
- [ ] Receives article draft + title + article type from ContentWriter
- [ ] Returns an optimised draft and an SEO audit report
- [ ] Integrated into `writeArticle()` — called after generation, before Discord approval

### 4.2 Deterministic Rules Engine
Rules applied programmatically (no AI required, always consistent):
- [ ] **Title tag validation** — H1 present, contains primary keyword, 50–60 chars
- [ ] **Heading hierarchy** — no skipped levels (H1 → H2 → H3 only), no duplicate H1
- [ ] **Meta description length** — enforce 150–160 characters (trim or flag if outside range)
- [ ] **Keyword density** — primary keyword appears in H1, first paragraph, at least one H2, and conclusion; flag if over-stuffed (> 3% density)
- [ ] **Internal link placeholders** — insert `<!-- internal-link: [topic] -->` markers at natural cross-link points
- [ ] **Affiliate link audit** — verify every product mentioned has an affiliate link; insert missing ones using `AMAZON_AFFILIATE_TAG`
- [ ] **Word count gate** — flag articles below 1200 words or above 2500 words
- [ ] **Banned phrase sweep** — scan for and report any phrases that slipped past the writer prompt (e.g. "game-changer", "industry-leading")
- [ ] **Image alt-text placeholders** — insert `<!-- img: [product name] -->` markers after each product section for future media insertion
- [ ] **FAQ schema marker** — wrap FAQ section in `<!-- schema: FAQPage -->` comment for CMS structured data injection

### 4.3 AI-Powered SEO Validation (Gemini)
- [ ] **Primary keyword extraction** — identify the single best target keyword from the article title and content
- [ ] **Secondary keyword suggestions** — 3–5 semantically related terms to weave into subheadings or body copy
- [ ] **Search intent alignment** — validate the article matches the likely intent (informational / commercial / transactional) for the target keyword
- [ ] **Readability score** — AI-estimated Flesch-Kincaid grade level; flag if above grade 10
- [ ] **Thin content detection** — flag sections with fewer than 80 words as potential thin content
- [ ] **Competitor gap hints** — suggest 1–2 angles or questions the article could address that competing pages typically cover

### 4.4 SEO Audit Report
- [ ] Structured report object: `{ passed: string[], warnings: string[], failures: string[], keywords: { primary, secondary[] }, wordCount, readabilityGrade }`
- [ ] Stored alongside the draft in `article_jobs` (new `seo_report` JSON column)
- [ ] Surfaced in the Discord approval embed as a collapsible summary (passed / warnings / failures counts)
- [ ] Hard failures (missing H1, no affiliate links, word count below 1200) block approval and return the draft to `writing` status

### 4.5 Prompt Templates (`src/agents/seo-optimizer/context/`)
- [ ] `seoValidationPrompt` — keyword extraction, intent alignment, secondary keyword suggestions
- [ ] `readabilityPrompt` — grade level estimation and thin content detection
- [ ] `competitorGapPrompt` — surface angles competing articles cover that this one misses

### 4.6 Discord Integration
- [ ] SEO audit summary appended to article approval embed (emoji-coded: ✅ passed / ⚠️ warnings / ❌ failures)
- [ ] `!seo-report <articleId>` command — print the full SEO audit for any article

---

## Phase 5: Product Analyzer Agent PLANNED

**Objective:** Deeper product intelligence — spec comparison and market positioning

### 5.1 ProductAnalyzer Agent (`src/agents/product-analyzer/ProductAnalyzer.ts`)
- [ ] Spec extraction and normalization
- [ ] Price comparison across multiple sellers
- [ ] Specification table generation
- [ ] Market positioning assessment (budget / mid-range / premium)

### 5.2 Amazon Integration
- [ ] Affiliate link generation (env var `AMAZON_AFFILIATE_TAG` already wired)
- [ ] Product image retrieval
- [ ] Price and availability checking

---

## Phase 6: Advanced Features FUTURE

### 6.1 Multi-Agent Coordination
- [ ] Agent task handoff protocol
- [ ] Priority-based scheduling
- [ ] Batch research for multiple products

### 6.2 Analytics & Reporting
- [ ] Research quality metrics
- [ ] Content performance tracking
- [ ] Affiliate link click tracking
- [ ] `!stats` Discord dashboard command

### 6.3 Automation & Scheduling
- [ ] Scheduled / recurring research tasks
- [ ] Trend detection and alerting
- [ ] Seasonal product recommendations

### 6.4 Infrastructure
- [ ] Migrate SQLite to PostgreSQL for production scale
- [ ] Docker Compose for ChromaDB + app
- [ ] CI/CD pipeline

---

## Progress Tracking

### Overall Completion: ~65% (Phases 0-3 complete)

| Phase | Status | Completion | Notes |
|-------|--------|------------|-------|
| Phase 0: Foundation | Complete | 100% | Bot operational |
| Phase 1: AI Integration | Complete | 100% | Gemini + Anthropic, rate limiting, retries, token tracking |
| Phase 2: Product Research | Complete | 100% | Tavily search, ChromaDB, SQLite, full ContentResearcher flow |
| Phase 3: Content Writer | Complete | 100% | Buyer's guide articles, quality gates, rate limit resilience, retry command |
| Phase 4: SEO Optimizer | Planned | 0% | Next up — slots into article pipeline before Discord approval |
| Phase 5: Product Analyzer | Planned | 5% | Skeleton exists in ProductAnalyzer.ts |
| Phase 6: Advanced Features | Future | 0% | — |

---

## Current Priorities

**Immediate Next Steps (Phase 4):**
1. Create `src/agents/seo-optimizer/SEOOptimizer.ts` with deterministic rules engine
2. Create prompt templates in `src/agents/seo-optimizer/context/`
3. Add `seo_report` column to `article_jobs` via additive migration
4. Integrate `SEOOptimizer` into `ContentWriter.writeArticle()` — between generation and Discord approval
5. Add `!seo-report <articleId>` Discord command in writer channel

**Blockers:** None
**Dependencies:** Phase 3 complete ✅

---

## Notes & Decisions

### Technology Choices
- **AI Provider — Research:** Google Gemini `gemini-3.1-flash-lite-preview` (lightweight, fast JSON extraction)
- **AI Provider — Writing:** Google Gemini `gemini-3-flash-preview` (more capable, full article generation)
- **Embeddings:** `gemini-embedding-001` (only model available on current free-tier API key)
- **Web Search:** Tavily API (replaced planned Amazon scraper)
- **Vector DB:** ChromaDB (local, cosine similarity, 0.85 dedup threshold)
- **Relational DB:** SQLite via `better-sqlite3` (migrate to PostgreSQL for production)

### Quality Standards
- All research must pass product validation (brand + model required)
- All research must score ≥ 75% confidence before Discord approval request
- Human approval required before content generation
- No content published without final human review

### Development Principles
- Build incrementally and test each phase
- Maintain type safety throughout
- Log everything (Winston, file + console)
- Fail gracefully with helpful error messages

---

## Update History

- **2026-01-13:** Project initialized, Phase 0 complete, Discord bot operational
- **2026-01-13:** Roadmap created, Phase 1 started
- **2026-02-23:** Phases 1 & 2 complete — dual AI providers, Tavily web search, ChromaDB embeddings, SQLite storage, full ContentResearcher agent operational
- **2026-03-12:** Phase 3 complete — ContentWriter agent, buyer's guide article generation, product validation pre-flight, 75% confidence threshold, intelligent rate limit handling (TPM/RPD/503), `!retry-write` command, dual AI model split (Flash Lite for research, Flash for writing)

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
