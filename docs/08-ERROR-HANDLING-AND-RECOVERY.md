# Error Handling & Recovery

Research into structured error handling, retry strategies, and circuit breaker patterns for a NestJS API backed by OpenAI.

---

## Error Taxonomy

### Operational vs Programmer Errors

This distinction (from Joyent's Node.js error handling guide) is fundamental:

**Operational errors** — expected runtime conditions to handle gracefully:
- Network timeout to OpenAI
- Invalid HAR file uploaded (malformed JSON)
- Rate limit hit (429 from OpenAI)
- File too large
- OpenAI service unavailable (503)

**Response**: Log at appropriate level, return structured error to client, potentially retry if transient, continue operating.

**Programmer errors** — bugs that should never happen in production:
- `TypeError: Cannot read property 'x' of undefined`
- Missing `await` on async calls
- Logic errors, wrong argument types

**Response**: Log full stack trace, crash fast, let process manager restart. Do NOT attempt to continue — state may be corrupted.

---

## Structured Error Responses (RFC 7807 / RFC 9457)

### Problem Details Format

Standard format for machine-readable error responses:

```json
{
  "type": "https://api.example.com/errors/har-parse-error",
  "title": "Invalid HAR File",
  "status": 400,
  "detail": "The uploaded file is not valid JSON. Ensure you export a HAR file from your browser's network tab.",
  "instance": "/api/analyze",
  "correlationId": "req-abc-123",
  "timestamp": "2026-02-24T12:00:00Z"
}
```

**Content-Type**: `application/problem+json`

### Key Fields

| Field | Purpose |
|-------|---------|
| `type` | URI identifying the error class (machine-readable, links to docs) |
| `title` | Short human-readable summary (stable across instances) |
| `status` | HTTP status code |
| `detail` | Human-readable explanation specific to this occurrence |
| `instance` | Request path or unique error occurrence identifier |

### Principle: Never Expose Internals

Never send to API consumers:
- Stack traces
- SQL queries
- File paths
- Raw OpenAI error messages
- Internal service names

---

## Error Taxonomy for This Project

### Client Errors (4xx)

| Code | Error | When | User message |
|------|-------|------|-------------|
| `HAR_PARSE_ERROR` | 400 | Invalid JSON in uploaded file | "The uploaded file is not valid JSON. Export a HAR file from your browser's Network tab." |
| `HAR_STRUCTURE_ERROR` | 400 | Valid JSON but missing `log.entries` | "This doesn't appear to be a HAR file. It should contain a 'log' object with 'entries'." |
| `NO_API_REQUESTS` | 422 | All entries filtered out | "No API requests found in this HAR file. It may contain only static assets." |
| `FILE_TOO_LARGE` | 413 | Exceeds upload limit | "File is too large. Maximum size is 50MB." |
| `RATE_LIMITED` | 429 | Too many requests | "Too many requests. Please wait before trying again." |
| `SSRF_BLOCKED` | 403 | Proxy blocked URL | "Cannot execute requests to private/internal addresses." |

### Server Errors (5xx)

| Code | Error | When | User message |
|------|-------|------|-------------|
| `LLM_UNAVAILABLE` | 503 | OpenAI API down or circuit open | "AI analysis service is temporarily unavailable. Please try again in a moment." |
| `LLM_TIMEOUT` | 504 | OpenAI request timed out | "Analysis took too long. Please try again." |
| `LLM_RATE_LIMITED` | 503 | OpenAI 429 after retries exhausted | "Service is experiencing high demand. Please try again shortly." |
| `INTERNAL_ERROR` | 500 | Unexpected error | "An unexpected error occurred. Please try again." |

---

## NestJS Exception Filters

### Built-in HttpException Hierarchy

```
HttpException (base)
├── BadRequestException          (400)
├── UnauthorizedException        (401)
├── ForbiddenException           (403)
├── NotFoundException            (404)
├── PayloadTooLargeException     (413)
├── UnprocessableEntityException (422)
├── TooManyRequestsException     (429)
├── InternalServerErrorException (500)
├── ServiceUnavailableException  (503)
└── GatewayTimeoutException      (504)
```

### Custom Domain Exceptions

```typescript
export class HarParseException extends BadRequestException {
  constructor(detail: string) {
    super({ code: 'HAR_PARSE_ERROR', message: 'Invalid HAR file', detail });
  }
}

export class LlmUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({ code: 'LLM_UNAVAILABLE', message: 'AI analysis service temporarily unavailable' });
  }
}
```

### Global Exception Filter

```typescript
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const isOperational = exception instanceof HttpException;

    if (!isOperational) {
      logger.error('Unhandled exception', exception);  // Full stack trace
    }

    response.status(status).json({
      type: `https://api.example.com/errors/${errorCode}`,
      title: humanReadableTitle,
      status,
      detail: isOperational ? exception.message : 'An unexpected error occurred',
      instance: request.url,
      timestamp: new Date().toISOString(),
      correlationId: request.headers['x-correlation-id'],
    });
  }
}
```

Register globally: `app.useGlobalFilters(new GlobalExceptionFilter())` in `main.ts`.

---

## Retry Strategies for OpenAI API

### Which Errors Are Retryable

| Status | Meaning | Retryable? | Strategy |
|--------|---------|------------|----------|
| 429 | Rate limited | Yes | Respect `Retry-After` header |
| 500 | Internal server error | Yes | Exponential backoff |
| 503 | Service unavailable | Yes | Exponential backoff |
| 504 | Gateway timeout | Yes | Exponential backoff |
| Network errors | ECONNRESET, ETIMEDOUT | Yes | Exponential backoff |
| 400 | Bad request | No | Programmer error |
| 401 | Unauthorized | No | Bad API key |
| 404 | Not found | No | Wrong endpoint |

### Exponential Backoff with Jitter

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 30000 } = {}
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableError(error) || attempt === maxAttempts - 1) throw error;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
        * (0.5 + Math.random() * 0.5);  // Full jitter: 50-100% of computed delay
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

**Why jitter?** Without it, all clients retrying after a server hiccup send a spike at the same time (thundering herd). Jitter staggers retries randomly across time.

**Full jitter vs equal jitter**:
- Full jitter: `random(0, baseDelay × 2^attempt)` — minimizes contention
- Equal jitter: `baseDelay × 2^attempt / 2 + random(0, half)` — guarantees minimum wait

---

## Circuit Breaker Pattern

### The Problem

When OpenAI is experiencing sustained failures, retrying wastes resources, increases latency, and can worsen cascading failures. The circuit breaker stops calling the failing service entirely.

### States

```
CLOSED (normal)          OPEN (tripped)           HALF-OPEN (probing)
    │                        │                         │
    │ failures exceed        │ resetTimeout             │ test request
    │ threshold              │ expires                  │ succeeds
    ├──────────────→         ├──────────────→           ├──────────────→ CLOSED
    │                        │                         │
    │                        │ all requests             │ test request
    │                        │ fail-fast                │ fails
    │                        │                         ├──────────────→ OPEN
```

### Implementation with Opossum

```typescript
import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(callOpenAI, {
  timeout: 10000,               // Requests > 10s = failure
  errorThresholdPercentage: 50, // Open if 50% of requests fail
  resetTimeout: 5000,           // Probe recovery after 5s
  volumeThreshold: 10,          // Min requests before calculating error %
});

breaker.fallback(() => ({
  error: 'AI analysis temporarily unavailable',
  retryAfter: 5,
}));

breaker.on('open', () => logger.warn('Circuit OPEN — OpenAI calls suspended'));
breaker.on('halfOpen', () => logger.info('Circuit HALF-OPEN — testing'));
breaker.on('close', () => logger.info('Circuit CLOSED — OpenAI restored'));
```

### What Should Trip the Circuit

- OpenAI 5xx errors — yes
- Request timeouts — yes
- 429 rate limit errors — **no** (handle with retry-with-backoff, not circuit breaker)
- 400 bad request — **no** (programmer error, not service failure)

---

## Recommendations for This Project

### Current State

The backend uses `throw new Error(...)` which becomes opaque 500s. `HarParserService` throws `BadRequestException` correctly, but `AnalysisService` and `OpenaiService` use generic `Error`.

### Recommended Changes

1. **Replace generic `Error` throws** with specific `HttpException` subclasses
2. **Add a global exception filter** for uniform RFC 7807 responses
3. **Add retry with backoff** to OpenAI calls (3 attempts, 1s/2s/4s base delay)
4. **Consider circuit breaker** if deploying as a shared service (opossum, ~70K downloads/week)
5. **Add correlation IDs** to requests for log tracing

### Priority

```
Phase 1: Custom exception classes + global filter        (structured errors)
Phase 2: Retry with backoff on OpenAI calls              (resilience)
Phase 3: Circuit breaker + health check for OpenAI       (production readiness)
```

## References

- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [RFC 7807 Problem Details](https://www.rfc-editor.org/rfc/rfc7807.html)
- [RFC 9457 (Updated Problem Details)](https://www.rfc-editor.org/rfc/rfc9457.html)
- [OpenAI Rate Limits Cookbook](https://cookbook.openai.com/examples/how_to_handle_rate_limits)
- [Opossum Circuit Breaker](https://github.com/nodeshift/opossum)
- [Node Best Practices — Error Handling](https://github.com/goldbergyoni/nodebestpractices#2-error-handling-practices)
