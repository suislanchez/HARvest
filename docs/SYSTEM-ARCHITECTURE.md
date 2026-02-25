# System Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js 16)                        │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Upload   │  │ HAR Inspector │  │  Curl    │  │   Response     │  │
│  │ Dropzone  │  │    Table      │  │  Output  │  │    Viewer      │  │
│  └────┬─────┘  └──────────────┘  └────┬─────┘  └───────┬────────┘  │
│       │                               │                 │           │
│       │        ┌──────────────────────┘                 │           │
│       │        │   POST /api/proxy (Execute)            │           │
│       │        │   ┌─────────────────┐                  │           │
│       │        └──→│  SSRF Proxy     │──────────────────┘           │
│       │            │  (route.ts)     │                              │
│       │            └─────────────────┘                              │
└───────┼─────────────────────────────────────────────────────────────┘
        │ POST /api/analyze (multipart: .har + description)
        ↓
┌─────────────────────────────────────────────────────────────────────┐
│                       Backend (NestJS 11)                           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   AnalysisService                           │    │
│  │                   (orchestrator)                             │    │
│  │                                                             │    │
│  │  1. Parse ──→ 2. Filter ──→ 3. Summarize ──→ 4. Match      │    │
│  │       │            │              │               │         │    │
│  │       ↓            ↓              ↓               ↓         │    │
│  │  HarParser    HarParser     HarParser       OpenaiService   │    │
│  │  .parseHar    .filter       .generateLlm    .identifyApi    │    │
│  │               ApiRequests   Summary         Request         │    │
│  │                                                             │    │
│  │                          5. Generate Curl                   │    │
│  │                               │                             │    │
│  │                               ↓                             │    │
│  │                         HarToCurlService                    │    │
│  │                         .generateCurl                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐    │
│  │  OpenAI SDK          │  │  Constants                       │    │
│  │  (gpt-4o-mini)       │  │  skip-domains (46)               │    │
│  │  temperature: 0.1    │  │  skip-extensions (32)            │    │
│  │  max_tokens: 500     │  │  skip-headers (28)               │    │
│  │  json_object mode    │  │                                  │    │
│  └──────────────────────┘  └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Breakdown

### Frontend Components

| Component | File | Responsibility |
|-----------|------|----------------|
| Upload Dropzone | `frontend/src/components/` | Accepts `.har` files via drag-drop or click, validates JSON structure client-side |
| HAR Inspector | `frontend/src/components/` | TanStack React Table showing all raw HAR entries with method, URL, status, content type, timing |
| Curl Output | `frontend/src/components/` | Displays generated curl command with syntax highlighting, copy button |
| Response Viewer | `frontend/src/components/` | Shows execution results (status, headers, body) when curl is run via proxy |
| SSRF Proxy | `frontend/src/app/api/proxy/route.ts` | Next.js API route that executes curl commands server-side with security checks |

### Backend Services

| Service | File | Inputs | Outputs |
|---------|------|--------|---------|
| `HarParserService` | `har-parser.service.ts` | Raw buffer | Parsed HAR, filtered entries, summaries, LLM-formatted string |
| `HarToCurlService` | `har-to-curl.service.ts` | Single HAR entry | Shell-safe curl command string |
| `OpenaiService` | `openai.service.ts` | Summary string + description | Match index, confidence, reason, top matches |
| `AnalysisService` | `analysis.service.ts` | File buffer + description | Complete `AnalysisResult` with curl, stats, all requests |

## Data Flow: Detailed Transformations

### Step 1: Parse HAR
```
Input:  Buffer (uploaded file bytes)
Output: Har object with log.entries[]

- UTF-8 decode → JSON.parse
- Validate: must have log.entries as array
- Throws BadRequestException on invalid input
```

### Step 2: Filter API Requests
```
Input:  Entry[] (all HAR entries, e.g., 200 entries)
Output: Entry[] (API-only entries, e.g., 30 entries)

7 sequential filter gates (entry rejected if ANY gate matches):
```

| Gate | What it removes | Example |
|------|----------------|---------|
| 1. Empty/data URI | Missing URLs, `data:` URIs | `data:image/png;base64,...` |
| 2. Aborted | Status 0 (connection failed/cancelled) | Browser cancelled prefetch |
| 3. CORS preflight | `OPTIONS` method | `OPTIONS /api/users` |
| 4. Redirects | Status 301, 302, 303, 307, 308 | `301 → /new-location` |
| 5. Static extensions | 32 extensions via regex | `.js`, `.css`, `.png`, `.woff2`, `.wasm` |
| 6. Tracking domains | 46 domains (exact + subdomain match) | `google-analytics.com`, `hotjar.com` |
| 7. Non-API MIME types | HTML, CSS, JS, images, fonts, media, wasm | `text/html`, `image/png`, `font/woff2` |

### Step 3: Summarize and Deduplicate
```
Input:  Entry[] (filtered, e.g., 30 entries)
Output: String (grouped LLM summary, e.g., ~600 tokens)

Sub-steps:
  a. Group entries by hostname
  b. Detect auth type per group (Authorization header → Bearer/Basic/etc.)
  c. Parameterize paths: /users/123 → /users/{id}, UUIDs → /{id}
  d. Build dedup key per entry:
     - Standard: "METHOD /parameterized/path"
     - GraphQL: "METHOD /path:operationName"
  e. Collapse duplicates, track count (×N)
  f. Format each entry as one-liner (~20 tokens):
     "INDEX. METHOD /path → STATUS mime (size) body: ..."
  g. Build header with total/unique/raw counts
```

**Example transformation**:
```
Before dedup (5 entries):
  GET /api/users/123 → 200 json
  GET /api/users/456 → 200 json
  GET /api/users/789 → 200 json
  POST /graphql (operationName: GetUser) → 200 json
  POST /graphql (operationName: GetFeed) → 200 json

After dedup (3 unique entries):
  0. GET /api/users/{id} → 200 json  (×3)
  1. POST /graphql:GetUser → 200 json
  2. POST /graphql:GetFeed → 200 json
```

### Step 4: LLM Matching
```
Input:  Summary string + user description + entry count
Output: { matchIndex, confidence, reason, topMatches[] }

- System prompt: instructs JSON-only response with topMatches array
- User prompt: description + summary
- Model: gpt-4o-mini (configurable)
- Temperature: 0.1 (near-deterministic)
- max_tokens: 500
- response_format: json_object
- Validates all returned indices are in range [0, entryCount)
```

### Step 5: Curl Generation
```
Input:  Single HAR Entry (the matched one)
Output: Multi-line curl command string

Construction order:
  1. curl
  2. 'url' (single-quoted)
  3. -X METHOD (omitted for GET; omitted for POST when body present)
  4. -H 'Header: value' (filtered through skip-headers set, cookie handled separately)
  5. -b 'cookies' (extracted from cookie header)
  6. --data-raw 'body' (prevents @ interpretation)
  7. --compressed
```

## Filtering Pipeline Detail

The 7-layer filter in `HarParserService.filterApiRequests()` processes entries sequentially. Each layer is a boolean check — if any check matches, the entry is rejected.

```
Raw entries (200)
    │
    ├─ Gate 1: Empty/data URI ──────────── removes ~0-1%
    ├─ Gate 2: Aborted (status 0) ──────── removes ~1-3%
    ├─ Gate 3: CORS preflight (OPTIONS) ── removes ~2-5%
    ├─ Gate 4: Redirects (3xx) ─────────── removes ~1-2%
    ├─ Gate 5: Static extensions ────────── removes ~30-50%
    ├─ Gate 6: Tracking domains ─────────── removes ~5-15%
    └─ Gate 7: Non-API MIME types ───────── removes ~10-20%
    │
Filtered entries (~30)
    │
    ├─ Dedup: parameterize + collapse ──── removes ~20-50% of remaining
    │
Unique entries (~15-20)
```

The skip lists are maintained in `backend/src/common/constants/`:
- **`skip-domains.ts`**: 46 tracking/analytics/CDN domains across 7 categories
- **`skip-extensions.ts`**: Single regex covering 32 static file extensions
- **`skip-headers.ts`**: 28 header names (HTTP/2 pseudo-headers, browser-only, auto-managed by curl)

## LLM Integration Design

### Prompt Structure
```
┌─────────────────────────────────────────┐
│ System prompt (stable, cacheable)       │ ← OpenAI prompt caching: 75% discount
│ - Role: API reverse-engineering expert  │    on repeated prefixes
│ - Rules for index identification        │
│ - Output format specification           │
├─────────────────────────────────────────┤
│ User prompt (variable per request)      │
│ - User's description                    │
│ - Grouped summary string               │
└─────────────────────────────────────────┘
```

### Output Format
```json
{
  "topMatches": [
    { "index": 3, "confidence": 0.95, "reason": "URL path and response match weather forecast data" },
    { "index": 1, "confidence": 0.6, "reason": "Similar weather endpoint but for conditions" }
  ]
}
```

### Token Budget
- **Input**: ~200 tokens system prompt + ~20 tokens/entry × entry count + ~30 tokens user description
- **Output**: Capped at 500 tokens (typically uses ~50-80)
- **Estimate formula**: `summaryString.length / 4 + 200`

## Security Model

### Threat: Sensitive data in HAR files
**Mitigation**: Memory-only processing. HAR files are received as multipart uploads, stored in memory via Multer's `memoryStorage()`, processed, and discarded. Never written to disk, never logged.

### Threat: Shell injection via curl
**Mitigation**: All values in generated curl commands are single-quoted. Single quotes prevent shell expansion of `$`, `!`, `&`, backticks, and newlines. Single quotes within values use the `'\''` concatenation technique.

### Threat: SSRF via execution proxy
**Mitigation**: `isBlockedUrl()` checks before every proxied request:
- Protocol allowlist: only `http:` and `https:`
- Blocks: `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`
- Blocks cloud metadata: `169.254.169.254`, `metadata.google.internal`
- Blocks private IPs: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `169.254.x.x`, `0.x.x.x`
- 30-second timeout on all proxied requests

### Threat: API key exposure
**Mitigation**: OpenAI API key is server-side only, injected via NestJS `ConfigService`. Frontend never receives or transmits the key.

### Threat: Malformed input
**Mitigation**: HAR structure validated at two points — client-side (JSON parse + `log.entries` check) and server-side (`parseHar()` with `BadRequestException`). File size limited by Multer configuration.

## Configuration Reference

| Config | Location | Default | Description |
|--------|----------|---------|-------------|
| `OPENAI_API_KEY` | `.env` | — | Required. OpenAI API key for LLM matching |
| `OPENAI_MODEL` | `.env` | `gpt-4o-mini` | Model used for semantic matching |
| Backend port | `backend/src/main.ts` | `3001` | NestJS server port |
| Frontend port | `frontend/` | `3000` | Next.js dev server port |
| Upload size limit | Multer config | — | Max HAR file size |
| Proxy timeout | `frontend/src/app/api/proxy/route.ts` | `30000ms` | Timeout for proxied curl execution |
| LLM temperature | `openai.service.ts` | `0.1` | Near-deterministic matching |
| LLM max_tokens | `openai.service.ts` | `500` | Output token cap |
| Jest timeout | `eval.spec.ts` | `120000ms` | Per-test timeout for eval suite |
