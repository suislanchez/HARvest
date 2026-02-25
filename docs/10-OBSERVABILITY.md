# Observability

Research into structured logging, request tracing, metrics, and health checks for a NestJS application with OpenAI integration.

---

## Structured Logging

### Pino vs Winston

| Feature | Pino | Winston |
|---------|------|---------|
| Performance | 5-10x faster (worker thread serialization) | Adequate for most apps |
| Output format | JSON by default | Configurable (JSON, text, custom) |
| NestJS integration | `nestjs-pino` | `nest-winston` |
| Auto request context | Yes (via `AsyncLocalStorage`) | Manual setup needed |
| Weekly downloads | ~5M | ~17M |
| Best for | Production, high throughput | Rich transport config, human-readable dev logs |

**Recommendation**: `nestjs-pino` for production — automatic request context binding means every log statement from any service includes request ID, path, and user ID without manual context passing.

### Request Correlation IDs

Unique identifier per request, propagated through all log statements:

```typescript
LoggerModule.forRoot({
  pinoHttp: {
    genReqId: (req) => {
      return req.headers['x-correlation-id']
        ?? req.headers['x-request-id']
        ?? crypto.randomUUID();
    },
    customProps: (req) => ({
      correlationId: req.id,
    }),
  },
})
```

**Best practice**: Accept incoming `X-Correlation-ID` header (for distributed tracing), generate UUID if none provided, echo it back in the response for support requests.

### What to Log

| Event | Level | Fields |
|-------|-------|--------|
| Request received | info | method, path, correlationId |
| HAR parsed | info | totalEntries, fileSize |
| Entries filtered | info | filteredCount, removedCount |
| Dedup completed | info | uniqueCount, duplicatesRemoved |
| LLM call started | info | model, inputTokenEstimate |
| LLM call completed | info | matchIndex, confidence, promptTokens, completionTokens, latencyMs |
| LLM call failed | error | errorType, statusCode, retryAttempt |
| Curl generated | info | method, url (truncated) |
| Proxy request | info | targetUrl (sanitized), blocked (boolean) |
| Request completed | info | statusCode, totalLatencyMs |

---

## Request Tracing with OpenTelemetry

### Key Principle

OpenTelemetry instrumentation must be initialized **before** NestJS imports any modules. Setup goes in a separate file imported before `main.ts` bootstraps.

### Installation

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http
```

### Auto-Instrumentation

Automatically traces: Express/Fastify HTTP, outgoing HTTP calls (to OpenAI), Redis operations, and more — no changes to business logic.

### NestJS Module

`nestjs-otel` (`pragmaticivan/nestjs-otel`) provides NestJS DI-integrated tracing and metrics.

### Trace Backends

| Tool | Type | Notes |
|------|------|-------|
| Jaeger | Open source, self-hosted | Standard for microservices |
| SigNoz | Open source with UI | All-in-one observability |
| Google Cloud Trace | Managed | If on GCP |
| Datadog | Managed | Full-featured, expensive |
| Honeycomb | Managed | Great query interface |

### Trace-Log Correlation

Inject `traceId` and `spanId` from OpenTelemetry into pino log entries. This lets you click from a trace span to the exact log lines in your log aggregator.

---

## Key Metrics

### HTTP Layer

| Metric | Type | Labels |
|--------|------|--------|
| `http_request_duration_ms` | Histogram (p50/p95/p99) | endpoint, status_code |
| `http_requests_total` | Counter | endpoint, status_code |
| `http_error_rate` | Derived (errors/total) | endpoint |

### LLM-Specific

| Metric | Type | Why |
|--------|------|-----|
| `llm_tokens_input_total` | Counter | Track input token consumption |
| `llm_tokens_output_total` | Counter | Track output token consumption |
| `llm_cost_usd_total` | Counter | Running dollar cost (tokens × model rates) |
| `llm_latency_ms` | Histogram | OpenAI response time distribution |
| `llm_cache_hits_total` | Counter | Cache effectiveness |
| `llm_cache_misses_total` | Counter | Cache miss rate |
| `llm_errors_total` | Counter (by error type) | Rate limits, timeouts, 5xx |

### System

| Metric | Type | Why |
|--------|------|-----|
| `process_heap_bytes` | Gauge | Critical for HAR parsing — detect memory pressure |
| `process_cpu_seconds_total` | Counter | CPU usage |
| `nodejs_active_handles_total` | Gauge | Detect handle leaks |
| `nodejs_event_loop_lag_seconds` | Histogram | Detect event loop blocking |

### Stack

Export via `nestjs-otel` or `@willsoto/nestjs-prometheus` → scrape with Prometheus → visualize with Grafana.

**Alert thresholds**:
- p99 latency > 5s
- Error rate > 5% over 5 minutes
- Daily LLM cost > budget threshold
- Heap usage > 80% of max

---

## Health Check Endpoints

### Liveness vs Readiness

| Endpoint | Purpose | Checks | Kubernetes action on failure |
|----------|---------|--------|------------------------------|
| `GET /health/live` | Is the process alive? | Event loop responsive only | Restart pod |
| `GET /health/ready` | Can it accept traffic? | Critical dependencies (OpenAI reachable, etc.) | Remove from load balancer |

### NestJS Terminus

```bash
npm install @nestjs/terminus
```

```typescript
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
  ) {}

  @Get('live')
  @HealthCheck()
  liveness() {
    return this.health.check([]);  // Process responsiveness only
  }

  @Get('ready')
  @HealthCheck()
  readiness() {
    return this.health.check([
      () => this.http.pingCheck('openai', 'https://api.openai.com/v1/models'),
    ]);
  }
}
```

**Response format**:
```json
{
  "status": "ok",
  "info": { "openai": { "status": "up" } },
  "error": {},
  "details": { "openai": { "status": "up" } }
}
```

### Current State

Our Docker healthcheck hits `GET /api` which returns 404, but `wget --spider` treats any HTTP response as success — it passes vacuously. Replace with a proper Terminus endpoint.

---

## OpenAI Cost Monitoring

### From API Responses

Every OpenAI response includes usage data:

```json
{
  "usage": {
    "prompt_tokens": 1500,
    "completion_tokens": 250,
    "total_tokens": 1750,
    "prompt_tokens_details": {
      "cached_tokens": 1024
    }
  }
}
```

### Cost Tracking Architecture

```
OpenAI response
    │
    ├─ Extract usage.prompt_tokens, usage.completion_tokens
    ├─ Compute cost: inputTokens × inputRate + outputTokens × outputRate
    ├─ Log structured event: { model, tokens, cost, latencyMs, correlationId }
    ├─ Increment Prometheus counters
    └─ (Optional) Persist to time-series store for daily aggregation
```

### Tools

| Tool | Purpose |
|------|---------|
| OpenAI Usage API | REST API for daily spend breakdown by model/key |
| `tokenwise-tracker` (npm) | Wraps OpenAI client, auto-logs cost/tokens/latency |
| OpenMeter | Ingests usage events, provides billing/metering infrastructure |

---

## Recommendations for This Project

### Current State

- `console.log` for all logging (no structure, no levels, no correlation)
- Token counts logged but not persisted or metered
- No health check endpoint (Docker healthcheck is vacuous)
- No metrics collection

### Implementation Plan

```
Phase 1: Structured logging
  - Replace console.log with nestjs-pino
  - Add correlation IDs
  - Log key pipeline events with structured fields

Phase 2: Health checks
  - Add @nestjs/terminus
  - Liveness endpoint (process alive)
  - Readiness endpoint (OpenAI reachable)
  - Fix Docker healthcheck to use proper endpoint

Phase 3: Metrics
  - Add Prometheus metrics for HTTP, LLM, and system
  - Track per-request cost
  - Grafana dashboard for latency, error rate, cost

Phase 4: Tracing (if needed)
  - OpenTelemetry auto-instrumentation
  - Trace LLM calls end-to-end
  - Correlate traces with logs
```

## References

- [nestjs-pino GitHub](https://github.com/iamolegga/nestjs-pino)
- [NestJS Terminus Docs](https://docs.nestjs.com/recipes/terminus)
- [nestjs-otel GitHub](https://github.com/pragmaticivan/nestjs-otel)
- [OpenAI Usage API](https://platform.openai.com/docs/api-reference/usage)
- [SigNoz OpenTelemetry NestJS](https://signoz.io/blog/opentelemetry-nestjs/)
- [Prometheus + Grafana for Node.js](https://dev.to/gleidsonleite/supercharge-your-nodejs-monitoring-with-opentelemetry-prometheus-and-grafana-4mhd)
