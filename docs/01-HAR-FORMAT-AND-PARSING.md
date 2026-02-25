# 1. HAR File Format & Parsing - Complete Reference

## HAR Schema Overview

HAR (HTTP Archive) is plain JSON following the 1.2 spec. No special parser needed - just `JSON.parse()`.

```
har.log
  ├── version: "1.2"
  ├── creator: { name, version }
  ├── browser: { name, version }
  ├── pages[]: { id, title, startedDateTime, pageTimings }
  └── entries[]: ← THIS IS WHERE ALL THE ACTION IS
        ├── request: { method, url, headers[], queryString[], postData?, cookies[] }
        ├── response: { status, statusText, headers[], content: { mimeType, text, size, encoding } }
        ├── timings: { send, wait, receive, blocked?, dns?, connect?, ssl? }
        ├── cache: {}
        ├── startedDateTime
        ├── time (total ms)
        └── Chrome extras: _resourceType, _initiator, _priority
```

## Critical Fields for API Identification

### request (always present)
| Field | Type | Always Present? | Use Case |
|-------|------|----------------|----------|
| `method` | string | Yes | GET/POST/PUT/PATCH/DELETE |
| `url` | string | Yes | Full absolute URL with query string |
| `headers[]` | `{name,value}[]` | Yes (may be empty) | Auth tokens, Content-Type, custom X-* |
| `queryString[]` | `{name,value}[]` | Yes (may be empty) | Pre-parsed query params |
| `postData.text` | string | Only on POST/PUT/PATCH | Raw request body (JSON string, form data) |
| `postData.mimeType` | string | Only with postData | `application/json`, `application/x-www-form-urlencoded` |
| `postData.params[]` | `{name,value}[]` | Only for form posts | Mutually exclusive with `.text` |
| `cookies[]` | `{name,value}[]` | Yes (may be empty) | Session/auth cookies |

### response (always present)
| Field | Type | Always Present? | Use Case |
|-------|------|----------------|----------|
| `status` | number | Yes | 200, 404, etc. Status 0 = failed/aborted |
| `content.mimeType` | string | Yes | **PRIMARY FILTER** - may include charset (split on `;`) |
| `content.text` | string | **Optional** | May be absent if not captured |
| `content.size` | number | Yes | Decompressed body size |
| `content.encoding` | string | Optional | `"base64"` if body is base64-encoded |

### Chrome non-standard fields (prefixed with `_`)
| Field | Value | Why it matters |
|-------|-------|---------------|
| `_resourceType` | `"xhr"`, `"fetch"`, `"script"`, `"document"`, etc. | **GOLD** - directly tells you if it's an API call |
| `_initiator` | `{type, url, lineNumber}` | What JS file triggered this request |
| `_priority` | `"High"`, `"Low"`, etc. | API calls tend to be High priority |

## MIME Type Classification

### INCLUDE (API-like responses)
```typescript
const API_MIME_TYPES = [
  // JSON
  'application/json',
  'application/hal+json',
  'application/vnd.api+json',
  'application/ld+json',
  'application/problem+json',

  // GraphQL
  'application/graphql',
  'application/graphql+json',
  'application/graphql-response+json',

  // XML
  'application/xml',
  'text/xml',
  'application/soap+xml',

  // Protobuf / gRPC
  'application/protobuf',
  'application/x-protobuf',
  'application/grpc-web',
  'application/grpc-web+proto',

  // Other data formats
  'application/x-ndjson',        // streaming JSON
  'text/event-stream',           // SSE
  'application/msgpack',
  'text/plain',                  // ambiguous - combine with URL heuristic
];
```

### EXCLUDE (static assets)
```typescript
const STATIC_MIME_TYPES = [
  'text/html', 'application/xhtml+xml',         // pages
  'text/css',                                     // styles
  'application/javascript', 'text/javascript',    // scripts
  'image/*',                                      // all images
  'font/*', 'application/font-*',                 // all fonts
  'audio/*', 'video/*',                           // media
  'application/wasm',                             // WebAssembly
  'application/manifest+json',                    // web manifests
];
```

### Parsing MIME types correctly
```typescript
function getBaseMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
  // "application/json; charset=utf-8" → "application/json"
}
```

## URL Patterns That Indicate APIs

### Path patterns (regex)
```typescript
const API_PATH_PATTERNS = [
  /\/api\//i,              // /api/v1/weather
  /\/v\d+\//i,             // /v2/jokes
  /\/graphql/i,            // /graphql
  /\/rest\//i,             // /rest/services
  /\/data\//i,             // /data/weather
  /\/_next\/data\//i,      // Next.js data fetching
];
```

### File extensions to EXCLUDE
```typescript
const STATIC_EXTENSIONS = /\.(js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp[34]|wasm)(\?|$)/i;
```

## Domains to Auto-Filter Out

### Analytics & Tracking
```
google-analytics.com, googletagmanager.com, doubleclick.net,
googlesyndication.com, googleadservices.com,
connect.facebook.net, pixel.facebook.com,
clarity.ms, bat.bing.com,
hotjar.com, static.hotjar.com,
cdn.segment.com, api.segment.io,
api.mixpanel.com, api.amplitude.com,
heapanalytics.com, sentry.io,
browser-intake-datadoghq.com, bam.nr-data.net,
fullstory.com, js.hs-analytics.net,
cdn.cookielaw.org, snap.licdn.com,
analytics.tiktok.com, stats.wp.com,
mc.yandex.ru
```

### CDN (static assets only)
```
cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com,
fonts.googleapis.com, fonts.gstatic.com,
use.fontawesome.com, stackpath.bootstrapcdn.com
```

**WARNING**: Don't blindly filter `cloudflare.com` or `fastly.net` - real APIs sit behind these CDNs.

## Edge Cases to Handle

| Edge Case | How to Detect | How to Handle |
|-----------|--------------|---------------|
| Base64 response bodies | `content.encoding === 'base64'` | `Buffer.from(text, 'base64').toString('utf-8')` |
| HTTP/2 pseudo-headers | Headers starting with `:` | Skip `:authority`, `:method`, `:path`, `:scheme` |
| CORS preflight | `method === 'OPTIONS'` + has `Access-Control-Request-Method` header | Filter out entirely |
| Redirects (301/302) | `status` is 301/302/303/307/308 | Skip - the follow-up request is a separate entry |
| WebSocket upgrade | `status === 101` or URL starts with `ws://`/`wss://` | Skip (HAR doesn't capture WS messages well) |
| Failed/aborted | `status === 0` | Filter out |
| Data URIs | URL starts with `data:` | Skip |
| Source maps | URL ends in `.map` | Skip |

## TypeScript Setup

```bash
npm install --save-dev @types/har-format
```

```typescript
import type { Har, Entry, Request, Response, Content, Header } from 'har-format';

// Extend for Chrome fields
interface ChromeEntry extends Entry {
  _resourceType?: 'xhr' | 'fetch' | 'script' | 'stylesheet' | 'image' | 'font' | 'document' | 'websocket' | 'other';
  _initiator?: { type: string; url?: string; lineNumber?: number; };
  _priority?: string;
}
```

## Recommended Libraries

| Package | Purpose | Notes |
|---------|---------|-------|
| `@types/har-format` | TypeScript types | The only "parser" you need |
| `har-to-curl` | HAR entry → curl command | Archived but functional; consider writing your own |
| `stream-json` | Streaming parse for large files | Only needed for 10MB+ HAR files |
