# HAR Reverse Engineer

Upload a HAR file, describe an API in plain English, get a ready-to-use curl command.

## How It Works

1. **Upload** a `.har` file (browser DevTools → Network → Export HAR)
2. **Describe** the API you're looking for (e.g., "the weather forecast endpoint")
3. **Get** a curl command for the matching request, ready to copy and execute
4. **Run it** directly from the browser via the built-in execution proxy

An 8-layer filtering pipeline removes ~85% of noise (static assets, tracking pixels, CORS preflights, redirects), deduplicates repeated requests, and summarizes what's left into a token-efficient format. An LLM semantically matches your description to the right request. The curl command is generated deterministically from the original HAR entry — the LLM never touches curl generation, so there's zero hallucination.

## Setup

### Prerequisites

- Node.js 20+
- An [OpenAI API key](https://platform.openai.com/api-keys)

### Install & Run

```bash
git clone <repo-url> && cd har-reverse-engineer

# Configure your API key
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Install all dependencies (backend + frontend)
npm install

# Start both servers
npm run dev
```

That's it. Open **http://localhost:3000** and upload a HAR file.

> Backend runs on port 3001. Both servers start together via `npm run dev`.

### Docker Alternative

```bash
cp .env.example .env   # Add your OPENAI_API_KEY
docker-compose up
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model used for request matching |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin |

## Features

- **8-layer filtering pipeline**: removes static assets, tracking/analytics domains, CORS preflights, redirects, aborted requests, and non-API MIME types
- **Smart deduplication**: `/users/123` and `/users/456` collapse into `/users/{id} (×2)` — UUIDs handled too
- **GraphQL support**: requests to `/graphql` differentiated by `operationName`
- **In-browser execution**: run the generated curl via an SSRF-protected proxy and see the response
- **Response diff**: compare the original HAR response with the live execution result
- **Multi-language output**: curl, Python, JavaScript, Go, Ruby
- **Secret detection**: auto-extracts Bearer tokens, API keys, and cookies into environment variables
- **HAR inspector**: sortable, filterable table of all requests in the file
- **Collection history**: saved analyses accessible via sidebar (press `H`)

## Architecture

```
har-reverse-engineer/
├── backend/              NestJS 11 API server (port 3001)
│   ├── analysis/         HAR parsing, filtering, dedup, summarization, curl gen
│   └── openai/           LLM integration for semantic matching
├── frontend/             Next.js 16 app (port 3000)
│   ├── components/       Upload, inspector, curl output, response viewer, diffs
│   └── api/proxy/        SSRF-protected curl execution proxy
├── test-fixtures/        HAR fixtures (synthetic + real-world)
└── docs/                 Architecture docs and research notes
```

### Data Flow

```
Upload .har → Parse → 8-layer filter (~85% removed) → Deduplicate → Summarize
    → LLM returns match index → Deterministic curl generation → Display
    → (Optional) Execute via SSRF proxy → Show response + diff
```

### Token Efficiency

The LLM sees a compact grouped summary, not raw HAR data:

```
=== HAR Analysis: 5 unique API requests (12 total, duplicates collapsed) from 200 raw entries ===

[api.weather.com] (2 requests, Auth: Bearer ***)
  0. GET /v3/wx/forecast?geocode=37.77,-122.42 → 200 json (2.0KB)
  1. GET /v3/wx/conditions?geocode=37.77,-122.42 → 200 json (800B)

[api.example.com] (3 requests, Auth: Bearer ***)
  2. POST /graphql:GetUser → 200 json body: {"operationName":"GetUser"...  (×3)
  3. GET /api/v2/users/{id} → 200 json (4.5KB)  (×2)
  4. POST /graphql:GetFeed → 200 json body: {"operationName":"GetFeed"...
```

200 raw entries → 12 after filtering → 5 unique after dedup → ~100 tokens of LLM input.

| HAR Size | Naive cost (full entries) | This approach | Savings |
|----------|--------------------------|---------------|---------|
| 20 entries | ~$0.05 | ~$0.0007 | 98.6% |
| 200 entries | ~$0.32 | ~$0.002 | 99.4% |
| 2000 entries | ~$3.20 | ~$0.012 | 99.6% |

## Testing

~334 tests across 15 files.

```bash
cd backend

# Unit tests (fast, no API key needed)
npx jest har-parser har-to-curl analysis.service analysis.controller openai.service proxy-ssrf performance --verbose

# Full eval suite (needs OPENAI_API_KEY)
npx jest eval.spec --testTimeout=120000 --verbose

# All tests
npx jest
```

See [docs/13-complete-test-suite-overview.md](./docs/13-complete-test-suite-overview.md) for the full test inventory (unit, eval, e2e, stress tests).

## Security

- **SSRF protection**: blocks private IPs, localhost, link-local, cloud metadata endpoints, IPv6-mapped addresses
- **Rate limiting**: 5 req/10s burst + 20 req/min sustained
- **No secrets in client**: OpenAI key stays on the backend
- **Memory-only uploads**: HAR files never written to disk
- **Shell-safe curl**: all values single-quoted, no shell expansion

## Tech Stack

| | Technology |
|-|------------|
| Backend | NestJS 11, TypeScript 5.7 |
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Components | shadcn/ui, Radix UI, TanStack React Table 8 |
| LLM | OpenAI SDK 6 (gpt-4o-mini) |
| Testing | Jest 30, Playwright |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+Enter` | Analyze |
| `H` | Toggle collection history |
| `I` | Toggle tech info |
| `?` | Toggle keyboard shortcuts |

## Docs

Detailed architecture, research, and design docs are in [`docs/`](./docs/).
