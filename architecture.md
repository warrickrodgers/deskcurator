# DeskCurator — Architecture

**Status:** Phase 3 complete (ContentWriter agent operational)
**Last Updated:** February 2026

---

## Overview

DeskCurator is a two-agent Discord bot for generating affiliate content about desk-setup products. The agents communicate via a SQLite job queue and interact with a human admin through separate Discord channels.

```
Admin
  │
  ├── #content-researcher ──► ContentResearcher Agent
  │                               │ Tavily search
  │                               │ Gemini AI analysis
  │                               │ ChromaDB dedup
  │                               │ SQLite persistence
  │
  └── #writer-editor ────────► ContentWriter Agent
          (threads per article)       │ Hybrid sync/async workflow
                                      │ Reads from SQLite queue
                                      │ Generates articles via AI
```

---

## Discord Channel Architecture

Two dedicated channels enforce strict separation of concerns:

| Channel | Agent | Commands | Notifications |
|---|---|---|---|
| `#content-researcher` | ContentResearcher | `!research <product>` | Research approval embeds, skip/reject notices |
| `#writer-editor` | ContentWriter | `!write "<title>"`, `!status`, `!cancel <jobId>` | Article threads, startup message |

### Article Threads

When `!write` is issued, ContentWriter creates a **public Discord thread** inside `#writer-editor` named after the article title. All article-level events post into that thread:

- Phase 1 complete / categories identified
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
researchProduct(query)
  │
  ├─ ChromaDB dedup check (0.85 cosine similarity threshold)
  ├─ Tavily: 3 parallel searches (info, reviews, competitors)
  ├─ Gemini: pros/cons analysis (JSON)
  ├─ Gemini: competitor analysis (JSON)
  ├─ Gemini: affiliate summary
  ├─ Confidence scoring
  ├─ Store in ChromaDB
  ├─ Persist to SQLite (products + research_jobs)
  └─ Discord approval in #content-researcher
       → approved: return ResearchFindings
       → rejected: return null
```

Queue job processing re-uses `researchProduct()` and then updates the `queue_research_jobs` row + increments the parent article's `completedResearchCount`.

### ContentWriter

**File:** [src/agents/content-writer/ContentWriter.ts](src/agents/content-writer/ContentWriter.ts)

Hybrid sync/async workflow:

```
createArticle(request)          ← triggered by !write
  │
  ├─ Create Discord thread in #writer-editor
  │
  ├─ [SYNC] Call contentResearcher.researchProduct(discoveryQuery)
  │    → approval in #content-researcher
  │    → extract categories from findings via AI
  │
  ├─ INSERT article_job (status: pending_research)
  ├─ INSERT N × queue_research_jobs (status: pending, priority: 7)
  └─ Notify thread: "Queued N research jobs"

pollForCompletedResearch()      ← runs every 10s
  │
  └─ For each pending_research article:
       Check all linked queue_research_jobs
       All approved? → writeArticle()
       All done but some failed? → writeArticle() with approved subset

writeArticle(article, jobs)
  │
  ├─ Gemini: articleGenerationPrompt → markdown draft
  ├─ Gemini: seoMetaPrompt → meta description
  ├─ Update article_job (status: awaiting_approval, draftContent)
  ├─ Discord approval in article thread
  │    → approved: publishArticle()
  └─   → rejected: update status, post feedback to thread

publishArticle()
  ├─ Write output/articles/<id>.md
  ├─ Update article_job (status: published, finalContent, publishedAt)
  └─ Notify thread: "Article published!"
```

---

## Database Schema (SQLite)

**File:** [src/services/database.service.ts](src/services/database.service.ts)

### `products`
Tracks product metadata created during `!research` flows.

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
Tracks legacy `!research` job runs (tied to a product).

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
| query | TEXT | e.g. "Best standing desk for WFH Setup" |
| requested_by | TEXT | writer / user |
| parent_job_id | TEXT | → article_jobs.id |
| findings | TEXT | JSON-serialized ResearchFindings |
| discord_message_id | TEXT | |
| created_at / started_at / completed_at | TEXT | |
| failure_reason | TEXT | |
| retry_count / max_retries | INTEGER | default 0 / 3 |

### `article_jobs`
Tracks full article lifecycle from queue to publish.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID |
| status | TEXT | pending_research / writing / awaiting_approval / approved / rejected / published / failed |
| title | TEXT | e.g. "5 Best Desk Items For Your WFH Setup" |
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

---

## Service Layer

### AI Service
**File:** [src/services/ai.service.ts](src/services/ai.service.ts)

Provider abstraction over Gemini and Anthropic. Features:
- Swappable provider via `config.ai.provider`
- Token bucket rate limiting per provider
- Exponential backoff retry (up to `maxRetries`)
- Token usage tracking
- `ask(prompt, systemPrompt?)` — single-turn helper used by all agents

**Active provider:** Gemini `gemini-2.5-flash`

### ChromaDB Service
**File:** [src/services/chroma.service.ts](src/services/chroma.service.ts)

Vector store for research deduplication.
- Embeddings via `gemini-embedding-001`
- Cosine similarity collection
- `hasSimilarResearch(name, category, query)` — returns true if similarity ≥ 0.85
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
- **Channel routing** — `!research` only handled in researcher channel; `!write`/`!status`/`!cancel` only in writer channel
- **`sendNotification(message, channelId?)`** — sends to researcher channel by default; accepts explicit channel or thread ID
- **`requestApproval(request, channelId?)`** — posts embed with Approve / Reject / Request Edit buttons; waits for interaction
- **`createArticleThread(title)`** — creates a public thread in the writer channel; returns thread ID
- **Handler registration** — `registerResearchHandler`, `registerWriteHandler`, `registerStatusHandler`, `registerCancelHandler`

### Job Queue Service
**File:** [src/services/jobQueue.service.ts](src/services/jobQueue.service.ts)

Thin wrapper over `databaseService` for queue semantics:
- `enqueueResearch(params)` — creates a `queue_research_job` with defaults
- `dequeueNext()` — atomically fetches the highest-priority pending job and marks it `in_progress`
- `createArticle(params)` — creates an `article_job`

### Database Service
**File:** [src/services/database.service.ts](src/services/database.service.ts)

SQLite via `better-sqlite3`. WAL mode, foreign keys enabled. All SELECT queries use explicit column aliases for snake_case → camelCase mapping. Additive migrations run on startup (safe on existing databases).

---

## Prompt Templates

### ContentResearcher
**File:** [src/agents/content-researcher/context/prompts.ts](src/agents/content-researcher/context/prompts.ts)

| Prompt | Purpose |
|---|---|
| `analyzeProsConsPrompt` | Extract structured pros/cons JSON from search results |
| `competitorPrompt` | Identify top 3–5 competitors with differentiators |
| `summaryPrompt` | Write affiliate-optimised 3–4 paragraph summary |

### ContentWriter
**File:** [src/agents/content-writer/context/prompts.ts](src/agents/content-writer/context/prompts.ts)

| Prompt | Purpose |
|---|---|
| `categoryDiscoveryPrompt` | Generate N product category names for an article title |
| `categoryExtractionPrompt` | Parse N categories from an existing research summary |
| `articleGenerationPrompt` | Write full markdown article (supports all 4 article types) |
| `seoMetaPrompt` | Write a 150–160 char SEO meta description |

---

## End-to-End Example

```
T+0s   Admin: !write "5 Best Desk Items For Your WFH Setup"
T+1s   Bot creates Discord thread: "5 Best Desk Items For Your WFH Setup"
T+2s   Thread: "Phase 1: running initial discovery…"
T+2s   ContentResearcher: researches "top 5 WFH desk product categories"
T+12s  #content-researcher: approval embed for category research
T+15s  Admin: Approve
T+16s  Thread: "Phase 1 complete — 5 categories found:
               1. Standing Desk  2. Ergonomic Chair  3. Monitor Arm
               4. Desk Lamp  5. Keyboard Tray
               Queued 5 research jobs"

T+17s  queue_research_jobs: 5 rows inserted (status: pending)

── ContentResearcher polls every 5s ──────────────────────────────────────────

T+20s  Picks up job: "Best standing desk for WFH Setup"
T+35s  #content-researcher: "Standing desk research" approval embed
T+38s  Admin: Approve  →  job approved, article completedCount → 1/5

T+40s  Picks up job: "Best ergonomic chair for WFH Setup"
T+55s  Admin: Approve  →  completedCount → 2/5

       … (repeat for monitor arm, desk lamp, keyboard tray) …

T+4m   All 5 jobs approved, completedCount → 5/5

── ContentWriter polls every 10s ─────────────────────────────────────────────

T+4m   Detects all research complete for article
T+4m   Thread: "Writing article… generating draft now…"
T+5m   Gemini generates full markdown article + SEO meta
T+5m   article_jobs: status → awaiting_approval
T+5m   Thread: approval embed with article draft preview
T+8m   Admin: Approve
T+8m   output/articles/<id>.md written
T+8m   Thread: "Article published! File: output/articles/<id>.md"
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
