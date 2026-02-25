# DeskCurator

An AI-powered Discord bot that researches desk-setup products and generates affiliate articles. Two autonomous agents work together: **ContentResearcher** finds and analyses products, **ContentWriter** plans and writes full affiliate articles.

---

## Prerequisites

| Dependency | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 | |
| npm | ≥ 9 | |
| Docker | any recent | Required for ChromaDB |
| Discord Server | — | Developer Mode enabled |

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

### 4. Discord bot permissions

Your bot needs these permissions in both channels:
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

Both agents start automatically. On launch the bot sends a startup message to each channel confirming it is online.

---

## Discord Commands

### `#content-researcher` channel

| Command | Description |
|---|---|
| `!research <product name>` | Research a single product. The bot runs Tavily search + AI analysis, then posts findings for approval. |

### `#writer-editor` channel

| Command | Description |
|---|---|
| `!write "<article title>"` | Create a multi-product affiliate article. Triggers the full hybrid workflow (see below). |
| `!status` | List all article jobs with their current status and research progress. |
| `!cancel <jobId>` | Cancel an article job or a queued research job by ID. |

---

## Article Workflow (`!write`)

The ContentWriter uses a hybrid sync/async approach:

```
!write "5 Best Desk Items For Your WFH Setup"
  │
  ├─ [SYNC] Creates a Discord thread in #writer-editor for this article
  │
  ├─ [SYNC] Calls ContentResearcher directly for initial category discovery
  │         → Research approval posted in #content-researcher
  │
  ├─ [ASYNC] Creates 5 QueueResearchJobs in SQLite (status: pending)
  │          → Notifies thread: "Queued 5 research jobs"
  │
  ├─ ContentResearcher polls queue every 5s, picks up jobs one by one
  │   Each job → Tavily search → AI analysis → approval in #content-researcher
  │   On approve → job marked 'approved', article completedResearchCount++
  │
  └─ ContentWriter polls every 10s
      When all jobs approved → generates full article with AI
      → Article draft approval posted in the article thread
      → On approve → saved to output/articles/<id>.md
```

**All article notifications (queued, writing, draft approval, published) appear in the article's thread in `#writer-editor`. Research approvals appear in `#content-researcher`.**

---

## Project Structure

```
src/
├── agents/
│   ├── content-researcher/
│   │   ├── ContentResearcher.ts    # Research pipeline + queue polling
│   │   └── context/                # System prompt + AI prompts
│   ├── content-writer/
│   │   ├── ContentWriter.ts        # Hybrid article workflow + polling
│   │   └── context/                # System prompt + article prompts
│   └── product-analyzer/           # Placeholder (Phase 4)
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

**Output:** Published articles are written as Markdown files to `output/articles/<jobId>.md`.

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

See [architecture.md](architecture.md) for the detailed system design, database schema, and agent workflow diagrams.
