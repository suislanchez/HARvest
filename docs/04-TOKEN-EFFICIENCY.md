# 4. Token Efficiency Strategies - The Key Differentiator

## Why This Matters

The assignment explicitly evaluates: "Does the implementation have efficient token usage when querying the LLM? What trade-offs are being accepted for token efficiency?"

This is the **most important technical decision** in the project.

## Token Counts: Reality Check

| What You're Sending | Tokens per entry | 200 entries total |
|---------------------|-----------------|-------------------|
| Full HAR entry (with response body) | 1,500-15,000 | 300K-3M tokens |
| Stripped entry (no body/timing/cache) | 250-600 | 50K-120K tokens |
| One-liner summary | 15-25 | 3K-5K tokens |

**Response bodies = 80-95% of all tokens.** Stripping them is the #1 optimization.

## The Architecture: Two-Pass Pipeline

```
HAR File (200+ entries)
       │
       ▼
[Deterministic Pre-filter] ─── Code, no LLM
  Remove: static assets, tracking, HTML, OPTIONS, failed requests
  Result: ~10-30 API candidates
       │
       ▼
[Summarize] ─── Code, no LLM
  Each entry → one-liner: "1. GET /api/weather?city=SF → application/json 200"
       │
       ▼
[Pass 1: GPT-4.1-nano] ─── $0.10/M input tokens
  Input: summaries + user description
  Output: candidate indices [3, 7, 15]
  Cost: ~$0.0005
       │
       ▼
[Pass 2: GPT-4.1-mini] ─── $0.40/M input tokens
  Input: full stripped entries for [3, 7, 15] only
  Output: confirmed best match index + confidence
  Cost: ~$0.006
       │
       ▼
[harEntryToCurl()] ─── Code, no LLM
  Convert winning entry → curl command
  ZERO hallucination risk on the actual curl output
```

## Summary Formats Compared

### Format A: One-liner (best tokens/accuracy ratio)
```
1. GET /api/weather?city=SF → application/json 200
2. POST /api/auth/login → application/json 200
3. GET /jokes/random?count=5 → application/json 200
```
~20 tokens each. Best for Pass 1 filtering.

### Format B: JSON-compressed (best accuracy)
```json
{"i":1,"m":"GET","u":"/api/weather?city=SF","s":200,"ct":"json","auth":true,"body":null}
```
~50 tokens each. Best when header presence matters.

### Recommendation: Use Format A for Pass 1, send full stripped entries for Pass 2.

## What to Strip (Before Sending to LLM)

### Always strip (never needed)
- `response.content.text` (response body) ← **90% of savings**
- `timings` object
- `cache` object
- `pageref`, `startedDateTime`, `time`
- `connection`, `_initiator`, `_priority`
- `headersSize`, `bodySize` (metadata)

### Strip values, keep names
- **Cookies**: `session_id=***` (name reveals auth pattern, value is secret + wastes tokens)
- **Authorization**: `Bearer ***` (presence matters, value is secret)
- **Long header values**: Truncate to ~100 chars

### Always keep
- `request.method`
- `request.url` (path + query params)
- `response.status`
- `response.content.mimeType`
- `response.content.size`
- `request.postData.text` (first 200 chars)
- Header names (especially auth-related)

## Cost Calculations (Real Numbers)

### Model Pricing (GPT-4.1 family)
| Model | Input/M tokens | Cached Input/M | Output/M tokens |
|-------|---------------|----------------|-----------------|
| GPT-4.1-nano | $0.10 | $0.025 | $0.40 |
| GPT-4.1-mini | $0.40 | $0.10 | $1.60 |
| GPT-4.1 | $2.00 | $0.50 | $8.00 |

### Per-Query Cost by HAR Size

| HAR Size | Naive (mini, full) | Two-Pass (nano+mini) | Savings |
|----------|-------------------|---------------------|---------|
| 20 entries | $0.05 | $0.0007 | 98.6% |
| 200 entries | $0.32 | $0.002 | 99.4% |
| 2000 entries | $3.20 | $0.012 | 99.6% |

### When to use single-pass vs two-pass
| Condition | Approach |
|-----------|----------|
| < 30 entries after pre-filter | Single-pass with nano ($0.001) |
| 30-500 entries after pre-filter | Two-pass nano → mini |
| 500+ entries | Two-pass + chunk into batches of 500 |
| Non-interactive/batch | Add Batch API for 50% discount |

## OpenAI API Features to Leverage

### Structured Outputs (JSON mode)
```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4.1-nano',
  messages: [...],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'api_match',
      schema: {
        type: 'object',
        properties: {
          match_index: { type: 'integer' },
          confidence: { type: 'number' },
          reason: { type: 'string' }
        },
        required: ['match_index', 'confidence']
      }
    }
  }
});
```
- Forces valid JSON output
- Eliminates hallucinated field names/types
- Uses constrained decoding (invalid tokens masked to probability 0)

### Prompt Caching (75% discount on repeated prefixes)
- Place system prompt + instructions FIRST (stable prefix, gets cached)
- Place HAR data LAST (variable suffix)
- Minimum 1,024 tokens in prefix for cache eligibility
- Cache TTL: 5-10 minutes (good for multiple queries on same HAR)

### max_tokens
- Set to ~500 for structured output (prevents runaway costs)
- Our output is tiny (an index + confidence), so cap it low

## Trade-offs to Discuss in Interview

| Trade-off | Decision | Rationale |
|-----------|----------|-----------|
| Strip response bodies | Yes | 90% token savings, rarely needed for identification |
| Two-pass vs single-pass | Two-pass for 30+ entries | 86-99% cost reduction |
| nano vs mini for Pass 1 | nano | 4x cheaper, accurate enough for filtering |
| Index return vs explanation | Index + brief reason | Minimal output tokens, zero curl hallucination |
| Pre-filter before LLM | Aggressive | Deterministic filtering is free and 100% reliable |
| Response body for Pass 2 | First 200 chars only | Provides context without token explosion |
| Batch API | Not for interactive use | Adds latency, only useful for batch processing |

## The Killer Feature

**LLM returns an index → code looks up full HAR entry → code generates curl.**

The LLM never generates the curl command itself. This means:
- Zero hallucination on the actual output
- Perfect accuracy on headers, body, URL
- LLM only does what it's good at: semantic matching
- Code does what it's good at: deterministic transformation
