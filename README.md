# HAR Reverse Engineer

Upload a HAR file, describe an API in plain English, get a ready-to-use curl command.

## How It Works

1. **Upload** a `.har` file (browser DevTools → Network → Export HAR)
2. **Describe** the API you're looking for (e.g., "the weather forecast endpoint")
3. **Get** a curl command for the matching request, ready to copy and execute
4. **Run it** directly from the browser via the built-in execution proxy

An 8-layer filtering pipeline removes ~85% of noise (static assets, tracking pixels, CORS preflights, redirects), deduplicates repeated requests, and summarizes what's left into a token-efficient format. An LLM semantically matches your description to the right request. The curl command is generated deterministically from the original HAR entry — the LLM never touches curl generation, so there's zero hallucination.

## Setup

```bash
git clone <repo-url> && cd har-reverse-engineer

# Configure your API key
cp .env.example .env    # Add your OPENAI_API_KEY

# Install and start
npm install
npm run dev             # Opens http://localhost:3000
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model for request matching |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin |

## Features

- **8-layer filtering pipeline** — removes static assets, tracking/analytics, CORS preflights, redirects, non-API MIME types
- **Smart deduplication** — `/users/123` and `/users/456` collapse into `/users/{id} (×2)`
- **GraphQL support** — requests differentiated by `operationName`
- **In-browser execution** — run the generated curl via an SSRF-protected proxy
- **Response diff** — compare original HAR response with live execution
- **Multi-language output** — curl, Python, JavaScript, Go, Ruby
- **Secret detection** — auto-extracts Bearer tokens, API keys into env variables
- **HAR inspector** — sortable, filterable table of all requests
- **Collection history** — saved analyses via sidebar (`H` key)

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

~334 tests across 15 files in Jest.

```bash
cd backend

npx jest                                           # All tests
npx jest har-parser har-to-curl analysis.service   # Unit tests (no API key)
npx jest e2e-pipeline --testTimeout=120000         # Pipeline E2E (needs key)
npx jest e2e-stress --testTimeout=300000           # Stress tests
```

## Architecture

```
har-reverse-engineer/
├── backend/              NestJS 11 API server (port 3001)
│   ├── analysis/         HAR parsing, filtering, dedup, summarization, curl gen
│   └── openai/           LLM integration for semantic matching
├── frontend/             Next.js 16 app (port 3000)
│   ├── components/       Upload, inspector, curl output, response viewer, diffs
│   └── api/proxy/        SSRF-protected curl execution proxy
├── e2e/                  Playwright browser tests (49 tests)
│   └── fixtures/         Mock API handlers, test helpers, synthetic HAR
├── test-fixtures/        HAR fixtures (synthetic + real-world)
│   ├── captured/         16 Playwright-captured real browser HARs
│   ├── capture-real-hars.ts       Original 6-target capture script
│   └── capture-extended-hars.ts   Extended 10-target capture script
└── docs/                 Architecture docs and research notes
```

### Data Flow

```
Upload .har → Parse → 8-layer filter (~85% removed) → Deduplicate → Summarize
    → LLM returns match index → Deterministic curl generation → Display
    → (Optional) Execute via SSRF proxy → Show response + diff
```

### Token Efficiency

200 raw entries → 12 after filtering → 5 unique after dedup → ~100 tokens of LLM input.

| HAR Size | Naive cost | This approach | Savings |
|----------|-----------|---------------|---------|
| 20 entries | ~$0.05 | ~$0.0007 | 98.6% |
| 200 entries | ~$0.32 | ~$0.002 | 99.4% |
| 2000 entries | ~$3.20 | ~$0.012 | 99.6% |

## Security

- **SSRF protection** — blocks private IPs, localhost, link-local, cloud metadata, IPv6-mapped addresses
- **Rate limiting** — 5 req/10s burst + 20 req/min sustained
- **No secrets in client** — OpenAI key stays on the backend
- **Memory-only uploads** — HAR files never written to disk
- **Shell-safe curl** — all values single-quoted, no shell expansion

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

Detailed architecture, research, and design docs in [`docs/`](./docs/).
