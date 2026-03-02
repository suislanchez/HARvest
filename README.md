# HARvest API Reverse Engineer

Reverse engineer any API from your browser. Upload a HAR file, describe what you're looking for in plain English, get a ready-to-use curl command.

## How It Works

1. **Upload** a `.har` file (browser DevTools → Network → Export HAR)
2. **Describe** the API you're looking for (e.g., "the weather forecast endpoint")
3. **Get** a curl command for the matching request, ready to copy and execute
4. **Run it** directly from the browser via the built-in execution proxy

An 8-layer filtering pipeline removes ~85% of noise (static assets, tracking pixels, CORS preflights, redirects), deduplicates repeated requests, and summarizes what's left into a token-efficient format. An LLM semantically matches your description to the right request. The curl command is generated deterministically from the original HAR entry — the LLM never touches curl generation, so there's zero hallucination.

**Works with cloud APIs or 100% locally** — run with OpenAI, Groq (Llama-3.3-70b), or Ollama for zero-cost, fully private analysis. Provider fallback chains ensure resilience when any single provider is down.

## Setup

```bash
git clone <repo-url> && cd harvest-api

# Option A: Cloud API (Groq — fast, cheap)
echo "GROQ_API_KEY=your_key_here" > .env
echo "LLM_PROVIDER=groq" >> .env

# Option B: Fully local (zero cost, zero data leaves your machine)
brew install ollama && ollama serve
ollama pull qwen2.5:7b   # 98.4% accuracy, 4.7GB
echo "LLM_PROVIDER=local" > .env

# Option C: Fallback chain (tries groq first, falls back to local)
echo "LLM_FALLBACK=groq,local" >> .env

# Install and start
npm install
npm run dev             # Opens http://localhost:3000
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_PROVIDER` | No | `groq` | LLM backend: `local`, `groq`, or `openai` |
| `LLM_FALLBACK` | No | — | Comma-separated fallback chain (e.g. `groq,local`) |
| `GROQ_API_KEY` | If groq | — | Groq API key (Llama-3.3-70b) |
| `OPENAI_API_KEY` | If openai | — | OpenAI API key (GPT-4o-mini) |
| `LOCAL_LLM_MODEL` | No | `qwen2.5:3b` | Ollama model name for local mode |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin |

### LLM Provider Comparison

| Provider | Model | Accuracy | Latency | Cost | Privacy |
|----------|-------|----------|---------|------|---------|
| **Local (Ollama)** | qwen2.5:7b | **98.4%** | ~20s | **$0.00** | Data stays local |
| **Local (Ollama)** | phi4-mini | 90.5% | **~3s** | **$0.00** | Data stays local |
| **Groq** | Llama-3.3-70b | 100% | ~0.5s | ~$0.0005/q | Cloud API |
| **OpenAI** | GPT-4o-mini | 100% | ~2s | ~$0.0002/q | Cloud API |

## Features

- **8-layer filtering pipeline** — removes static assets, tracking/analytics, CORS preflights, redirects, non-API MIME types
- **Smart deduplication** — `/users/123` and `/users/456` collapse into `/users/{id} (×2)`
- **GraphQL support** — requests differentiated by `operationName`
- **3 LLM providers** — OpenAI, Groq (Llama), or local Ollama (zero cost)
- **Provider fallback chain** — if one provider is down, automatically tries the next
- **100% offline mode** — run entirely on your machine with no API calls
- **In-browser execution** — run the generated curl via an SSRF-protected proxy
- **Response diff** — compare original HAR response with live execution
- **Multi-language output** — curl, Python, JavaScript, Go, Ruby
- **Secret detection** — auto-extracts Bearer tokens, API keys into env variables
- **HAR inspector** — sortable, filterable table of all requests
- **Collection history** — saved analyses via sidebar (`H` key)

### Fault Tolerance

- **LLM retry with backoff** — automatic retries on timeout, 429, and 5xx errors with exponential backoff across all providers
- **Per-attempt timeouts** — 30s for cloud providers, 60s for local models, enforced via AbortController
- **Token overflow protection** — summaries exceeding ~25k tokens are truncated at the last complete line
- **Frontend cancellation** — cancel in-progress analysis with a single click; 90s analysis timeout, 30s execution timeout
- **CLI signal handling** — SIGINT/SIGTERM cleanly abort in-progress LLM calls with a 60s timeout
- **Health check endpoint** — `GET /api/health` returns uptime, memory, and status
- **Graceful shutdown** — NestJS shutdown hooks for clean process termination
- **Extension resilience** — fetch retry with backoff, connection status indicator (green/yellow/red), storage error handling, live capture size limits (50MB warn, 100MB stop)

## CLI

```bash
# Analyze a HAR file from the command line
npx harvest-api capture.har --description "the weather forecast API"

# Use local model
npx harvest-api capture.har -d "shopping cart" --provider local --model qwen2.5:7b

# JSON output for scripting
npx harvest-api capture.har -d "login endpoint" --json --top 3
```

## Chrome Extension

Install the extension from `extension/` for one-click HAR capture and analysis directly in DevTools.

- Live capture mode with size limits
- Connection status indicator (green = connected, red = backend down)
- Retry on transient errors
- Analysis history stored in `chrome.storage`
- Export to curl, fetch, axios, or Python

See [`extension/README.md`](./extension/README.md) for setup instructions.

## Playwright E2E Testing

The app is tested end-to-end using Playwright — real browser automation that uploads HAR files through the actual UI, runs the full analysis pipeline, and verifies results.

### 49 Browser Tests

```bash
npm run playwright:install    # Install Chromium (first time only)
npm run dev                   # Start both servers

npm run test:e2e              # Run all 49 tests
npm run test:e2e:ui           # Watch tests run in visual browser UI
npx playwright test --headed  # See the real Chrome window
```

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `smoke.spec.ts` | 7 | Page load, header, hero text, stats, footer |
| `upload.spec.ts` | 7 | File upload, validation, error handling, replacement |
| `analysis-mock.spec.ts` | 8 | Full flow with mocked backend, pipeline stepper, code tabs |
| `analysis-live.spec.ts` | 4 | **Real HAR → real OpenAI → verify in browser** |
| `proxy-execute.spec.ts` | 5 | Execute curl, response viewer, headers tab |
| `collection.spec.ts` | 6 | History sidebar, auto-save, clear all |
| `keyboard.spec.ts` | 5 | Shortcut keys: ?, H, I, Escape |
| `har-inspector.spec.ts` | 4 | Table rendering, methods, example prompts |
| `responsive.spec.ts` | 3 | Mobile viewport (375×812) |

### 16 Real-World HAR Captures

Playwright visits real public websites, records all network traffic into HAR files, then those HARs are fed through the analysis pipeline to verify it finds the right API. Captured via two scripts:

```bash
npm run capture:hars          # Original 6 targets
npm run capture:hars:extended # Extended 10 targets
npm run capture:all           # Both
```

#### Original Captures

| HAR File | Source | Entries | Test Query |
|----------|--------|---------|------------|
| `open-meteo-weather.har` | open-meteo.com | 67 | "Find the weather forecast API" |
| `usgs-earthquakes.har` | earthquake.usgs.gov | 26 | "Find the earthquake data API that returns GeoJSON" |
| `pokeapi-pokemon.har` | pokeapi.co | 193 | "Find the Pokemon data API" |
| `hackernews-firebase.har` | news.ycombinator.com | 6 | "Find the API that loads the front page stories" |
| `dog-ceo-random.har` | dog.ceo | 87 | "Find the random dog image API" |
| `jsonplaceholder-todos.har` | jsonplaceholder.typicode.com | 17 | "Find the REST API that fetches todos" |

#### Extended Captures

| HAR File | Source | Entries | Test Query |
|----------|--------|---------|------------|
| `github-trending.har` | github.com/trending | 156 | "Find the API that loads trending repositories" |
| `wikipedia-search.har` | en.wikipedia.org | 37 | "Find the Wikipedia search API" |
| `countries-graphql.har` | countries.trevorblades.com | 5 | "Find the GraphQL API that queries country data" |
| `openlibrary-search.har` | openlibrary.org | 104 | "Find the book search API" |
| `coingecko-prices.har` | coingecko.com | 281 | "Find the API that fetches cryptocurrency prices" |
| `nasa-apod.har` | api.nasa.gov | 9 | "Find the NASA astronomy picture of the day API" |
| `httpbin-methods.har` | httpbin.org | 16 | "Find the POST endpoint that accepts JSON data" |
| `npm-registry.har` | npmjs.com | 19 | "Find the API that fetches npm package info" |
| `catfacts-api.har` | catfact.ninja | 11 | "Find the API that returns cat facts" |
| `restcountries.har` | restcountries.com | 9 | "Find the API that returns country data by name" |

**Total: ~54 MB, 1,043 network entries from real browser traffic.**

### Backend Test Suite

221 unit tests + comprehensive eval & e2e suites across 20+ files in Jest.

```bash
cd backend

npx jest                                           # All unit tests (221 tests, no API key needed)
npx jest har-parser har-to-curl analysis.service   # Core unit tests
npx jest e2e-local-pipeline --testTimeout=300000   # Local LLM E2E (needs Ollama, no API key)
npx jest e2e-pipeline --testTimeout=120000         # Cloud LLM E2E (needs API key)
npx jest eval-local-full --testTimeout=900000 --runInBand  # Full 63-case local benchmark
npx jest eval-local --testTimeout=600000 --runInBand       # Quick 13-case, 6 models
npx jest ablation --testTimeout=600000 --runInBand         # Ablation study (needs Groq key)
```

### Benchmark Results (63 Cases)

| Model | Accuracy | Easy | Medium | Hard | Extreme | Cost |
|-------|----------|------|--------|------|---------|------|
| GPT-4o-mini (cloud) | 100% | 6/6 | 24/24 | 23/23 | 10/10 | ~$0.01 |
| Llama-3.3-70b (Groq) | 100% | 6/6 | 24/24 | 23/23 | 10/10 | ~$0.03 |
| **qwen2.5:7b (local)** | **98.4%** | 6/6 | 24/24 | 22/23 | 10/10 | **$0.00** |
| phi4-mini (local) | 90.5% | 5/6 | 22/24 | 21/23 | 9/10 | **$0.00** |

## Architecture

```
harvest-api/
├── backend/              NestJS 11 API server (port 3001)
│   ├── analysis/         HAR parsing, filtering, dedup, summarization, curl gen
│   ├── llm/              Provider interface + fallback chain
│   ├── openai/           OpenAI LLM provider (with retry)
│   ├── groq/             Groq/Llama LLM provider (with retry)
│   ├── local-llm/        Ollama local LLM provider (with retry)
│   ├── health/           Health check endpoint
│   └── common/utils/     LLM retry utility (timeout + exponential backoff)
├── frontend/             Next.js 16 app (port 3000)
│   ├── components/       Upload, inspector, curl output, response viewer, diffs
│   └── api/proxy/        SSRF-protected curl execution proxy
├── extension/            Chrome DevTools extension
│   ├── panel.js          Main logic (fetch retry, health check, storage safety)
│   ├── panel.html        UI with connection status dot
│   └── panel.css         Theming + status indicators
├── e2e/                  Playwright browser tests (49 tests)
│   └── fixtures/         Mock API handlers, test helpers, synthetic HAR
├── test-fixtures/        HAR fixtures (synthetic + real-world)
│   ├── captured/         16 Playwright-captured real browser HARs
│   ├── capture-real-hars.ts       Original 6-target capture script
│   └── capture-extended-hars.ts   Extended 10-target capture script
├── benchmark/            HARBench ground truth + CSV results
├── paper.md              Research paper (HARvest: LLM-Assisted API Discovery)
└── docs/                 Architecture docs and research notes
```

### Data Flow

```
Upload .har → Parse → 8-layer filter (~85% removed) → Deduplicate → Summarize
    → Token overflow check → LLM (with retry + timeout) → Match index
    → Deterministic curl generation → Display
    → (Optional) Execute via SSRF proxy → Show response + diff
```

### Token Efficiency

200 raw entries → 12 after filtering → 5 unique after dedup → ~100 tokens of LLM input.

| HAR Size | Naive cost | HARvest | Savings |
|----------|-----------|---------|---------|
| 20 entries | ~$0.05 | ~$0.0007 | 98.6% |
| 200 entries | ~$0.32 | ~$0.002 | 99.4% |
| 2000 entries | ~$3.20 | ~$0.012 | 99.6% |

## Security

- **SSRF protection** — blocks private IPs, localhost, link-local, cloud metadata, IPv6-mapped addresses
- **Rate limiting** — 5 req/10s burst + 20 req/min sustained
- **No secrets in client** — API keys stay on the backend
- **Memory-only uploads** — HAR files never written to disk
- **Shell-safe curl** — all values single-quoted, no shell expansion
- **Graceful shutdown** — clean process termination via NestJS shutdown hooks

## Tech Stack

| | Technology |
|-|------------|
| Backend | NestJS 11, TypeScript 5.7 |
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Components | shadcn/ui, Radix UI, TanStack React Table 8 |
| LLM | OpenAI SDK 6 (GPT-4o-mini, Groq/Llama, Ollama local) |
| Testing | Jest 30, Playwright |
| Extension | Chrome DevTools API, Manifest V3 |

## Health Check

```bash
curl http://localhost:3001/api/health
# {"status":"ok","uptime":123,"timestamp":"2026-03-01T...","memory":{"rss":85,"heapUsed":42,"heapTotal":64}}
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl+Enter` | Analyze |
| `H` | Toggle collection history |
| `I` | Toggle tech info |
| `?` | Toggle keyboard shortcuts |

## Docs

Detailed architecture, research, and design docs in [`docs/`](./docs/).
