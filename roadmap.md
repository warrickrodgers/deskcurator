# DeskCurator Development Roadmap

**Current Phase:** Phase 4 - SEO Optimizer Agent COMPLETE
**Next Phase:** Phase 5 - Product Analyzer Agent
**Last Updated:** March 14, 2026

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

### 3.1 Database Schema Extensions
- [x] `queue_research_jobs` table (id, type, status, query, findings, parentJobId, priority, scheduledAfter, etc.)
- [x] `article_jobs` table (id, title, type, status, researchJobIds, draftContent, scheduledAfter, etc.)
- [x] Job status enums (pending, in_progress, awaiting_approval, approved, rejected, completed, failed)
- [x] Additive migration system for schema updates (safe on existing databases)
- [x] `scheduled_after` column on both job tables for RPD pause/resume

### 3.2 Job Queue Service (`src/services/jobQueue.service.ts`)
- [x] Job creation and priority management
- [x] Job status tracking and updates
- [x] Polling mechanism with `scheduled_after` filtering
- [x] Job relationship tracking (parent/child jobs)
- [x] Job retry logic with configurable max retries

### 3.3 ContentResearcher Agent — Queue Support
- [x] Polling loop checks `queue_research_jobs` every 5s
- [x] Updates job status throughout workflow
- [x] Links completed research to parent article jobs
- [x] Increments article's completed research count on approval

### 3.4 ContentResearcher Agent — Quality Gates
- [x] **Product validation pre-flight** — Gemini validates every topic is a real purchasable product (brand + model) before running expensive searches
- [x] **75% confidence threshold** — research scoring below threshold is auto-rejected and never sent for Discord approval
- [x] Confidence scoring based on: high-credibility source count, pros/cons richness, source count, Tavily relevance scores

### 3.5 ContentWriter Agent (`src/agents/content-writer/ContentWriter.ts`)
- [x] `createArticle(request)` method — hybrid workflow entry point
- [x] Creates Discord thread in `#writer-editor`
- [x] Extracts 3–5 specific named products via AI (categoryDiscovery / categoryExtraction)
- [x] Creates ArticleJob in database (status: pending_research)
- [x] Creates 3–5 ResearchJobs for each discovered product (status: pending, priority: 7)
- [x] `pollForCompletedResearch()` — continuous polling loop (every 10 seconds)
- [x] Generates buyer's guide article using structured research data via Gemini Flash
- [x] Requests Discord approval for draft in article thread
- [x] Publishes on final approval (writes `output/articles/<id>.md`)

### 3.6 Article Types Support
- [x] Single-product deep-dive: sections for Overview, Specs, Strengths, Weaknesses, Who It Suits, Verdict
- [x] Multi-product buyer's guide: per-product H3 with positioning, specs, pros/cons, "Best for"
- [x] Comparison article: At a Glance, Build, Stability, Value, Verdict + comparison table
- [x] Roundup: quick-reference per-product H3 + "Quick Picks" by use case

### 3.7 Intelligent Error Handling & Rate Limiting
- [x] **503 Service Unavailable** — 30-min pause, then retry (up to maxRetries)
- [x] **429 TPM** — exponential backoff per attempt
- [x] **429 RPD** — throw immediately (no retry wasted); job/article sets `scheduled_after` to midnight
- [x] Dual AI instances: `aiService` (Gemini Flash Lite, researcher) + `writerAiService` (Gemini Flash, writer)

### 3.8 Discord Commands
- [x] `!write "<title>"` — create multi-product article with hybrid workflow
- [x] `!status` — show pending article and research jobs
- [x] `!cancel <jobId>` — cancel article or research job
- [x] `!retry-write <articleId>` — manually retry article generation using existing approved research

**Deliverables:**
- Queue-based job system operational
- Writer creates multi-product buyer's guide articles
- Pre-flight product validation prevents researching non-products
- 75% confidence threshold gates low-quality research
- Intelligent rate limit handling (TPM backoff, RPD midnight reschedule, 503 30-min pause)
- `!retry-write` command for manual article regeneration without re-researching

---

## Phase 4: SEO Optimizer Agent COMPLETE

**Objective:** Maximise organic reach by applying deterministic SEO rules and AI-validated keyword strategy to every article, with an automated revision loop to fix issues before publication

> **Pipeline position:** SEO Optimizer runs automatically after human draft approval. The writer produces the draft, human approves it, the optimizer scores and transforms it, and the writer publishes the optimized version — or revises and re-runs if the score falls short.

### 4.1 Product Discovery Overhaul (`src/agents/content-researcher/ContentResearcher.ts`)
- [x] **`discoverProducts(topic)`** — new Phase 1 method: AI names ~8 real products for a topic, validates each with `validateProductPrompt`, returns the clean list
- [x] Replaces the Tavily-based synchronous discovery call — Phase 1 is now AI-only (no search credits consumed for discovery)
- [x] `discoverProductsPrompt` — structured JSON prompt for product enumeration with brand + model
- [x] Parallel validation of discovered candidates (fail-open — validation errors don't drop good products)
- [x] ContentWriter slices the validated list to `productCount` before queuing (defaults to 5)

### 4.2 SEO Optimizer Agent (`src/agents/seo-optimizer/SeoOptimizer.ts`)
- [x] `run(articleId, productCount)` — full pipeline: load → AI validation → improve markdown → score → decide → persist → notify
- [x] Integrated into `ContentWriter.writeArticle()` — called after human approval, before publish
- [x] Writes `output/articles/<id>_seo.json` alongside the article markdown

### 4.3 Deterministic Rules Engine (`src/agents/seo-optimizer/seoScoring.ts`)
- [x] Pure functions, no AI required — always consistent
- [x] **Auto-fail conditions** (return `revise` regardless of score):
  - Word count < 1500
  - Product count < 3
  - Primary keyword missing from first 150 words
  - No Amazon affiliate links
  - Fewer than 3 H2 sections
- [x] **Scored checks** (deductions from 100):
  - Title outside 50–60 chars → -5
  - Meta description wrong length → -10
  - Heading hierarchy skipped levels → -5
  - Each banned phrase (max 3) → -5 each
- [x] `checkProductCount`, `checkWordCount`, `checkKeywordInIntro`, `checkAffiliateLinks`, `checkH2Sections`, `checkHeadingHierarchy`, `checkTitleLength`, `checkMetaDescription`, `findBannedPhrases`

### 4.4 Decision Tiers
- [x] **PASS (≥ 75):** `status = seo_completed` → article proceeds to publish
- [x] **REVISION (65–74, or any auto-fail):** `status = seo_revising` → writer regenerates with targeted improvement brief
- [x] **FAIL (< 65, no auto-fail):** `status = failed` → article flagged for manual intervention

### 4.5 Revision Loop (`src/agents/content-writer/ContentWriter.ts`)
- [x] `maxRevisionAttempts = 2` — caps the loop to prevent agents fighting indefinitely
- [x] On `revise`: ContentWriter calls `articleRevisionPrompt` with the improvement suggestions, regenerates the full draft + meta, saves to DB, re-runs SEO
- [x] After 2 failed revisions: `status = manual_review`, Discord notification with final suggestions
- [x] On `fail`: `status = failed`, Discord notification with all issues listed

### 4.6 AI-Powered SEO Validation (Gemini)
- [x] `seoValidationPrompt` — extracts: primary keyword, secondary keywords, search intent, suggested title, slug, readability grade, thin sections, competitor gaps
- [x] Fallback validation if AI call fails (derives keyword from article title)

### 4.7 Light Markdown Improvements
- [x] Insert missing H1 (uses AI-suggested title or article title as fallback)
- [x] Replace H1 with AI-suggested title if it matches the raw article title
- [x] `fixHeadingHierarchy()` — collapses skipped heading levels (e.g. H1 → H3 becomes H1 → H2)

### 4.8 SEO Audit Report
- [x] Structured `SeoAuditReport`: `{ passed[], warnings[], failures[], keywords, wordCount, readabilityGrade, searchIntent, thinSections, competitorGaps, seoScore }`
- [x] Stored as JSON in `article_jobs.seo_report`
- [x] `SeoMetadata` written to `output/articles/<id>_seo.json`: title, slug, meta description, target keywords, SEO score
- [x] `!seo-report <articleId>` Discord command prints the full audit for any article

### 4.9 Discord Integration
- [x] Dedicated `#seo-optimizer` channel (`DISCORD_SEO_OPTIMIZER_CHANNEL_ID`)
- [x] SEO audit posted automatically after each run: decision tier, score, keyword, passed/warnings/failures, required improvements
- [x] Score emoji: 🟢 ≥ 75 / 🟡 ≥ 65 / 🔴 < 65
- [x] Decision emoji: ✅ PASS / 🔄 REVISION NEEDED / ❌ FAIL

### 4.10 Database Schema Updates
- [x] `seo_report TEXT` column on `article_jobs`
- [x] `revision_count INTEGER DEFAULT 0` column on `article_jobs`
- [x] New statuses: `seo_optimizing`, `seo_completed`, `seo_revising`, `manual_review`
- [x] Table-recreation migration (handles CHECK constraint update on existing databases)

**Deliverables:**
- SEO Optimizer agent fully operational in the article pipeline
- Deterministic scoring engine with 9 checks
- Auto-fail conditions trigger revision loop (not hard failure)
- Up to 2 AI-driven revision attempts before manual_review escalation
- Article-type-aware product discovery (AI-only, no Tavily search credits for Phase 1)
- Full audit trail persisted to DB and JSON file
- `#seo-optimizer` Discord channel receives structured audit after every article

---

## Current Article Pipeline

```
User: !write "Best Monitor Light Bars"
  ↓
[Phase 1 — AI Discovery]
ContentResearcher.discoverProducts("Best Monitor Light Bars")
  → AI names 8 candidates
  → Validates each (brand + model check)
  → Returns validated list

[Phase 2 — Parallel Research Queue]
ContentWriter queues 5 research jobs (top 5 from validated list)
  ↓ (async, ContentResearcher polling loop)
Each job: Tavily search → Gemini analysis → confidence check → Discord approval
  ↓
All approved

[Phase 3 — Article Generation]
ContentWriter: Gemini Flash → buyer's guide markdown + meta description
Discord: Admin approval (Approve / Reject)
  ↓ Approved

[Phase 4 — SEO Optimization + Revision Loop]
SeoOptimizer.run(articleId, productCount)
  → AI keyword validation (Gemini Flash)
  → Deterministic scoring (9 checks)
  → Decision: PASS / REVISION / FAIL
    ↓ PASS (≥75)
    Publish output/articles/<id>.md  ✅

    ↓ REVISION (65–74 or auto-fail)
    ContentWriter regenerates draft with improvement brief
    SEO re-runs (up to 2 attempts)
    Still failing → manual_review  ⚠️

    ↓ FAIL (<65, no auto-fail)
    status = failed  ❌
```

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

### Overall Completion: ~80% (Phases 0-4 complete)

| Phase | Status | Completion | Notes |
|-------|--------|------------|-------|
| Phase 0: Foundation | Complete | 100% | Bot operational |
| Phase 1: AI Integration | Complete | 100% | Gemini + Anthropic, rate limiting, retries, token tracking |
| Phase 2: Product Research | Complete | 100% | Tavily search, ChromaDB, SQLite, full ContentResearcher flow |
| Phase 3: Content Writer | Complete | 100% | Buyer's guide articles, quality gates, rate limit resilience, retry command |
| Phase 4: SEO Optimizer | Complete | 100% | Deterministic scoring, AI validation, revision loop (max 2), manual_review escalation |
| Phase 5: Product Analyzer | Planned | 5% | Skeleton exists in ProductAnalyzer.ts |
| Phase 6: Advanced Features | Future | 0% | — |

---

## Notes & Decisions

### Technology Choices
- **AI Provider — Research:** Google Gemini `gemini-2.0-flash-lite` (lightweight, fast JSON extraction)
- **AI Provider — Writing & SEO:** Google Gemini `gemini-2.0-flash` (more capable, full article generation and SEO validation)
- **Embeddings:** `gemini-embedding-001` (only model available on current free-tier API key)
- **Web Search:** Tavily API (replaced planned Amazon scraper; not used for Phase 1 discovery)
- **Vector DB:** ChromaDB (local, cosine similarity, 0.85 dedup threshold)
- **Relational DB:** SQLite via `better-sqlite3` (migrate to PostgreSQL for production)

### Quality Standards
- All research must pass product validation (brand + model required)
- All research must score ≥ 75% confidence before Discord approval request
- Human approval required before content generation
- No content published without passing SEO score (≥ 75) or human manual_review override
- SEO revision loop capped at 2 attempts to prevent infinite agent loops

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
- **2026-03-12:** Phase 3 complete — ContentWriter agent, buyer's guide article generation, product validation pre-flight, 75% confidence threshold, intelligent rate limit handling (TPM/RPD/503), `!retry-write` command, dual AI model split
- **2026-03-14:** Phase 4 complete — SEO Optimizer agent, deterministic scoring engine, AI keyword validation, auto-fail revision loop (max 2 attempts), `manual_review` escalation, `#seo-optimizer` Discord channel, AI-only product discovery replacing Tavily-based Phase 1

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
