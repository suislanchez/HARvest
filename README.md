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
├── test-fixtures/        HAR fixtures for eval suite (10 synthetic + 4 real-world)
│   ├── captured/         Playwright-captured browser HARs (gitignored)
│   └── capture-real-hars.ts  Automated HAR capture script
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

### Real-World Token Usage (measured)

| HAR File | Raw Entries | After Filter | LLM Input Tokens | Time |
|----------|-----------|-------------|------------------|------|
| SFGate weather (5MB) | 117 | 9 | 1,112 | 1.5s |
| RecipeScal (1.7MB) | 37 | 5 | 373 | 1.8s |
| JokeAPI (1.7MB) | 34 | 3 | 437 | 1.3s |
| JokeAPI large (91MB) | 1,727 | 220 | 5,695 | 2.9s |

### Token Efficiency Tradeoffs

| Tradeoff | What we gain | What we lose |
|----------|-------------|-------------|
| **Pre-filtering removes ~85% of entries** | Massive token savings — 117 → 9 entries for SFGate | Could miss an API disguised as a static asset (e.g., `.js` extension serving JSON). Mitigated by conservative filtering — we keep unknown MIME types. |
| **Deduplication collapses repeated requests** | `/users/1`, `/users/2`, `/users/3` become one line with `(×3)` | Lose visibility into individual request/response differences. Mitigated by keeping the first entry's full details as representative. |
| **Body preview truncated to 120 chars** | Keeps summaries compact even for large POST bodies | LLM can't see deep nested JSON structures. Mitigated by including `operationName` extraction for GraphQL. |
| **Response preview truncated to 150 chars** | Avoids token explosion from large response bodies | LLM can't inspect full response shape. Acceptable because URL path + method + status are usually sufficient. |
| **Single LLM call per analysis** | Predictable cost (~$0.001/request), fast response | No multi-turn reasoning or clarification. Works because the summary format is information-dense. |
| **`gpt-4o-mini` instead of `gpt-4o`** | ~10x cheaper per request | Slightly lower reasoning on ambiguous cases. Measured at 100% accuracy on all assignment test cases. |

---

## Test Suite

**~334 total tests** across 15 files: 192 unit tests, 63 synthetic eval, 5 real-world eval, 57 live API e2e, and 37 true end-to-end stress tests.

```bash
cd backend

# Unit tests (192 tests, no API key needed, ~1s)
npx jest har-parser har-to-curl analysis.service analysis.controller openai.service proxy-ssrf performance --verbose

# Synthetic eval suite (63 tests, needs OPENAI_API_KEY, ~2min)
npx jest eval.spec --testTimeout=120000 --verbose

# Real-world eval (5 tests, needs OPENAI_API_KEY)
npx jest eval-real-world --testTimeout=120000 --verbose

# E2E live API tests (57 tests, needs OPENAI_API_KEY)
npx jest e2e-live --testTimeout=60000 --verbose

# True pipeline tests — full analyzeHar() + curl execution (15 tests)
npx jest e2e-pipeline --testTimeout=120000 --verbose

# HTTP integration — multipart upload through NestJS (10 tests)
npx jest e2e-http --testTimeout=120000 --verbose

# Stress tests — concurrent, large files, edge cases (12 tests)
npx jest e2e-stress --testTimeout=300000 --verbose
```

### Test Pyramid

| Layer | Suite | Tests | What It Tests |
|-------|-------|-------|---------------|
| **Unit** | 7 files | 192 | HAR parsing, filtering, curl gen, controller, OpenAI, SSRF, perf |
| **Eval** | `eval.spec.ts` | 63 | Synthetic HAR scenarios across 10 categories (real LLM) |
| **Real-World Eval** | `eval-real-world.spec.ts` | 5 | Assignment HAR files + curl execution against live APIs |
| **E2E Live APIs** | `e2e-live*.spec.ts` | 57 | Build HAR → LLM match → execute curl against 20+ public APIs |
| **Pipeline E2E** | `e2e-pipeline.spec.ts` | 15 | Full `analyzeHar()` entry point with real + captured browser HARs |
| **HTTP E2E** | `e2e-http.spec.ts` | 10 | Multipart upload through NestJS HTTP server (same path as frontend) |
| **Stress** | `e2e-stress.spec.ts` | 12 | 5 concurrent uploads, 87MB HAR, 500-entry HAR, rapid sequential, edge cases |

### Eval Suite (63 synthetic scenarios)

| Difficulty | Tests | Pass Rate | Avg Confidence |
|-----------|-------|-----------|---------------|
| Easy | 6 | 100% | 100% |
| Medium | 24 | 100% | 100% |
| Hard | 23 | 100% | 99% |
| Extreme | 10 | 100% | 96% |

10 categories: basic, recipe, e-commerce, GraphQL, noisy, dashboard, streaming, fintech, travel, collab — plus vague natural-language queries.

### Real-World Eval (assignment test cases)

Tests run against the exact HAR files and prompts from the assignment specification:

| Test Case | HAR | Entries | Correct URL Found | Confidence |
|-----------|-----|---------|-------------------|-----------|
| SFGate Weather | 5MB / 117 entries | `forecast7.com/.../san-francisco/?format=json` | 100% |
| RecipeScal | 1.7MB / 37 entries | `recipescal.com/api/bookapi` | 90% |
| JokeAPI | 1.7MB / 34 entries | `v2.jokeapi.dev/joke/Any?amount=5` | 100% |
| JokeAPI (large) | 91MB / 1,727 entries | `v2.jokeapi.dev/joke/Any?amount=5` | 100% |

### True End-to-End Pipeline Tests

Tests the full production path: **HAR file → `analyzeHar()` → LLM → curl → execute against live API → verify response**.

Uses both the existing assignment HARs and **real browser-captured HARs** from a Playwright automation script that visits public websites (Open-Meteo, USGS Earthquakes, PokeAPI, Dog CEO, Hacker News).

| Source | HARs Tested | What's Verified |
|--------|------------|-----------------|
| Assignment fixtures | 3 (jokes, weather, recipes) | Correct URL + method + confidence, then execute curl → verify response |
| Synthetic fixtures | 3 (GraphQL, e-commerce, dashboard) | LLM matches correct API pattern |
| Captured browser HARs | 6 (real sites via Playwright) | Pipeline handles real-world noise, curl executes against live APIs |
| Edge cases | 3 (static-only, empty, invalid JSON) | Proper error handling |

### HTTP Integration Tests

Spins up the actual NestJS HTTP server and tests multipart file upload — the exact same code path the frontend uses:

```
POST /api/analyze (multipart: file + description)
  → Controller → AnalysisService → OpenAI → curl gen
  → Execute returned curl → verify live API response
```

### Stress / Load Tests

| Test | What's Simulated |
|------|-----------------|
| 5 concurrent pipeline calls | Parallel `analyzeHar()` — all must succeed |
| 3 concurrent HTTP uploads | Parallel `POST /api/analyze` |
| 87MB HAR file | Large file processing without timeout |
| 500+ entry synthetic HAR | Filtering performance under load |
| 5 rapid sequential uploads | Rate limit behavior |
| Consistency (3 identical runs) | Same input → same matched URL |
| Edge cases | Empty HAR, static-only, unicode, 4000-char description |

### Browser HAR Capture

A Playwright script automates real browser visits and exports HAR files for testing:

```bash
npx playwright install chromium
npx tsx test-fixtures/capture-real-hars.ts
```

Captures from: Open-Meteo, USGS Earthquakes, PokeAPI, Hacker News, Dog CEO, JSONPlaceholder. Output saved to `test-fixtures/captured/` (gitignored).

See [docs/13-complete-test-suite-overview.md](./docs/13-complete-test-suite-overview.md) for the full test inventory.

---

## Security

- **SSRF protection** on the curl execution proxy: blocks private IPs (`10.x`, `172.16-31.x`, `192.168.x`), localhost, link-local (`169.254.x`), cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`), IPv6-mapped private IPs (`[::ffff:127.0.0.1]`, `[::]`), non-HTTP protocols
- **Rate limiting**: Two-tier throttle (5 req/10s short burst, 20 req/min sustained) via `@nestjs/throttler`
- **Global exception filter**: Consistent error response format `{ statusCode, error, message, timestamp }` — no stack traces leaked to clients
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
| [06-SSRF-AND-SECURITY-HARDENING.md](./docs/06-SSRF-AND-SECURITY-HARDENING.md) | Research: DNS rebinding, IPv6 bypasses, IP encoding tricks, CSP |
| [07-RATE-LIMITING-AND-ABUSE-PREVENTION.md](./docs/07-RATE-LIMITING-AND-ABUSE-PREVENTION.md) | Research: rate limiting algorithms, NestJS throttler, cost protection |
| [08-ERROR-HANDLING-AND-RECOVERY.md](./docs/08-ERROR-HANDLING-AND-RECOVERY.md) | Research: error taxonomy, retry strategies, circuit breaker pattern |
| [09-CACHING-STRATEGIES.md](./docs/09-CACHING-STRATEGIES.md) | Research: exact-match & semantic caching, OpenAI prompt caching, cost savings |
| [10-OBSERVABILITY.md](./docs/10-OBSERVABILITY.md) | Research: structured logging, request tracing, metrics, health checks |
| [11-HAR-SIZE-LIMITS-AND-STREAMING.md](./docs/11-HAR-SIZE-LIMITS-AND-STREAMING.md) | Research: memory limits, streaming JSON parsers, chunked processing |
| [13-complete-test-suite-overview.md](./docs/13-complete-test-suite-overview.md) | Complete test inventory: 334 tests across 15 files |
