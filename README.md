# HAR Reverse Engineer

Upload a HAR file, describe an API in plain English, get a ready-to-use curl command.

## How It Works

1. **Upload** a `.har` file (exported from browser DevTools → Network → Export HAR)
2. **Describe** the API you're looking for (e.g., "the weather forecast endpoint")
3. **Get** a curl command for the matching request, ready to copy and execute
4. **Run it** directly from the browser via the built-in execution proxy

The app pre-filters HAR entries, deduplicates repeated requests, summarizes them in a token-efficient grouped format, and uses an LLM to semantically match your description to the right API request. The curl command is generated deterministically from the original HAR entry — the LLM never touches curl generation, ensuring zero hallucination.

## Features

- **Smart filtering**: 7-layer pipeline removes static assets, tracking pixels, CORS preflights, redirects, and non-API content (~85% noise reduction)
- **Deduplication**: Repeated requests collapsed with `(×N)` annotation — path-parameterized so `/users/123` and `/users/456` are recognized as the same endpoint
- **GraphQL discrimination**: Requests to `/graphql` are differentiated by `operationName` (e.g., `POST /graphql:GetUser` vs `POST /graphql:GetFeed`)
- **UUID parameterization**: UUIDs in paths replaced with `/{id}` for cleaner grouping
- **Grouped summaries**: Entries grouped by hostname with shared auth context, ~20 tokens per entry
- **Response previews**: First 150 chars of response body included to aid semantic matching
- **Deterministic curl**: Shell-safe generation with single-quoting, `--data-raw`, and proper header filtering
- **In-browser execution**: SSRF-protected proxy for running curl commands directly
- **HAR inspector**: Full request table with filtering, sorting, and detail view

## Quick Start

### Option 1: npm (development)

```bash
# Prerequisites: Node.js 20+
cp .env.example .env  # Add your OPENAI_API_KEY
npm install
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

### Option 2: Docker

```bash
cp .env.example .env  # Add your OPENAI_API_KEY
docker-compose up
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model for API matching |

---

## Architecture

```
├── backend/              NestJS API server (port 3001)
│   ├── analysis/         HAR parsing, filtering, dedup, summarization, curl generation
│   └── openai/           LLM integration for semantic request matching
├── frontend/             Next.js app (port 3000)
│   ├── components/       File upload, HAR inspector, curl output, response viewer
│   └── api/proxy/        SSRF-protected curl execution proxy
├── test-fixtures/        HAR fixtures for eval suite (10 scenarios)
├── docs/                 Research & architecture documentation
└── docker-compose.yml
```

### Data Flow

```
User uploads .har file
       ↓
  Client-side JSON parse + validation
       ↓
  HAR inspector table populated
       ↓
  User types API description → POST /api/analyze
       ↓
  Parse HAR → Pre-filter (7 layers, remove ~85% noise)
       ↓
  Deduplicate (parameterize paths, collapse repeats with ×N)
       ↓
  Generate grouped summary (~20 tokens/entry)
       ↓
  LLM returns index of best match (+ confidence + reason)
       ↓
  Deterministic curl generation from original HAR entry
       ↓
  Display curl + Copy/Execute buttons
       ↓
  (Optional) Execute via SSRF-protected proxy → show response
```

### Token Efficiency in Action

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

### Token Savings

| HAR Size | Naive (full entries) | Our approach | Savings |
|----------|---------------------|--------------|---------|
| 20 entries | ~$0.05 | ~$0.0007 | **98.6%** |
| 200 entries | ~$0.32 | ~$0.002 | **99.4%** |
| 2000 entries | ~$3.20 | ~$0.012 | **99.6%** |

---

## Eval Suite

The project includes a comprehensive evaluation suite with **63 test cases** across **10 categories** and **4 difficulty levels**.

| Metric | Value |
|--------|-------|
| Total test cases | 63 |
| Categories | 10 (basic, recipe, e-commerce, GraphQL, noisy, dashboard, streaming, fintech, travel, collab) + vague |
| Difficulty levels | Easy (5), Medium (21), Hard (25), Extreme (12) |
| Pass rate | **98.3%** (59/60 on core tests) |
| Avg confidence | >90% |

```bash
# Run eval suite
cd backend
npx jest eval.spec.ts --verbose
```

See [docs/EVAL-AND-TESTING.md](./docs/EVAL-AND-TESTING.md) for details on categories, fixtures, and adding new tests.

---

## Security

- **SSRF protection** on the curl execution proxy: blocks private IPs (`10.x`, `172.16-31.x`, `192.168.x`), localhost, link-local (`169.254.x`), cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), non-HTTP protocols
- **File validation**: HAR structure validated both client-side and server-side
- **No secrets in client**: OpenAI API key stays on the backend
- **Memory-only file handling**: uploaded files are never written to disk
- **Shell-safe curl generation**: all values single-quoted, no shell expansion possible

## Tech Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Backend framework | NestJS | 11 |
| Frontend framework | Next.js | 16 |
| UI library | React | 19 |
| Styling | Tailwind CSS | 4 |
| Components | shadcn/ui + Radix UI | — |
| Data table | TanStack React Table | 8 |
| LLM SDK | OpenAI Node SDK | 6 |
| Language | TypeScript | 5.7 |
| Testing | Jest | 30 |
| Infrastructure | Docker, npm workspaces | — |

## Tech Decisions

| Decision | Rationale |
|----------|-----------|
| LLM returns index, not curl | Zero hallucination — deterministic curl generation from original HAR entry |
| Pre-filter before LLM | ~85% entry reduction for free, no token cost, no API call |
| Deduplication with ×N | Collapse repeated endpoints to reduce token count without losing information |
| GraphQL operationName keying | `/graphql` requests are only distinguishable by their operation — include it in the dedup key |
| UUID parameterization | `/users/550e8400-...` → `/users/{id}` for cleaner grouping |
| Grouped summary format | Hostname grouping + shared auth reduces token repetition |
| `gpt-4o-mini` default | Best cost/accuracy ratio for structured matching tasks |
| `--data-raw` over `-d` | Prevents `@` file interpretation in POST bodies |
| Single-quote shell escaping | Prevents `$`, `!`, `&` expansion — safest approach |
| Memory-only file storage | HAR files contain sensitive auth data — never touch disk |
| Custom curl generator | Archived `har-to-curl` package has issues; focused custom code is better |
| Conservative pre-filter | Better to include noise than miss the target API |

## Development

```bash
# Install dependencies
npm install

# Run dev servers (frontend + backend)
npm run dev

# Run backend unit tests
cd backend && npx jest

# Run eval suite (requires OPENAI_API_KEY)
cd backend && npx jest eval.spec.ts --verbose

# Build for production
npm run build
```

## Documentation

| Document | Description |
|----------|-------------|
| [PLANNING.md](./docs/PLANNING.md) | Project goals, design principles, decisions, and roadmap |
| [SYSTEM-ARCHITECTURE.md](./docs/SYSTEM-ARCHITECTURE.md) | Component breakdown, data flow, filtering pipeline, LLM integration |
| [EVAL-AND-TESTING.md](./docs/EVAL-AND-TESTING.md) | Eval suite design, running tests, adding fixtures |
| [TOKEN-OPTIMIZATION-GUIDE.md](./docs/TOKEN-OPTIMIZATION-GUIDE.md) | Token optimization funnel, cost analysis, dedup strategy |
| [01-HAR-FORMAT-AND-PARSING.md](./docs/01-HAR-FORMAT-AND-PARSING.md) | Research: HAR 1.2 spec, critical fields, edge cases |
| [02-REVERSE-ENGINEERING-PATTERNS.md](./docs/02-REVERSE-ENGINEERING-PATTERNS.md) | Research: signal ranking, scoring, protocol patterns |
| [03-CURL-GENERATION.md](./docs/03-CURL-GENERATION.md) | Research: shell safety, header classification, method inference |
| [04-TOKEN-EFFICIENCY.md](./docs/04-TOKEN-EFFICIENCY.md) | Research: token cost analysis, reduction pipeline, OpenAI optimizations |
| [05-ARCHITECTURE-AND-IMPLEMENTATION.md](./docs/05-ARCHITECTURE-AND-IMPLEMENTATION.md) | Research: design principles, separation of concerns, security model |
