# Token Optimization Guide

A practical guide to how this project minimizes LLM token usage — achieving 98-99% cost reduction compared to naive approaches.

## The Optimization Funnel

```
Raw HAR file (e.g., 2000 entries)
│
│  Layer 1: Pre-filtering (7 gates)
│  Removes static assets, tracking, preflights, redirects
│  ~85% reduction → ~300 entries
│
│  Layer 2: Deduplication
│  Parameterize paths, collapse repeated endpoints
│  ~30-50% of remaining → ~150-200 unique entries
│
│  Layer 3: Compact summarization
│  One-liner per entry instead of full request objects
│  ~95% token reduction per entry (20 tokens vs 250-600)
│
│  Layer 4: Grouped format
│  Hostname grouping with shared auth context
│  ~10-20% additional savings from deduplication of auth info
│
│  Layer 5: Response previews (selective)
│  Only 150 chars of response body, only when present
│  vs full response bodies that are 80-95% of HAR tokens
│
LLM input: ~3,000-4,000 tokens for 200 unique entries
```

### Before vs After: Real Numbers

| HAR Size | Raw tokens (full entries) | After optimization | Reduction |
|----------|--------------------------|-------------------|-----------|
| 20 entries | ~30,000-100,000 | ~400-600 | 98.6% |
| 200 entries | ~200,000-500,000 | ~1,500-2,500 | 99.4% |
| 2000 entries | ~2,000,000-5,000,000 | ~8,000-15,000 | 99.6% |

## Layer 1: Pre-filtering

**File**: `backend/src/modules/analysis/har-parser.service.ts` — `filterApiRequests()` (lines 42-97)
**Cost**: Zero (pure code, no API calls)
**Reduction**: ~85% of entries removed

Seven sequential gates, each rejecting entries that are definitively not API requests:

### Gate details

| Gate | Code | What it catches | Typical % removed |
|------|------|----------------|-------------------|
| Empty/data URI | `!url \|\| url.startsWith('data:')` | Embedded images, missing URLs | 0-1% |
| Aborted | `response.status === 0` | Cancelled requests, failed prefetches | 1-3% |
| CORS preflight | `method === 'OPTIONS'` | Browser CORS checks | 2-5% |
| Redirects | Status in `[301,302,303,307,308]` | HTTP redirects | 1-2% |
| Static extensions | `SKIP_EXTENSIONS.test(pathname)` | 32 extensions: `.js`, `.css`, `.png`, `.woff2`, etc. | 30-50% |
| Tracking domains | `SKIP_DOMAINS` (46 domains) | Google Analytics, Facebook Pixel, Hotjar, Segment, Sentry, etc. | 5-15% |
| Non-API MIME types | Hardcoded list | `text/html`, `text/css`, `image/*`, `font/*`, `audio/*`, `video/*`, `application/javascript`, `application/wasm` | 10-20% |

### Skip lists

**Extensions** (`backend/src/common/constants/skip-extensions.ts`):
```
js, mjs, cjs, css, map, png, jpeg, jpg, gif, webp, avif, svg, ico,
woff, woff2, ttf, otf, eot, mp3, mp4, webm, ogg, pdf, zip, gz, br, wasm
```

**Domains** (`backend/src/common/constants/skip-domains.ts`): 46 domains across 7 categories:
- Google Analytics & Ads (8 domains)
- Facebook/Meta (3)
- Microsoft (3)
- Hotjar (4)
- Other analytics: Segment, Mixpanel, Amplitude, Heap, Sentry, Datadog, New Relic, FullStory (13)
- Marketing/CRM: HubSpot, LinkedIn, TikTok, WordPress, Yandex, CookieLaw (10)
- CDN-only: jsDelivr, cdnjs, unpkg, Google Fonts, Font Awesome, Bootstrap CDN (8)

Domain matching uses exact match OR subdomain suffix (`hostname.endsWith('.' + domain)`), so `cdn.segment.com` is caught by the `cdn.segment.com` entry.

## Layer 2: Deduplication

**File**: `backend/src/modules/analysis/har-parser.service.ts` — `generateLlmSummary()` (lines 221-255)
**Cost**: Zero
**Reduction**: 20-50% of filtered entries

### How it works

1. **Parameterize paths** (lines 161-170):
   - Numeric segments: `/users/123/posts/456` → `/users/{id}/posts/{id}`
   - UUIDs: `/items/550e8400-e29b-41d4-a716-446655440000` → `/items/{id}`

2. **Build dedup key**:
   - Standard requests: `"METHOD /parameterized/path"` (e.g., `"GET /api/users/{id}"`)
   - GraphQL requests: `"METHOD /path:operationName"` (e.g., `"POST /graphql:GetUser"`)

3. **Collapse duplicates**: First occurrence kept as representative. Duplicate count tracked and shown as `(×N)`.

### GraphQL operationName discrimination

Without operationName awareness, all `POST /graphql` requests would collapse into one entry — losing critical semantic information. The dedup logic parses the request body as JSON and extracts `operationName` to create distinct keys:

```
POST /graphql body: {"operationName":"GetUser"}     → key: "POST /graphql:GetUser"
POST /graphql body: {"operationName":"GetFeed"}     → key: "POST /graphql:GetFeed"
POST /graphql body: {"operationName":"GetUser"}     → key: "POST /graphql:GetUser" (duplicate, ×2)
```

Result: 2 unique entries instead of 1 (without discrimination) or 3 (without dedup).

### Example impact

A SPA polling an endpoint every 5 seconds for 2 minutes:
- Without dedup: 24 nearly identical entries → ~480 tokens
- With dedup: 1 entry with `(×24)` → ~20 tokens

## Layer 3: Compact Summarization

**File**: `backend/src/modules/analysis/har-parser.service.ts` — `generateLlmSummary()` (lines 258-345)
**Reduction**: ~95% per entry

### Token cost comparison per entry

| Format | Tokens | Example |
|--------|--------|---------|
| Full HAR entry (with response body) | 1,500-15,000 | Complete JSON object with all headers, cookies, body |
| Stripped entry (headers + URL, no body) | 250-600 | JSON object without response body |
| **Our one-liner summary** | **~20** | `0. GET /api/users/{id} → 200 json (4.5KB) (×3)` |

### One-liner format

```
INDEX. METHOD /path?query → STATUS mime (size) (×N) body: ... | preview: ...
```

Each component:
- **INDEX**: Global index for LLM to reference (the "index return" technique)
- **METHOD**: HTTP method
- **/path?query**: URL path (hostname shown in group header). Truncated to 120 chars
- **STATUS**: HTTP status code
- **mime**: Shortened MIME type (`json` not `application/json`)
- **(size)**: Response size formatted as B/KB/MB
- **(×N)**: Dedup count if >1
- **body:**: First 100 chars of POST body (for API identification, especially GraphQL)
- **preview:**: First 150 chars of response body

### What's intentionally omitted

- Full headers (only auth type preserved in group header)
- Full request/response bodies
- Timing information
- Cookie details
- HTTP version
- Connection info

## Layer 4: Grouped Format

**File**: `backend/src/modules/analysis/har-parser.service.ts` — `generateLlmSummary()` (lines 258-260)

Entries are grouped by hostname with shared context extracted once per group:

```
[api.example.com] (5 requests, Auth: Bearer ***)
  0. GET /api/users/{id} → 200 json (4.5KB)  (×3)
  1. POST /api/users → 201 json (200B) body: {"name":"...
  2. DELETE /api/users/{id} → 204 (0B)

[cdn.example.com] (2 requests, No auth)
  3. GET /assets/config.json → 200 json (1.2KB)
  4. GET /assets/i18n/en.json → 200 json (800B)
```

**Savings**: Auth info stated once per group instead of per-entry. Hostname stated once instead of in every URL.

## Layer 5: Response Previews

Instead of full response bodies (which account for 80-95% of all tokens in a HAR file), we include only the first 150 characters of the response body — and only when the response body is present.

This gives the LLM enough context to differentiate between endpoints with similar URLs (e.g., confirming that `/api/jokes` actually returns jokes) without the token cost of full bodies.

## OpenAI-Specific Optimizations

### Prompt caching
System prompt is placed first (stable across requests) so OpenAI's automatic prompt caching applies — 75% discount on the ~200-token system prompt for repeated requests.

### Structured output
`response_format: { type: 'json_object' }` forces valid JSON responses, eliminating the need for markdown stripping or retry-on-parse-failure logic.

### Low temperature
`temperature: 0.1` — near-deterministic. Matching is a classification task, not a creative task.

### Output token cap
`max_tokens: 500` — the response is typically ~50-80 tokens of JSON. The cap prevents runaway output on malformed prompts.

## Cost Analysis

Using `gpt-4o-mini` pricing ($0.15/M input tokens, $0.60/M output tokens):

| HAR entries | After filtering | After dedup | Input tokens | Output tokens | Total cost |
|-------------|----------------|-------------|-------------|---------------|------------|
| 20 | ~5 | ~4 | ~300 | ~60 | **$0.0001** |
| 100 | ~20 | ~15 | ~600 | ~70 | **$0.0001** |
| 200 | ~40 | ~25 | ~800 | ~80 | **$0.0002** |
| 500 | ~80 | ~50 | ~1,300 | ~80 | **$0.0002** |
| 2000 | ~300 | ~150 | ~3,500 | ~100 | **$0.0006** |

**Key insight**: Even large HAR files (2000 entries) cost under $0.001 per query. The optimization funnel makes per-query cost effectively flat.

## When to Consider Multi-Stage Pipelines

A two-pass pipeline (cheap model screens candidates, better model confirms) makes sense when:

1. **Filtered entry count exceeds ~500**: At this point, the single-pass input crosses ~10,000 tokens
2. **Response preview tokens dominate**: If most entries have large response previews
3. **Cost sensitivity is extreme**: If even $0.001/query matters at volume

### Why we don't use multi-stage (yet)

- Pre-filtering reduces most HAR files to under 50 entries
- Dedup further reduces to under 30 unique entries
- At 30 entries × ~20 tokens each, input is ~600 tokens — well within single-pass efficiency
- Two-pass adds latency (two API roundtrips) and complexity (intermediate result handling)
- The crossover point where two-pass saves money is ~500 filtered entries, which is rare in practice

### If/when to add it

If the project starts handling long-running SPA recordings (10+ minutes of browsing), mobile app traffic (background sync), or HAR files from automated test suites, the filtered count could regularly exceed 500. At that point, a screening pass with a nano model would be worth the added complexity.

## Relationship to Research Docs

This guide consolidates and applies findings from [docs/04-TOKEN-EFFICIENCY.md](./04-TOKEN-EFFICIENCY.md), which contains the original research and analysis. That doc covers the theoretical framework; this one maps it to the actual implementation with code references and real numbers.
