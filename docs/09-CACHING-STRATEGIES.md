# Caching Strategies

Research into caching approaches for LLM-backed applications, from exact-match to semantic caching.

---

## Caching Layers

```
Request arrives
    │
    ├─ Layer 1: Exact-match cache (fastest, 100% precision)
    │   Key: SHA-256(harHash + description + model)
    │   Hit? → Return cached result immediately
    │
    ├─ Layer 2: Semantic cache (optional, higher hit rate)
    │   Embed description → cosine similarity search
    │   Similar enough? → Return cached result
    │
    ├─ Layer 3: OpenAI prompt caching (automatic, server-side)
    │   System prompt prefix cached by OpenAI
    │   50% discount on cached input tokens
    │
    └─ Layer 4: LLM call (cache miss)
        Store result in Layer 1 (and Layer 2 if enabled)
```

---

## Layer 1: Exact-Match Caching

### How It Works

Hash all inputs deterministically → look up hash → if found, return immediately.

### Cache Key Design

```typescript
const cacheKey = crypto
  .createHash('sha256')
  .update(JSON.stringify({
    harHash,                              // SHA-256 of raw file
    description: description.trim().toLowerCase(),
    model,                                // gpt-4o-mini
    temperature: 0,                       // Only cache deterministic responses
  }))
  .digest('hex');
```

**Include in key**: HAR content hash, normalized description, model name, temperature.
**Exclude from key**: timestamp, user ID, request ID.

### When to Use

Always — as the first cache layer. Fastest, cheapest, 100% precision. The hit rate is lower than semantic caching but there are zero false positives.

### TTL

HAR analysis is structural — same file + same question = same answer. Long TTL is safe:
- **24 hours to 7 days** for stable analysis results
- Add jitter: `ttl + Math.random() * jitterMs` to prevent cache stampedes

---

## Layer 2: Semantic Caching

### How It Works

Convert queries into vector embeddings, measure cosine similarity against cached embeddings. If similarity exceeds a threshold, return the cached response.

```
1. New query arrives
2. Embed query → 768/1536-dimensional vector
3. Search cached embeddings for cosine similarity ≥ threshold
4. If match found → return cached response (no LLM call)
5. If no match → call LLM, store response + embedding
```

### Similarity Threshold Trade-off

| Threshold | Hit rate | False positive risk |
|-----------|----------|-------------------|
| 0.95 | Low (~20%) | Very low |
| 0.90 | Medium (~40%) | Low |
| 0.85 | High (~55%) | Moderate |
| 0.80 | Very high (~69%) | Higher |

For HAR analysis, **0.90-0.95 is recommended** — a wrong cached answer (matching "weather API" to "stock API") is worse than an extra $0.001 LLM call.

### Published Performance Data

- At 0.80 threshold: cache hit rate up to 68.8%, positive hit rate >97%
- Typical latency improvement: 2-4x for cache hits; 50-100x in optimal cases
- VentureBeat: 73% cost reduction in one production case

### Applicability to This Project

Semantic caching is most useful when users ask similar questions in different phrasings:
- "the weather forecast endpoint" vs "weather forecast API" vs "forecast request"
- These are semantically identical but hash differently

**Cache key strategy**: `(SHA-256(harFile), embedding(description))` — same HAR, similar description → cache hit.

### Frameworks

| Tool | Language | Notes |
|------|----------|-------|
| GPTCache | Python | Most mature; integrates with LangChain |
| Upstash Semantic Cache | Hosted | Redis-based, managed service |
| LiteLLM proxy | Python | Built-in semantic caching with Redis |

No mature Node.js semantic caching library exists yet. Would require: embedding generation (OpenAI `text-embedding-3-small`), vector similarity search (Redis with vector module, or pgvector), and cache management logic.

---

## Layer 3: OpenAI Prompt Caching

### How It Works

OpenAI's server-side KV cache stores attention hidden states for previously processed prompt prefixes. When a prompt's prefix matches, those tokens aren't recomputed.

### Details

- **Activation**: Automatic since October 2024 for all supported models (gpt-4o, gpt-4o-mini, o1-*)
- **Minimum**: Prompts must exceed **1,024 tokens** to activate
- **Granularity**: Cache stored in 128-token increments
- **Scope**: Per-organization (not shared across orgs)
- **TTL**: "A few minutes to a few hours" of inactivity
- **Discount**: **50% on cached input tokens**

### How to Maximize It

Structure prompts so the **stable system prompt comes first** and **variable content (HAR data, user description) comes last**. The longer and more stable the prefix, the higher the cache hit rate.

Our system prompt (~200 tokens) is below the 1,024 minimum, so prompt caching doesn't currently activate. To benefit:
- Extend the system prompt with detailed examples (pad to >1,024 tokens)
- Or accept that prompt caching won't apply at our current prompt size

### Monitoring

Every response includes `usage.prompt_tokens_details.cached_tokens` — check this to verify caching is working.

---

## In-Memory Cache: lru-cache vs node-cache

### lru-cache (Recommended)

```typescript
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, AnalysisResult>({
  max: 500,                          // Max entries (prevents unbounded growth)
  ttl: 1000 * 60 * 60 * 24,         // 24 hours
});
```

- LRU eviction — when full, least recently used item is evicted
- Configurable by count (`max`) or byte size (`maxSize` + `sizeCalculation`)
- Most popular Node.js in-memory cache (millions of weekly downloads)
- **Key advantage**: bounded memory — prevents OOM in long-running processes

### node-cache

- TTL support with automatic expiry
- **No LRU eviction** — grows unboundedly unless `deleteOnExpire` is set
- Built-in `getStats()` for hit/miss tracking
- Fine for medium-scale use but less safe for production

### Redis

- Shared across instances (required for horizontal scaling)
- Persists across restarts
- ~1-5ms overhead per operation
- Use when: multiple backend instances, or need persistence

### Recommendation for This Project

**Phase 1**: `lru-cache` with `max: 500` and 24-hour TTL. Zero dependencies, bounded memory, works for single-instance deployment.

**Phase 2**: Redis if scaling to multiple instances or needing cross-restart persistence.

---

## Cache Invalidation

### TTL-Based (Primary)

- Structural analysis: **24 hours to 7 days** (same HAR + question = same answer)
- Add jitter: `ttl + Math.random() * jitterRange` to prevent stampedes
- All cached entries expire simultaneously = all users hit LLM at once = spike

### Event-Based

- If HAR file is re-uploaded, invalidate all entries for that `harHash`
- User-triggered "re-analyze" should bypass cache

### What NOT to Cache

- Responses from `temperature > 0` (non-deterministic)
- Error responses from the LLM
- Streaming/partial responses

### Cache Stampede Prevention

When a popular cache entry expires, multiple concurrent requests may all miss the cache and call the LLM simultaneously.

**Mitigation**:
- **Probabilistic early expiration**: Recalculate before TTL with probability proportional to time-until-expiry
- **Locking**: Use a mutex (Redis `SET NX EX`) so only one request calls the LLM; others wait for the result

---

## Cost Savings Analysis

Using gpt-4o-mini ($0.15/M input, $0.60/M output), ~800 input tokens avg, ~60 output tokens avg:

| Cache hit rate | LLM calls saved (per 1000 requests) | Monthly saving |
|---------------|-------------------------------------|----------------|
| 0% | 0 | Baseline |
| 30% | 300 | ~$0.04/1000 req |
| 50% | 500 | ~$0.07/1000 req |
| 70% | 700 | ~$0.09/1000 req |

At gpt-4o-mini pricing, absolute savings per request are tiny (~$0.0001). Caching matters more for:
1. **Latency** — cache hit returns in <1ms vs 500-2000ms for LLM call
2. **Rate limit headroom** — fewer LLM calls = more capacity for real requests
3. **Reliability** — cache serves during OpenAI outages

If using a more expensive model (gpt-4o at $2.50/M input), savings are ~17x larger.

---

## Recommendations for This Project

### Current State

No caching. Every request makes a fresh OpenAI API call.

### Implementation Plan

```
Phase 1: Exact-match LRU cache (lru-cache, max: 500, TTL: 24h)
  - Cache key: SHA-256(harHash + normalized description + model)
  - Cache at the AnalysisService level (after LLM call, before response)
  - Add cache-hit header to response for debugging

Phase 2: Parse/filter cache (separate from LLM cache)
  - Cache key: SHA-256(harFileBuffer)
  - Cache value: { filtered entries, LLM summary string }
  - Benefit: multiple queries against same HAR skip parsing/filtering

Phase 3 (if needed): Semantic cache or Redis
  - Only if hit rates from Phase 1 are low and latency/cost matters
```

## References

- [lru-cache (npm)](https://www.npmjs.com/package/lru-cache)
- [OpenAI Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching)
- [Redis Semantic Caching Guide](https://redis.io/blog/what-is-semantic-caching/)
- [GPTCache GitHub](https://github.com/zilliztech/GPTCache)
- [LLM Caching Best Practices](https://wangyeux.medium.com/llm-caching-best-practices-from-exact-keys-to-semantic-conversation-matching-8b06b177a947)
