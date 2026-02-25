# HAR Reverse Engineer

Upload a HAR file, describe an API in plain English, get a ready-to-use curl command.

## How It Works

1. **Upload** a `.har` file (exported from browser DevTools → Network → Export HAR)
2. **Describe** the API you're looking for (e.g., "the weather forecast endpoint")
3. **Get** a curl command for the matching request, ready to copy and execute
4. **Run it** directly from the browser via the built-in execution proxy

The app pre-filters HAR entries, summarizes them in a token-efficient grouped format, and uses an LLM to semantically match your description to the right API request. The curl command is generated deterministically from the original HAR entry — the LLM never touches curl generation, ensuring zero hallucination.

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

## Research & Approach

This project was built on extensive research into HAR file analysis, API reverse engineering patterns, and LLM token efficiency. The full research documents are in [`/docs`](./docs/).

### Research Areas

#### 1. HAR Format Deep Dive ([docs/01-HAR-FORMAT-AND-PARSING.md](./docs/01-HAR-FORMAT-AND-PARSING.md))

The HAR 1.2 specification defines the HTTP Archive format — plain JSON containing every request/response a browser records. Our research mapped out:

- **Critical fields for API identification**: `request.method`, `request.url`, `request.headers`, `request.postData`, `response.status`, `response.content.mimeType`, `response.content.text`
- **Chrome-specific extensions**: Fields like `_resourceType` (xhr/fetch/script/image) and `_initiator` that browsers embed but the spec doesn't require — useful signals when available but not something to depend on
- **Edge cases**: Base64-encoded response bodies, HTTP/2 pseudo-headers (`:authority`, `:method`, `:path`, `:scheme`), CORS preflight requests, WebSocket upgrades, aborted requests (status 0), data URIs, and source maps

This research directly shaped our `parseHar()` and `filterApiRequests()` implementations — knowing exactly which fields matter and which edge cases to handle.

#### 2. API Reverse Engineering Patterns ([docs/02-REVERSE-ENGINEERING-PATTERNS.md](./docs/02-REVERSE-ENGINEERING-PATTERNS.md))

We studied how tools like **mitmproxy2swagger** and **reverse-api-engineer** approach the problem of identifying API requests in HTTP traffic. Key insights:

- **Signal ranking**: URL path segments are the strongest indicator, followed by query parameters, request body content, response body structure, hostname/subdomain, custom headers, and finally content type
- **Scoring algorithm**: We developed a weighted scoring system — `+3` for JSON responses, `+2` for "api." hostnames or "/api/" paths, `+2` for Authorization headers, `-∞` for static extensions and tracking domains
- **Protocol-specific patterns**: REST APIs use path-as-resource with standard HTTP methods; GraphQL uses a single `/graphql` endpoint where `operationName` in the POST body is the critical differentiator; gRPC-Web uses `application/grpc-web*` content types with `Package.Service/Method` paths
- **The "index return" technique**: Instead of asking the LLM to generate a curl command (prone to hallucination), we present numbered request summaries and ask for just the index. The LLM does semantic matching; deterministic code does curl generation. This was the single most important architectural decision.

#### 3. Curl Generation ([docs/03-CURL-GENERATION.md](./docs/03-CURL-GENERATION.md))

Rather than using an existing library (the popular `har-to-curl` npm package is archived and has known issues), we built a custom generator informed by research into:

- **Shell safety**: Single-quoting everything to prevent shell expansion of `$`, `!`, `&` in URLs and JSON bodies. The "O'Brien problem" — handling single quotes inside single-quoted strings using the `'\''` concatenation technique
- **`--data-raw` vs `-d`**: Using `--data-raw` instead of `-d` to prevent curl from interpreting `@` as a file reference in POST bodies
- **Header classification**: We categorized every common HTTP header as "always skip" (browser-internal like `Sec-Fetch-*`, `Sec-CH-UA-*`, auto-managed like `Host`, `Connection`, `Content-Length`), "always include" (functionally significant like `Authorization`, `Content-Type`, `Accept`, custom `X-*` headers), or "consider redacting" (tokens, cookies)
- **Method inference**: Omitting `-X GET` (curl default) and `-X POST` when `--data-raw` is present (curl infers POST), keeping the output clean

#### 4. Token Efficiency — The Key Differentiator ([docs/04-TOKEN-EFFICIENCY.md](./docs/04-TOKEN-EFFICIENCY.md))

This was the deepest research area. A naive approach of sending full HAR data to an LLM is catastrophically expensive:

| HAR Size | Naive (full entries) | Our approach | Savings |
|----------|---------------------|--------------|---------|
| 20 entries | ~$0.05 | ~$0.0007 | **98.6%** |
| 200 entries | ~$0.32 | ~$0.002 | **99.4%** |
| 2000 entries | ~$3.20 | ~$0.012 | **99.6%** |

**Key finding**: Response bodies account for **80-95% of all tokens** in a HAR file. Stripping them (since they're not needed for identification) is the single largest optimization.

We researched and implemented a multi-layer reduction pipeline:

1. **Deterministic pre-filtering** (free, ~85% reduction): Remove static assets by extension (`.js`, `.css`, `.png`, etc.), tracking/analytics domains (~50 known domains), non-API MIME types (`text/html`, `text/css`, `image/*`), CORS preflight (`OPTIONS`), failed requests (status 0), and redirects
2. **Compact summarization** (further ~95% reduction): Instead of sending full request objects, we generate one-liner summaries per entry (~20 tokens each vs 250-600 for stripped entries or 1,500-15,000 for full entries)
3. **Grouped format with shared context**: Entries grouped by hostname with auth type extracted once per group, eliminating repetition
4. **Path parameterization**: `/users/123/posts/456` becomes `/users/{id}/posts/{id}`, reducing unique URL noise
5. **Short MIME types**: `json` instead of `application/json`, `xml` instead of `application/xml`
6. **Response previews**: First 150 chars of response body included only when helpful for semantic matching (e.g., confirming a jokes API actually returns jokes)

We also researched OpenAI-specific optimizations:
- **Structured outputs** (`response_format: json_object`): Forces valid JSON responses, eliminates parsing failures
- **Prompt caching** (75% discount on repeated prefixes): System prompt placed first (stable/cacheable), variable HAR data placed last
- **Low temperature** (0.1): Deterministic matching over creative variation
- **`max_tokens: 500`**: Caps output cost since we only need a small JSON response

The research also explored a **two-pass pipeline** (nano model for initial screening, then mini for confirmation) that would be appropriate for very large HAR files (500+ entries), though our current implementation uses a single pass since pre-filtering typically reduces to under 50 entries.

#### 5. Architecture & Implementation ([docs/05-ARCHITECTURE-AND-IMPLEMENTATION.md](./docs/05-ARCHITECTURE-AND-IMPLEMENTATION.md))

The architecture research covered existing tools in this space and established our design principles:

- **Separation of concerns**: The LLM is a semantic matcher, not a code generator. It identifies *which* request matches; deterministic code handles everything else (parsing, filtering, summarizing, curl generation)
- **Conservative filtering**: The pre-filter pipeline only removes what we're certain about — it's better to include a few extra entries (slightly higher token cost) than to accidentally filter out the target API
- **Memory-only file handling**: HAR files (which contain auth tokens, cookies, and session data) are never written to disk — processed entirely in memory via Multer's `memoryStorage()`
- **SSRF protection on execution proxy**: The curl execution proxy blocks private IPs (`10.x`, `172.16-31.x`, `192.168.x`), localhost, link-local (`169.254.x`), and cloud metadata endpoints (`169.254.169.254`)

---

## Architecture

```
├── backend/          NestJS API server (port 3001)
│   ├── analysis/     HAR parsing, pre-filtering, summarization, curl generation
│   └── openai/       LLM integration for semantic request matching
├── frontend/         Next.js app (port 3000)
│   ├── components/   File upload, HAR inspector, curl output, response viewer
│   └── api/proxy/    SSRF-protected curl execution proxy
├── docs/             Research documents (5 detailed write-ups)
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
  Parse HAR → Pre-filter (remove ~85% noise)
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
=== HAR Analysis: 5 API requests from 200 total ===

[api.weather.com] (2 requests, Auth: Bearer ***)
  0. GET /v3/wx/forecast?geocode=37.77,-122.42 → 200 json (2.0KB)
  1. GET /v3/wx/conditions?geocode=37.77,-122.42 → 200 json (800B)

[api.example.com] (3 requests, Auth: Bearer ***)
  2. POST /graphql → 200 json body: {"operationName":"GetUser"...
  3. GET /api/v2/users/{id} → 200 json (4.5KB)
```

200 total HAR entries → 5 API candidates → ~100 tokens of LLM input. The response is ~50 tokens of JSON with index, confidence, and reason.

### Security

- **SSRF protection** on the curl execution proxy: blocks private IPs, localhost, cloud metadata endpoints, non-HTTP protocols
- **File validation**: HAR structure validated both client-side and server-side
- **No secrets in client**: OpenAI API key stays on the backend
- **Memory-only file handling**: uploaded files are never written to disk
- **Shell-safe curl generation**: all values single-quoted, no shell expansion possible

## Tech Stack

- **Backend**: NestJS, OpenAI SDK, TypeScript
- **Frontend**: Next.js 16, React 19, Tailwind CSS, shadcn/ui, TanStack React Table
- **Infrastructure**: Docker, npm workspaces

## Tech Decisions

| Decision | Rationale |
|----------|-----------|
| LLM returns index, not curl | Zero hallucination — deterministic curl generation from original HAR entry |
| Pre-filter before LLM | ~85% entry reduction for free, no token cost, no API call |
| Grouped summary format | Hostname grouping + shared auth reduces token repetition |
| `gpt-4o-mini` default | Best cost/accuracy ratio for structured matching tasks |
| `--data-raw` over `-d` | Prevents `@` file interpretation in POST bodies |
| Single-quote shell escaping | Prevents `$`, `!`, `&` expansion — safest approach |
| Memory-only file storage | HAR files contain sensitive auth data — never touch disk |
| Custom curl generator | Archived `har-to-curl` package has issues; 50 lines of focused code is better |
| Conservative pre-filter | Better to include noise than miss the target API |
