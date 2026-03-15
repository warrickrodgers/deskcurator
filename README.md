# DeskCurator

An AI-powered Discord bot that researches desk-setup products and generates SEO-optimised affiliate articles. Three autonomous agents work together: **ContentResearcher** discovers and analyses products, **ContentWriter** plans and writes full buyer's guide articles, and **SeoOptimizer** scores and refines each article before publication.

---

## Prerequisites

| Dependency | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 | |
| npm | ≥ 9 | |
| Docker | any recent | Required for ChromaDB |
| Discord Server | — | Developer Mode enabled, three channels required |

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start ChromaDB (vector store)

```bash
docker-compose up -d
```

ChromaDB runs at `http://localhost:8000` by default.

### 3. Configure environment

Copy `.env` and fill in your values:

```bash
cp .env .env.local   # optional — .env is already gitignored
```

Edit `.env`:

```env
# Discord
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_GUILD_ID=your_server_id
DISCORD_RESEARCHER_CHANNEL_ID=your_content-researcher_channel_id
DISCORD_WRITER_CHANNEL_ID=your_writer-editor_channel_id
DISCORD_SEO_OPTIMIZER_CHANNEL_ID=your_seo-optimizer_channel_id
DISCORD_ADMIN_USER_ID=your_user_id

# AI (Gemini required, Anthropic optional)
GEMINI_API_KEY=your_gemini_key
ANTHROPIC_API_KEY=your_anthropic_key   # optional

# Search & storage
TAVILY_API_KEY=your_tavily_key
CHROMADB_URL=http://localhost:8000

# Amazon affiliate (optional)
AMAZON_AFFILIATE_TAG=your-tag-20
```

**Getting Discord IDs:** Enable Developer Mode (User Settings → Advanced → Developer Mode), then right-click servers, channels, and users to copy their IDs.

**Three channels required:** Create `#content-researcher`, `#writer-editor`, and `#seo-optimizer` in your Discord server.

### 4. Discord bot permissions

Your bot needs these permissions in all three channels:
- Read Messages / View Channel
- Send Messages
- Send Messages in Threads
- Create Public Threads
- Embed Links
- Use External Emojis

### 5. Build

```bash
npm run build
```

---

## Running

### Development (auto-restart on file changes)

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

All three agents start automatically. On launch the bot sends a startup message to each channel confirming it is online.

---

## Discord Commands

### `#content-researcher` channel

| Command | Description |
|---|---|
| `!research <product name>` | Research a single product. The bot runs Tavily search + AI analysis, then posts findings for approval. |

### `#writer-editor` channel

| Command | Description |
|---|---|
| `!write "<article title>"` | Create a multi-product affiliate article. Triggers the full pipeline (discovery → research → write → SEO). |
| `!status` | List all article jobs with their current status and research progress. |
| `!cancel <jobId>` | Cancel an article job or a queued research job by ID. |
| `!retry-write <articleId>` | Re-generate an article using existing approved research — no new searches. |
| `!seo-report <articleId>` | Print the full SEO audit for any article. |

### `#seo-optimizer` channel

SEO audit reports are posted here automatically after every article run. No commands required.

---

## Article Workflow (`!write`)

```
!write "Best Monitor Light Bars"
  │
  ├─ Creates a Discord thread in #writer-editor for this article
  │
  ├─ [PHASE 1] AI Product Discovery
  │   ContentResearcher asks Gemini for ~8 real products in the category
  │   Each candidate validated (brand + model check)
  │   Top 5 validated products selected for research
  │
  ├─ [PHASE 2] Parallel Research Queue
  │   5 QueueResearchJobs created in SQLite
  │   ContentResearcher polls queue every 5s:
  │     Tavily search (info + reviews + competitors)
  │     Gemini AI analysis → pros, cons, competitor summary
  │     Confidence ≥ 75%? → approval posted in #content-researcher
  │   Admin approves each → completedResearchCount++
  │
  ├─ [PHASE 3] Article Generation
  │   All research approved → Gemini Flash writes full buyer's guide
  │   Draft approval posted in the article thread
  │   Admin: Approve / Reject
  │
  └─ [PHASE 4] SEO Optimization + Revision Loop
      SeoOptimizer scores the article (9 deterministic checks, 0–100)
      Audit posted to #seo-optimizer

      PASS (≥ 75) → article published to output/articles/<id>.md ✅
      REVISION (65–74 or auto-fail rule triggered):
        Writer regenerates with targeted improvement brief
        SEO re-runs — up to 2 revision attempts
        Still failing → manual_review flagged in #writer-editor ⚠️
      FAIL (<65) → article marked failed ❌
```

**Auto-fail rules** (trigger revision regardless of score):
- Word count < 1500
- Fewer than 3 products covered
- Primary keyword missing from first 150 words
- No Amazon affiliate links
- Fewer than 3 H2 sections

**All article notifications appear in the article's thread in `#writer-editor`.
Research approvals appear in `#content-researcher`.
SEO audit reports appear in `#seo-optimizer`.**

---

## Project Structure

```
src/
├── agents/
│   ├── content-researcher/
│   │   ├── ContentResearcher.ts    # Discovery + research pipeline + queue polling
│   │   └── context/                # System prompt + AI prompts
│   ├── content-writer/
│   │   ├── ContentWriter.ts        # Article workflow + SEO revision loop
│   │   └── context/                # System prompt + article + revision prompts
│   ├── seo-optimizer/
│   │   ├── SeoOptimizer.ts         # Scoring, AI validation, decision, notifications
│   │   ├── seoScoring.ts           # Pure deterministic scoring functions
│   │   ├── seoTypes.ts             # SeoResult, SeoAuditReport, SeoChecks, SeoDecision
│   │   └── context/                # System prompt + SEO validation prompt
│   └── product-analyzer/           # Placeholder (Phase 5)
│
├── services/
│   ├── ai.service.ts               # Provider abstraction, rate limiting, retries
│   ├── anthropic.provider.ts       # Anthropic Claude provider
│   ├── gemini.provider.ts          # Google Gemini provider (default)
│   ├── chroma.service.ts           # ChromaDB vector store (deduplication)
│   ├── database.service.ts         # SQLite — all persistent state
│   ├── discord.ts                  # Discord client, commands, approvals, threads
│   ├── jobQueue.service.ts         # Queue job lifecycle wrapper
│   └── search.service.ts           # Tavily web search
│
├── config/
│   └── env.ts                      # Zod-validated environment config
│
├── types/
│   ├── index.ts                    # Core domain types
│   ├── jobs.ts                     # Queue/article job types and status enums
│   └── ai.types.ts                 # AI provider interfaces
│
├── utils/
│   ├── logger.ts                   # Winston logger (file + console)
│   ├── rateLimiter.ts              # Token bucket rate limiter
│   └── retry.ts                    # Exponential backoff retry
│
└── index.ts                        # Application entry point
```

**Output:**
- Published articles → `output/articles/<jobId>.md`
- SEO metadata → `output/articles/<jobId>_seo.json`

---

## Development

```bash
npm run dev      # Start with ts-node-dev (auto-restart)
npm run build    # TypeScript compile to dist/
npm start        # Run compiled output
npm test         # Jest test suite
npm run lint     # ESLint
```

**Logs** are written to `logs/combined.log` and `logs/error.log`.

---

## Architecture

See [architecture.md](architecture.md) for the detailed system design, database schema, agent workflow diagrams, and SEO scoring rules.
