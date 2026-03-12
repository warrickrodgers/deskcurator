# DeskCurator — Architecture

**Status:** Phase 3 complete (ContentWriter agent operational with quality gates and error resilience)
**Last Updated:** March 2026

---

## Overview

DeskCurator is a two-agent Discord bot for generating affiliate content about desk-setup products. The agents communicate via a SQLite job queue and interact with a human admin through separate Discord channels.

```
Admin
  │
  ├── #content-researcher ──► ContentResearcher Agent
  │                               │ Pre-flight product validation
  │                               │ Tavily search (3 parallel)
  │                               │ Gemini Flash Lite analysis
  │                               │ ChromaDB dedup
  │                               │ Confidence scoring (75% threshold)
  │                               │ SQLite persistence
  │
  └── #writer-editor ────────► ContentWriter Agent
          (threads per article)       │ Hybrid sync/async workflow
                                      │ Reads from SQLite queue
                                      │ Gemini Flash article generation
```

---

## Discord Channel Architecture

Three dedicated channels enforce strict separation of concerns:

| Channel | Agent | Commands | Notifications |
|---|---|---|---|
| `#content-researcher` | ContentResearcher | `!research <product>` | Research approval embeds, validation skip/reject notices, confidence rejection alerts |
| `#writer-editor` | ContentWriter | `!write "<title>"`, `!status`, `!cancel <jobId>`, `!retry-write <articleId>`, `!seo-report <articleId>` | Article threads, startup message |
| `#seo-optimizer` | SeoOptimizer | — | SEO audit reports (score, keyword, checks, competitor gaps) posted automatically after each article is approved |

**Env var:** `DISCORD_SEO_OPTIMIZER_CHANNEL_ID` → `config.discord.seoChannelId`

### Article Threads

When `!write` is issued, ContentWriter creates a **public Discord thread** inside `#writer-editor` named after the article title. All article-level events post into that thread:

- Phase 1 complete / products identified
- Parallel research jobs queued
- Writing in progress
- Draft approval embed (Approve / Reject / Request Edit)
- Published confirmation

Individual **research job approvals** always appear in `#content-researcher`, regardless of whether they were queued by the writer or triggered by `!research`.

---

## Agent Architecture

### ContentResearcher

**File:** [src/agents/content-researcher/ContentResearcher.ts](src/agents/content-researcher/ContentResearcher.ts)

Runs two modes concurrently:

1. **Direct research** — called synchronously by ContentWriter for initial category discovery, or triggered by `!research` command.
2. **Queue polling** — polls `queue_research_jobs` every 5 seconds for pending writer-created jobs.

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

#### Product Validation

Before any expensive searches run, a Gemini call checks whether the topic is a real purchasable product (brand + model). Topics that are features, mechanisms, buying strategies, or generic categories are rejected immediately. Discovery queries from ContentWriter pass `skipValidation: true` to bypass this check — article titles aren't product names.

#### Confidence Scoring

Scores are calculated from: high-credibility source count, number of pros/cons extracted, total source count, and average Tavily relevance score. Research scoring below **75%** is automatically rejected and never sent for Discord approval.

---

### ContentWriter

**File:** [src/agents/content-writer/ContentWriter.ts](src/agents/content-writer/ContentWriter.ts)

Hybrid sync/async workflow:

```
createArticle(request)          ← triggered by !write
  │
  ├─ Create Discord thread in #writer-editor
  │
  ├─ [SYNC] Build discovery query (product-focused, skipValidation: true)
  │    → contentResearcher.researchProduct(discoveryQuery, { skipValidation: true })
  │    → extract 3–5 specific named products via AI (categoryDiscovery / categoryExtraction)
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
  ├─ Update article_job (status: awaiting_approval, draftContent)
  ├─ Discord approval in article thread
  │    → approved: publishArticle()
  └─   → rejected: update status, post feedback to thread

retryWrite(articleId)           ← triggered by !retry-write <articleId>
  ├─ Lookup article_job from database
  ├─ Find all approved queue_research_jobs for this article
  └─ Call writeArticle() directly with existing research

publishArticle()
  ├─ Write output/articles/<id>.md
  ├─ Update article_job (status: published, finalContent, publishedAt)
  └─ Notify thread: "Article published!"
```

**AI Model:** `gemini-3-flash-preview` — more capable model used for full article generation.

#### Discovery Query Logic

`buildDiscoveryQuery` produces product-focused prompts without accessories:
- **Broad articles** (multi_product, roundup): returns a range across categories
- **Focused articles** (single_product, comparison): keeps results within one product type

Product count is flexible: prompts ask for **3 to N** products (where N is at most 5), returning fewer if quality products are scarce.

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

Schema uses additive migrations — safe to run against existing databases.

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
| status | TEXT | pending_research / writing / awaiting_approval / approved / rejected / published / failed |
| title | TEXT | e.g. "Best Standing Desks for Tall People" |
| article_type | TEXT | single_product / multi_product / comparison / roundup |
| research_job_ids | TEXT | JSON array of queue_research_job IDs |
| required_research_count | INTEGER | |
| completed_research_count | INTEGER | incremented on each approval |
| draft_content | TEXT | AI-generated markdown |
| final_content | TEXT | approved final version |
| discord_message_id | TEXT | approval message |
| discord_thread_id | TEXT | writer-editor thread for this article |
| published_url | TEXT | future CMS URL |
| created_at / completed_at / published_at | TEXT | |
| scheduled_after | TEXT | ISO timestamp — holds article polling until time passes (used for RPD pausing) |

---

## Service Layer

### AI Service
**File:** [src/services/ai.service.ts](src/services/ai.service.ts)

Provider abstraction over Gemini and Anthropic. Two instances are exported:

| Export | Model | Used by |
|---|---|---|
| `aiService` | `gemini-3.1-flash-lite-preview` | ContentResearcher — structured JSON extraction |
| `writerAiService` | `gemini-3-flash-preview` | ContentWriter — full article generation |

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

Wraps the Tavily API. Runs three parallel searches per product:
- General product info
- User reviews
- Competitor landscape

### Discord Service
**File:** [src/services/discord.ts](src/services/discord.ts)

Manages all Discord interactions:
- **Channel routing** — `!research` only handled in researcher channel; `!write`/`!status`/`!cancel`/`!retry-write` only in writer channel
- **`sendNotification(message, channelId?)`** — sends to researcher channel by default; accepts explicit channel or thread ID
- **`requestApproval(request, channelId?)`** — posts embed with Approve / Reject / Request Edit buttons; waits for interaction
- **`createArticleThread(title)`** — creates a public thread in the writer channel; returns thread ID
- **Handler registration** — `registerResearchHandler`, `registerWriteHandler`, `registerStatusHandler`, `registerCancelHandler`, `registerRetryWriteHandler`

### Job Queue Service
**File:** [src/services/jobQueue.service.ts](src/services/jobQueue.service.ts)

Thin wrapper over `databaseService` for queue semantics:
- `enqueueResearch(params)` — creates a `queue_research_job` with defaults
- `dequeueNext()` — atomically fetches the highest-priority pending job where `scheduled_after` has passed, marks it `in_progress`
- `createArticle(params)` — creates an `article_job`

### Database Service
**File:** [src/services/database.service.ts](src/services/database.service.ts)

SQLite via `better-sqlite3`. WAL mode, foreign keys enabled. All SELECT queries use explicit column aliases for snake_case → camelCase mapping. Additive migrations run on startup (safe on existing databases). Both `queue_research_jobs` and `article_jobs` have a `scheduled_after` column added via migration to support RPD pausing.

---

## Prompt Templates

### ContentResearcher
**File:** [src/agents/content-researcher/context/prompts.ts](src/agents/content-researcher/context/prompts.ts)

| Prompt | Purpose |
|---|---|
| `validateProductPrompt` | Pre-flight check: is this a real purchasable product with brand + model? |
| `analyzeProsConsPrompt` | Extract structured pros/cons JSON from search results |
| `competitorPrompt` | Identify top 3–5 competitors with differentiators |
| `summaryPrompt` | Write affiliate-optimised 3–4 paragraph summary |

### ContentWriter
**File:** [src/agents/content-writer/context/prompts.ts](src/agents/content-writer/context/prompts.ts)

| Prompt | Purpose |
|---|---|
| `categoryDiscoveryPrompt` | Generate 3–N specific named products (brand + model) for an article title |
| `categoryExtractionPrompt` | Parse 3–N named products from an existing research summary |
| `articleGenerationPrompt` | Write structured buyer's guide (intro, table, products, considerations, verdict, FAQ) |
| `seoMetaPrompt` | Write a 150–160 char SEO meta description |

---

## End-to-End Example

```
T+0s   Admin: !write "Best Standing Desks for Tall People"
T+1s   Bot creates Discord thread: "Best Standing Desks for Tall People"
T+2s   Thread: "Phase 1: running initial discovery…"
T+2s   ContentResearcher: researches "Best products for: Best Standing Desks for Tall People"
           (skipValidation: true — title is not a product name)
T+12s  #content-researcher: approval embed for discovery research
T+15s  Admin: Approve
T+16s  Thread: "Phase 1 complete — 4 products found:
               Uplift V2 Commercial, FlexiSpot E7 Pro, Jarvis Bamboo, Autonomous SmartDesk Pro
               Queued 4 research jobs"

T+17s  queue_research_jobs: 4 rows inserted (status: pending)

── ContentResearcher polls every 5s ──────────────────────────────────────────

T+20s  Picks up job: "Uplift V2 Commercial review and specifications"
           Pre-flight validation: passes (brand + model present)
T+35s  confidence: 88% — passes threshold
T+35s  #content-researcher: approval embed
T+38s  Admin: Approve  →  job approved, article completedCount → 1/4

T+40s  Picks up job: "FlexiSpot E7 Pro review and specifications"
T+55s  Admin: Approve  →  completedCount → 2/4

       … (repeat for Jarvis Bamboo, Autonomous SmartDesk Pro) …

T+3m   All 4 jobs approved, completedCount → 4/4

── ContentWriter polls every 10s ─────────────────────────────────────────────

T+3m   Detects all research complete for article
T+3m   Thread: "Writing article… generating draft now…"
T+4m   Gemini Flash generates full buyer's guide markdown + SEO meta
T+4m   article_jobs: status → awaiting_approval
T+4m   Thread: approval embed with article draft preview
T+7m   Admin: Approve
T+7m   output/articles/<id>.md written
T+7m   Thread: "Article published! File: output/articles/<id>.md"

── Manual retry example ──────────────────────────────────────────────────────

       Admin: !retry-write abc123
       Bot looks up article abc123, finds its approved research jobs
       Calls writeArticle() directly — no new research needed
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
| `DISCORD_ADMIN_USER_ID` | Yes | Your Discord user ID (receives approval pings) |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `ANTHROPIC_API_KEY` | No | Claude API key (optional, swap via `config.ai.provider`) |
| `TAVILY_API_KEY` | Yes | Tavily search API key |
| `CHROMADB_URL` | No | ChromaDB URL (default: `http://localhost:8000`) |
| `AMAZON_AFFILIATE_TAG` | No | Amazon Associates tag appended to product links |
| `NODE_ENV` | No | `development` / `production` / `test` |
| `LOG_LEVEL` | No | `error` / `warn` / `info` / `debug` |
