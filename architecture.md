# DeskCurator — Architecture

**Status:** Phase 4 complete (SeoOptimizer agent operational with scoring, decision tiers, and revision loop)
**Last Updated:** March 2026

---

## Overview

DeskCurator is a three-agent Discord bot for generating affiliate content about desk-setup products. The agents communicate via a SQLite job queue and interact with a human admin through separate Discord channels.

```
Admin
  │
  ├── #content-researcher ──► ContentResearcher Agent
  │                               │ AI-driven product discovery (discoverProducts)
  │                               │ Pre-flight product validation (Gemini)
  │                               │ Tavily search (3 parallel per product)
  │                               │ Gemini Flash Lite analysis
  │                               │ ChromaDB dedup
  │                               │ Confidence scoring (75% threshold)
  │                               │ SQLite persistence
  │
  ├── #writer-editor ────────► ContentWriter Agent
  │       (threads per article)       │ Calls discoverProducts() for Phase 1
  │                                   │ Reads from SQLite queue
  │                                   │ Gemini Flash article generation
  │                                   │ SEO revision loop (max 2 attempts)
  │
  └── #seo-optimizer ─────────► SeoOptimizer Agent
                                    │ Deterministic scoring (9 checks)
                                    │ AI keyword/slug/readability validation
                                    │ Decision: approved / revise / fail
                                    │ Revision briefs for ContentWriter
```

---

## Discord Channel Architecture

Three dedicated channels enforce strict separation of concerns:

| Channel | Agent | Commands | Notifications |
|---|---|---|---|
| `#content-researcher` | ContentResearcher | `!research <product>` | Research approval embeds, validation skip/reject notices, confidence rejection alerts |
| `#writer-editor` | ContentWriter | `!write "<title>"`, `!status`, `!cancel <jobId>`, `!retry-write <articleId>`, `!seo-report <articleId>` | Article threads, draft approval, publish confirmation, SEO revision/manual_review alerts |
| `#seo-optimizer` | SeoOptimizer | — | SEO audit reports (score, keyword, checks, competitor gaps) posted automatically after each article run |

**Env var:** `DISCORD_SEO_OPTIMIZER_CHANNEL_ID` → `config.discord.seoChannelId`

### Article Threads

When `!write` is issued, ContentWriter creates a **public Discord thread** inside `#writer-editor` named after the article title. All article-level events post into that thread:

- Phase 1 complete / products identified
- Parallel research jobs queued
- Writing in progress
- Draft approval embed (Approve / Reject / Request Edit)
- SEO revision notifications (attempt N of 2)
- Manual review flags
- Published confirmation

Individual **research job approvals** always appear in `#content-researcher`, regardless of whether they were queued by the writer or triggered by `!research`.

---

## Agent Architecture

### ContentResearcher

**File:** [src/agents/content-researcher/ContentResearcher.ts](src/agents/content-researcher/ContentResearcher.ts)

Runs two modes concurrently:

1. **AI-driven discovery** — called by ContentWriter for Phase 1 product discovery. No Tavily search; uses Gemini to enumerate ~8 real products, then validates each candidate.
2. **Queue polling** — polls `queue_research_jobs` every 5 seconds for pending per-product research jobs.

#### Phase 1: Product Discovery

```
discoverProducts(topic, count=8)
  │
  ├─ Gemini Flash Lite: discoverProductsPrompt → { products: [{brand, model, name}, ...] }
  ├─ Parse JSON → candidate name list
  └─ Parallel validation (validateProductPrompt per candidate)
       ├─ valid → include in results
       ├─ invalid → exclude
       └─ AI error → fail-open, include anyway
       → returns string[] of confirmed product names
```

#### Phase 2: Per-Product Deep Research

```
researchProduct(query, { skipValidation? })
  │
  ├─ ChromaDB dedup check (0.85 cosine similarity threshold)
  │
  ├─ [unless skipValidation] Pre-flight product validation (Gemini)
  │    → invalid topic: notify #content-researcher, return null
  │
  ├─ Tavily: 3 parallel searches (info, reviews, competitors)
  ├─ Gemini Flash Lite: pros/cons analysis (JSON)
  ├─ Gemini Flash Lite: competitor analysis (JSON)
  ├─ Gemini Flash Lite: affiliate summary
  ├─ Confidence scoring
  │    → < 75%: auto-reject, notify #content-researcher, return null
  │
  ├─ Store in ChromaDB
  ├─ Persist to SQLite (products + research_jobs)
  └─ Discord approval in #content-researcher
       → approved: return ResearchFindings
       → rejected: return null
```

**AI Model:** `gemini-3.1-flash-lite-preview` — lightweight model optimised for structured JSON extraction.

Queue job processing re-uses `researchProduct()` and then updates the `queue_research_jobs` row + increments the parent article's `completedResearchCount`. RPD rate limit errors reschedule the job until after midnight without consuming a retry.

#### Confidence Scoring

Scores are calculated from: high-credibility source count, number of pros/cons extracted, total source count, and average Tavily relevance score. Research scoring below **75%** is automatically rejected and never sent for Discord approval.

---

### ContentWriter

**File:** [src/agents/content-writer/ContentWriter.ts](src/agents/content-writer/ContentWriter.ts)

Hybrid sync/async workflow with integrated SEO revision loop:

```
createArticle(request)          ← triggered by !write
  │
  ├─ Create Discord thread in #writer-editor
  │
  ├─ [PHASE 1] AI Product Discovery
  │    → contentResearcher.discoverProducts(title)
  │    → returns 3–8 validated product names
  │
  ├─ INSERT article_job (status: pending_research)
  ├─ INSERT 3–5 × queue_research_jobs (status: pending, priority: 7)
  └─ Notify thread: "Queued N research jobs"

pollForCompletedResearch()      ← runs every 10s
  │
  └─ For each pending_research article where scheduled_after has passed:
       Check all linked queue_research_jobs
       All approved? → writeArticle()
       All done but some failed? → writeArticle() with approved subset

writeArticle(article, jobs)
  │
  ├─ Gemini Flash: articleGenerationPrompt → structured buyer's guide markdown
  ├─ Gemini Flash: seoMetaPrompt → meta description
  ├─ Combine: draft + "\n\n---\n*Meta description: <text>*"
  ├─ Update article_job (status: awaiting_approval, draftContent)
  ├─ Discord approval in article thread
  │    → approved: runSeoRevisionLoop()
  └─   → rejected: update status, post feedback to thread

runSeoRevisionLoop(article, researchItems)      ← max 2 revision attempts
  │
  ├─ Loop: attempt 0 → MAX_REVISIONS (2)
  │    │
  │    ├─ seoOptimizer.run(articleId, productCount)
  │    │
  │    ├─ decision: 'approved' → publishArticle(), break
  │    │
  │    ├─ decision: 'fail' → status: failed, notify thread, return
  │    │
  │    └─ decision: 'revise'
  │         ├─ attempt >= MAX_REVISIONS → status: manual_review, notify thread, return
  │         ├─ status: seo_revising, revisionCount: attempt+1
  │         ├─ Gemini Flash: articleRevisionPrompt (with improvement suggestions + previous draft)
  │         ├─ Gemini Flash: seoMetaPrompt
  │         ├─ Update article_job (draftContent: revisedDraft, status: approved)
  │         └─ Continue loop (next iteration re-runs SEO)

retryWrite(articleId)           ← triggered by !retry-write <articleId>
  ├─ Lookup article_job from database
  ├─ Find all approved queue_research_jobs for this article
  └─ Call writeArticle() directly with existing research

publishArticle()
  ├─ Write output/articles/<id>.md
  ├─ Update article_job (status: published, finalContent, publishedAt)
  └─ Notify thread: "Article published!"
```

**AI Model:** `gemini-3-flash-preview` — more capable model used for full article generation and revision.

#### Article Generation (Buyer's Guide Format)

Articles follow a structured buyer's guide format:
1. Problem-driven introduction (no generic openers)
2. Comparison table derived from research data
3. Product sections (format varies by article type)
4. Buying considerations based on research patterns
5. Verdict with use-case recommendations
6. FAQ with research-backed answers

Banned phrases: "premium quality", "great for productivity", "perfect for any workspace", "industry-leading", "game-changer", "best in class"

---

### SeoOptimizer

**File:** [src/agents/seo-optimizer/SeoOptimizer.ts](src/agents/seo-optimizer/SeoOptimizer.ts)

Runs after every article draft approval. Performs deterministic scoring, AI validation, applies structural improvements, computes a decision, and posts an audit report to `#seo-optimizer`.

```
run(articleId, productCount)
  │
  ├─ Load article from DB, set status → seo_optimizing
  ├─ splitDraft() → articleMarkdown + metaDescription
  │
  ├─ AI validation (Gemini Flash: seoValidationPrompt)
  │    → primaryKeyword, secondaryKeywords, suggestedTitle, suggestedSlug
  │    → readabilityGrade, searchIntent, thinSections, competitorGaps
  │    → error: fallback keyword derived from article title
  │
  ├─ applyImprovements()
  │    → insert H1 if missing (uses suggestedTitle or article title)
  │    → replace H1 if AI suggests a better title
  │    → fixHeadingHierarchy() if skipped levels detected
  │
  ├─ scoreArticle() — 9 deterministic checks (pure functions)
  │
  ├─ computeDecision(score, checks, failures)
  │    → auto-fail triggered? → 'revise' (writer must fix)
  │    → score ≥ 75         → 'approved'
  │    → score 65–74        → 'revise'
  │    → score < 65         → 'fail'
  │
  ├─ Persist: seoReport (JSON), status → seo_completed / seo_revising / failed
  ├─ Write output/articles/<id>_seo.json
  ├─ Post audit to #seo-optimizer
  └─ Return SeoResult { optimizedMarkdown, seoMetadata, auditReport, decision, improvementSuggestions }
```

#### Deterministic Scoring (9 Checks)

All checks are pure functions in [src/agents/seo-optimizer/seoScoring.ts](src/agents/seo-optimizer/seoScoring.ts). Score starts at 100, deductions applied per failure.

| Check | Pass Condition | Deduction | Auto-Fail |
|---|---|---|---|
| `sufficientWordCount` | ≥ 1500 words | −20 | Yes |
| `sufficientProductCount` | ≥ 3 products covered | −15 | Yes |
| `keywordInIntro` | Primary keyword in first 150 words | −15 | Yes |
| `affiliateLinksPresent` | ≥ 1 Amazon affiliate link | −10 | Yes |
| `hasH2Sections` | ≥ 3 H2 headings | −15 | Yes |
| `titleLengthOk` | Title 50–60 characters | −10 | No |
| `metaDescriptionOk` | Meta description 150–160 characters | −10 | No |
| `headingHierarchyOk` | No skipped heading levels | −5 | No |
| `noBannedPhrases` | No banned marketing phrases | −5 | No |

**Auto-fail conditions** always return `'revise'` (not `'fail'`) — the writer gets a chance to fix the specific issue. Hard `'fail'` only occurs when score < 65 with no auto-fail conditions triggered.

#### Decision Tiers

| Score | Auto-fail? | Decision | Next action |
|---|---|---|---|
| any | Yes | `revise` | Writer regenerates with improvement brief |
| ≥ 75 | No | `approved` | Article published |
| 65–74 | No | `revise` | Writer regenerates with improvement brief |
| < 65 | No | `fail` | Article marked failed |

After **2 revision attempts** without approval → `manual_review` (flagged in `#writer-editor` thread).

---

## Article Job Status Lifecycle

```
pending_research
    │
    ├── (all research approved) ──► writing
    │                                   │
    │                                   ▼
    │                           awaiting_approval
    │                               │         │
    │                           approved    rejected
    │                               │
    │                               ▼
    │                         seo_optimizing
    │                          │    │    │
    │                    approved  revise  fail
    │                       │       │       │
    │                  seo_completed │    failed
    │                               │
    │                         seo_revising
    │                          (attempts 1–2)
    │                               │
    │                     approved? → seo_completed
    │                     exhausted? → manual_review
    │
    └── seo_completed ──► published
```

---

## Error Handling & Rate Limit Strategy

**File:** [src/services/gemini.provider.ts](src/services/gemini.provider.ts), [src/utils/retry.ts](src/utils/retry.ts), [src/services/ai.service.ts](src/services/ai.service.ts)

Three error classes with distinct handling:

| Error | Classification | Handling |
|---|---|---|
| 503 Service Unavailable | `SERVICE_UNAVAILABLE` | 30-min pause, then retry (up to maxRetries) |
| 429 TPM (tokens/minute) | `RATE_LIMIT / TPM` | Exponential backoff (1s → 2s → 4s…) |
| 429 RPD (requests/day) | `RATE_LIMIT / RPD` | No retry — throw immediately, job sets `scheduled_after` to midnight |

RPD detection uses response keywords ("per_day", "DAILY") or retry delay > 1 hour. When RPD is hit in a queue job, the job's `scheduled_after` column is set to the next day and the job stays `pending` — no retry count consumed.

---

## Database Schema (SQLite)

**File:** [src/services/database.service.ts](src/services/database.service.ts)

Schema uses additive migrations — safe to run against existing databases. CHECK constraint changes are handled via table recreation (SQLite limitation).

### `products`
Tracks product metadata created during research flows.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| name | TEXT | |
| category | TEXT | |
| price | REAL | optional |
| url | TEXT | Amazon search URL |
| affiliate_link | TEXT | optional |
| created_at | TEXT | datetime |

### `research_jobs`
Tracks `!research` job runs (tied to a product).

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| product_id | TEXT FK | → products |
| status | TEXT | pending / running / completed / failed |
| confidence_score | REAL | |
| search_query | TEXT | |
| started_at | TEXT | |
| completed_at | TEXT | |

### `approval_history`
Records every Discord approval interaction.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| research_job_id | TEXT FK | → research_jobs |
| discord_message_id | TEXT | |
| status | TEXT | pending / approved / rejected / needs_edit |
| feedback | TEXT | from "Request Edit" flow |
| created_at | TEXT | |
| responded_at | TEXT | |

### `queue_research_jobs`
Writer-created research jobs processed by ContentResearcher's polling loop.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| type | TEXT | product / category / comparison |
| status | TEXT | pending / in_progress / awaiting_approval / approved / rejected / failed |
| priority | INTEGER | 1–10, higher = sooner |
| query | TEXT | e.g. "Herman Miller Aeron review and specifications" |
| requested_by | TEXT | writer / user |
| parent_job_id | TEXT | → article_jobs.id |
| findings | TEXT | JSON-serialized ResearchFindings |
| discord_message_id | TEXT | |
| discord_thread_id | TEXT | |
| created_at / started_at / completed_at | TEXT | |
| failure_reason | TEXT | |
| retry_count / max_retries | INTEGER | default 0 / 3 |
| scheduled_after | TEXT | ISO timestamp — job not eligible until this time passes (used for RPD pausing) |

### `article_jobs`
Tracks full article lifecycle from queue to publish.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| status | TEXT | pending_research / writing / awaiting_approval / approved / rejected / seo_optimizing / seo_completed / seo_revising / manual_review / failed / published |
| title | TEXT | e.g. "Best Standing Desks for Tall People" |
| article_type | TEXT | single_product / multi_product / comparison / roundup |
| research_job_ids | TEXT | JSON array of queue_research_job IDs |
| required_research_count | INTEGER | |
| completed_research_count | INTEGER | incremented on each approval |
| draft_content | TEXT | AI-generated markdown (updated each revision) |
| final_content | TEXT | approved final version |
| seo_report | TEXT | JSON-serialized SeoAuditReport |
| revision_count | INTEGER | number of SEO revision attempts (default 0) |
| discord_message_id | TEXT | approval message |
| discord_thread_id | TEXT | writer-editor thread for this article |
| published_url | TEXT | future CMS URL |
| created_at / completed_at / published_at | TEXT | |
| scheduled_after | TEXT | ISO timestamp — holds article polling until time passes |

---

## Service Layer

### AI Service
**File:** [src/services/ai.service.ts](src/services/ai.service.ts)

Provider abstraction over Gemini and Anthropic. Three instances are exported:

| Export | Model | Used by |
|---|---|---|
| `aiService` | `gemini-3.1-flash-lite-preview` | ContentResearcher — structured JSON extraction |
| `writerAiService` | `gemini-3-flash-preview` | ContentWriter — article generation; SeoOptimizer — AI validation |

Features:
- Swappable provider via `config.ai.provider`
- Exponential backoff retry (up to `maxRetries`) — RPD errors bypass retry and throw immediately
- Token usage tracking
- `ask(prompt, systemPrompt?)` — single-turn helper used by all agents
- `notifyRateLimit(waitMs, attempt, error?)` — contextual Discord notifications for 503 / TPM / RPD

### ChromaDB Service
**File:** [src/services/chroma.service.ts](src/services/chroma.service.ts)

Vector store for research deduplication.
- Embeddings via `gemini-embedding-001`
- Cosine similarity collection
- `getSimilarResearch(name, category, query)` — returns cached findings if similarity ≥ 0.85
- `storeResearch(jobId, findings, query)` — stores after approval

### Search Service
**File:** [src/services/search.service.ts](src/services/search.service.ts)

Wraps the Tavily API. Runs three parallel searches per product (Phase 2 only — Phase 1 discovery is AI-only):
- General product info
- User reviews
- Competitor landscape

### Discord Service
**File:** [src/services/discord.ts](src/services/discord.ts)

Manages all Discord interactions:
- **Channel routing** — `!research` only handled in researcher channel; `!write`/`!status`/`!cancel`/`!retry-write`/`!seo-report` only in writer channel
- **`sendNotification(message, channelId?)`** — sends to researcher channel by default; accepts explicit channel or thread ID
- **`requestApproval(request, channelId?)`** — posts embed with Approve / Reject / Request Edit buttons; waits for interaction
- **`createArticleThread(title)`** — creates a public thread in the writer channel; returns thread ID
- **Handler registration** — `registerResearchHandler`, `registerWriteHandler`, `registerStatusHandler`, `registerCancelHandler`, `registerRetryWriteHandler`, `registerSeoReportHandler`

### Job Queue Service
**File:** [src/services/jobQueue.service.ts](src/services/jobQueue.service.ts)

Thin wrapper over `databaseService` for queue semantics:
- `enqueueResearch(params)` — creates a `queue_research_job` with defaults
- `dequeueNext()` — atomically fetches the highest-priority pending job where `scheduled_after` has passed, marks it `in_progress`
- `createArticle(params)` — creates an `article_job`

### Database Service
**File:** [src/services/database.service.ts](src/services/database.service.ts)

SQLite via `better-sqlite3`. WAL mode, foreign keys enabled. All SELECT queries use explicit column aliases for snake_case → camelCase mapping. Additive migrations run on startup (safe on existing databases). Table recreation migration handles CHECK constraint changes (new statuses, new columns) by detecting missing values and rebuilding `article_jobs` with data preserved.

---

## Prompt Templates

### ContentResearcher
**File:** [src/agents/content-researcher/context/prompts.ts](src/agents/content-researcher/context/prompts.ts)

| Prompt | Purpose |
|---|---|
| `discoverProductsPrompt` | Ask Gemini to enumerate ~8 real named products (brand + model) for an article topic |
| `validateProductPrompt` | Pre-flight check: is this a real purchasable product with brand + model? |
| `analyzeProsConsPrompt` | Extract structured pros/cons JSON from search results |
| `competitorPrompt` | Identify top 3–5 competitors with differentiators |
| `summaryPrompt` | Write affiliate-optimised 3–4 paragraph summary |

### ContentWriter
**File:** [src/agents/content-writer/context/prompts.ts](src/agents/content-writer/context/prompts.ts)

| Prompt | Purpose |
|---|---|
| `articleGenerationPrompt` | Write structured buyer's guide (intro, table, products, considerations, verdict, FAQ) |
| `articleRevisionPrompt` | Rewrite article incorporating SEO improvement brief + previous draft for reference |
| `seoMetaPrompt` | Write a 150–160 char SEO meta description |

### SeoOptimizer
**File:** [src/agents/seo-optimizer/context/](src/agents/seo-optimizer/context/)

| Prompt | Purpose |
|---|---|
| `seoValidationPrompt` | Extract primaryKeyword, secondaryKeywords, suggestedTitle, suggestedSlug, readabilityGrade, searchIntent, thinSections, competitorGaps |

---

## End-to-End Example

```
T+0s   Admin: !write "Best Standing Desks for Tall People"
T+1s   Bot creates Discord thread: "Best Standing Desks for Tall People"
T+2s   Thread: "Phase 1: discovering products…"

── [PHASE 1] AI Product Discovery ───────────────────────────────────────────

T+3s   ContentResearcher: discoverProducts("Best Standing Desks for Tall People")
           Gemini: discoverProductsPrompt → 8 candidate products
           Parallel validation: 6 pass, 2 fail → 6 confirmed products
T+8s   Thread: "Phase 1 complete — 5 products queued for research:
               Uplift V2 Commercial, FlexiSpot E7 Pro, Jarvis Bamboo,
               Autonomous SmartDesk Pro, Flexispot E7"

── [PHASE 2] Parallel Research Queue ────────────────────────────────────────

T+9s   queue_research_jobs: 5 rows inserted (status: pending)

T+12s  ContentResearcher picks up: "Uplift V2 Commercial"
           Tavily: 3 parallel searches
           Gemini: pros/cons + competitor analysis + summary
T+27s  confidence: 88% — passes threshold
T+27s  #content-researcher: approval embed
T+30s  Admin: Approve  →  completedCount → 1/5

       … (repeat for all 5 products) …

T+4m   All 5 jobs approved, completedCount → 5/5

── [PHASE 3] Article Generation ──────────────────────────────────────────────

T+4m   ContentWriter detects all research complete
T+4m   Thread: "Writing article… generating draft now…"
T+5m   Gemini Flash: articleGenerationPrompt → full buyer's guide
T+5m   Gemini Flash: seoMetaPrompt → meta description
T+5m   article_jobs: status → awaiting_approval
T+5m   Thread: approval embed with article draft preview
T+8m   Admin: Approve

── [PHASE 4] SEO Optimization ────────────────────────────────────────────────

T+8m   seoOptimizer.run(articleId, productCount=5)
           AI validation: primaryKeyword = "standing desks tall people"
           Deterministic scoring: 8/9 checks passed → score 82
           Decision: approved (≥75, no auto-fail)
T+8m   #seo-optimizer: "✅ SEO Audit: PASS 🟢 score 82/100"
T+8m   output/articles/<id>.md written
T+8m   output/articles/<id>_seo.json written
T+8m   Thread: "Article published! File: output/articles/<id>.md"

── SEO Revision Example ──────────────────────────────────────────────────────

       [If keyword missing from intro — auto-fail → revise]
       seoOptimizer returns: decision='revise'
         improvementSuggestions: ["Primary keyword 'best standing desks tall' not found in first 150 words"]
       ContentWriter: articleRevisionPrompt with improvement brief + previous draft
       Gemini Flash rewrites article
       seoOptimizer.run() attempt 2 → score 78 → approved ✅

── Manual review example ─────────────────────────────────────────────────────

       [If 2 revisions exhausted without approval]
       article_jobs: status → manual_review
       Thread: "⚠️ SEO revision attempts exhausted — manual review required"
       Admin addresses issues manually, then: !retry-write <articleId>
```

---

## Configuration Reference

All config is in [src/config/env.ts](src/config/env.ts), validated with Zod on startup.

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Yes | Application ID |
| `DISCORD_GUILD_ID` | Yes | Server ID |
| `DISCORD_RESEARCHER_CHANNEL_ID` | Yes | `#content-researcher` channel ID |
| `DISCORD_WRITER_CHANNEL_ID` | Yes | `#writer-editor` channel ID |
| `DISCORD_SEO_OPTIMIZER_CHANNEL_ID` | Yes | `#seo-optimizer` channel ID |
| `DISCORD_ADMIN_USER_ID` | Yes | Your Discord user ID (receives approval pings) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `ANTHROPIC_API_KEY` | No | Claude API key (optional, swap via `config.ai.provider`) |
| `TAVILY_API_KEY` | Yes | Tavily search API key |
| `CHROMADB_URL` | No | ChromaDB URL (default: `http://localhost:8000`) |
| `AMAZON_AFFILIATE_TAG` | No | Amazon Associates tag appended to product links |
| `NODE_ENV` | No | `development` / `production` / `test` |
| `LOG_LEVEL` | No | `error` / `warn` / `info` / `debug` |
