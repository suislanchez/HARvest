# Rate Limiting & Abuse Prevention

Research into rate limiting algorithms, implementation strategies for NestJS, and cost protection for the OpenAI proxy.

---

## Rate Limiting Algorithms

### Algorithm Comparison

| Algorithm | How it works | Burst handling | Memory | Best for |
|-----------|-------------|----------------|--------|----------|
| **Fixed Window** | Counter per time interval, resets at boundary | Boundary bursts (2x limit possible at window edges) | O(1) | Simple internal APIs |
| **Sliding Window** | Weighted estimate across previous + current window | Smooth, no boundary bursts | O(1) counter variant | Public APIs (recommended default) |
| **Token Bucket** | Bucket refills at constant rate; requests consume tokens | Explicit bursts up to bucket capacity | O(1) | Bursty workloads, metered APIs |
| **Leaky Bucket** | Fixed-size queue, drains at constant rate | None — drops excess immediately | O(queue) | Network traffic shaping |

### Fixed Window

Divides time into intervals (e.g., 60 seconds). Counter increments per request, resets at the boundary.

**The boundary burst problem**: A client sends 10 requests at second 59 of window N and 10 more at second 1 of window N+1 — effectively 20 requests in 2 seconds while staying within "10 per minute." This is acceptable for internal tools but problematic for public APIs.

### Sliding Window (Recommended)

The counter variant keeps counts for the previous and current fixed windows, then estimates the current rate:

```
rate = prevCount × ((windowDuration - elapsed) / windowDuration) + currentCount
```

No boundary burst problem. More accurate reflection of real-time usage. Recommended by Kong, IETF draft authors, and major API platforms.

### Token Bucket

A bucket of capacity `Bmax` refills at rate `r` tokens/second. Each request consumes one token. Empty bucket = rejected request. Accumulated unused capacity allows controlled bursts up to `Bmax`.

Used by Stripe for their API throttling. Good for APIs where idle users should be able to send a burst.

### Leaky Bucket

Requests enter a fixed-size queue and are processed at a constant rate. Queue full = immediate drop. Produces the smoothest output rate but offers no burst accommodation. Better suited for network traffic shaping than API rate limiting.

---

## Identification Strategies

### Per-IP

- Default in most frameworks including `@nestjs/throttler`
- No authentication required
- **Problem**: shared IPs (NAT, corporate proxies) throttle many legitimate users together
- Easily bypassed by rotating IPs (proxies, VPNs)
- Best for: public/unauthenticated endpoints, DDoS protection at the edge

### Per-API-Key

- Ties limits to an authenticated credential
- Supports tiered plans (free: 100 req/min, pro: 1000 req/min)
- Must extract from headers (`Authorization`, `X-API-Key`) and use as tracker key
- Best for: developer APIs, SaaS backends, OpenAI proxy scenarios

### Per-User

- Uses authenticated user identity (JWT sub, database user ID)
- Survives IP changes (mobile clients)
- Most fair for individual-user rate limiting
- Requires authentication middleware before rate limiter
- Best for: authenticated apps with individual quotas

---

## NestJS Implementation: @nestjs/throttler

### Setup

```bash
npm install @nestjs/throttler
```

### Configuration

```typescript
ThrottlerModule.forRoot([
  {
    name: 'short',
    ttl: seconds(10),    // 3 requests per 10 seconds
    limit: 3,
  },
  {
    name: 'long',
    ttl: hours(24),      // 1000 requests per day
    limit: 1000,
  },
])
```

Multiple named throttlers apply simultaneously — a request fails if it violates any rule.

### Decorators

```typescript
@Throttle({ short: { ttl: seconds(1), limit: 1 } })  // Override on specific route
@SkipThrottle()                                         // Exclude route (health checks, webhooks)
```

### Custom Tracker (Per-API-Key)

```typescript
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    return req.headers['x-api-key'] as string ?? req.ip;
  }
}
```

### Proxy Trust

For apps behind nginx/load balancers:
```typescript
app.set('trust proxy', 1);  // req.ip uses X-Forwarded-For
```

### Response Headers

`@nestjs/throttler` automatically adds:
- `X-RateLimit-Limit` — max requests in window
- `X-RateLimit-Remaining` — requests left
- `X-RateLimit-Reset` — when window resets

On violation: HTTP 429 with `ThrottlerException`.

### IETF Standardization

Active IETF draft (`draft-polli-ratelimit-headers`) proposes `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (without `X-` prefix). Some newer APIs already use this form.

---

## Express-rate-limit Alternative

`express-rate-limit` works at the Express middleware layer, before NestJS guards. Useful as an outer perimeter defense:

- Blanket IP-based protection on all routes before NestJS processing
- No access to NestJS context (no guards, decorators, DI)
- Use as a first line of defense; use `@nestjs/throttler` for NestJS-aware limits

---

## Rate Limiting the OpenAI Proxy (Cost Protection)

OpenAI does not natively support per-user spending limits — only organization-level monthly hard caps. For a proxy routing user requests to OpenAI, use a layered strategy:

### Recommended Architecture

```
Layer 1: Per-IP request limit      → @nestjs/throttler (10 req/min)
Layer 2: Per-user token budget     → Custom middleware tracking usage.total_tokens
Layer 3: Daily cost cap            → Compute cost from tokens × model rates
Layer 4: OpenAI org hard cap       → Safety net ($10K/month)
```

### Example Limits

```
OpenAI org hard cap:  $10,000/month  (safety net)
Proxy daily cap:      $300/day       (operational control)
Per-user daily:       50,000 tokens  (fairness)
Per-user rate:        10 req/minute  (DoS protection)
```

### Token Budget Tracking

After each OpenAI response, extract `usage.total_tokens`, compute cost (`inputTokens × inputRate + outputTokens × outputRate`), accumulate per user in Redis or in-memory, and reject requests when budget is exceeded.

---

## Distributed Rate Limiting: Redis vs In-Memory

### In-Memory (Default)

- No external dependencies
- Zero latency overhead
- State lost on restart
- **Not shared across instances** — horizontal scaling breaks limits (each instance has its own counter)
- Appropriate for: single-instance deployments, development

### Redis-Backed

- Shared across all instances — true per-user limits
- Persists across restarts
- ~1-5ms network overhead per request
- Required for: Kubernetes, load-balanced multi-instance setups

### NestJS Redis Adapter

```typescript
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

ThrottlerModule.forRootAsync({
  useFactory: (redis: Redis) => ({
    throttlers: [...],
    storage: new ThrottlerStorageRedisService(redis),
  }),
  inject: [REDIS],
})
```

---

## Recommendations for This Project

| Endpoint | Strategy | Limit |
|----------|----------|-------|
| `POST /api/analyze` | Per-IP sliding window | 10 req/min, 100 req/day |
| `POST /api/proxy` | Per-IP sliding window | 30 req/min |
| Health check | Skip throttle | Unlimited |

**Phase 1** (single instance): `@nestjs/throttler` with in-memory storage. Simple, no Redis dependency.

**Phase 2** (if scaling): Add Redis-backed storage via `@nest-lab/throttler-storage-redis`. Add per-user token budget tracking with cost alerts.

## References

- [NestJS Rate Limiting Docs](https://docs.nestjs.com/security/rate-limiting)
- [@nestjs/throttler GitHub](https://github.com/nestjs/throttler)
- [OpenAI Rate Limits Guide](https://platform.openai.com/docs/guides/rate-limits)
- [IETF RateLimit Headers Draft](https://www.ietf.org/archive/id/draft-polli-ratelimit-headers-02.html)
