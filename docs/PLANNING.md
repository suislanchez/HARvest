# Project Planning

## Project Goals

**Primary goal**: Given a HAR file and a natural-language description, return the exact curl command for the matching API request — with zero hallucination, minimal cost, and sub-second latency.

**Secondary goals**:
- Make API reverse engineering accessible to non-technical users
- Provide a full inspect-and-execute workflow in the browser
- Keep per-query cost under $0.01 even for large HAR files

## Non-Goals

- **Not a proxy/recorder**: We don't intercept traffic — users export HAR files from browser DevTools
- **Not an API documentation generator**: We find one specific request, not all endpoints
- **Not a HAR editor**: We read HAR files, never modify them
- **Not a general LLM assistant**: The LLM does exactly one thing — match a description to an index
- **Not a multi-model orchestrator**: Single model, single pass, single purpose

## Design Principles

### 1. LLM as semantic matcher only
The LLM receives a compact summary and returns an index number. It never sees raw HAR data, never generates curl commands, never makes filtering decisions. This eliminates hallucination by construction — the curl command is built deterministically from the original HAR entry.

### 2. Conservative filtering
The pre-filter pipeline removes only what we're certain about: static assets (`.js`, `.css`, `.png`), known tracking domains (46 domains), non-API MIME types, CORS preflights, aborted requests, redirects. When in doubt, we include — a few extra entries cost pennies in tokens but a false negative costs the user's trust.

### 3. Deterministic curl generation
Every aspect of curl output is reproducible: same HAR entry always produces the same curl command. No randomness, no LLM involvement, no heuristic ordering. Shell safety via single-quoting, not escaping.

### 4. Token efficiency as a feature
Token cost directly affects usability. A $0.50/query tool won't get used. Our multi-layer reduction pipeline (filtering → dedup → summarization) achieves 98-99% token savings compared to naive approaches, keeping per-query cost under $0.002.

### 5. Memory-only processing
HAR files contain auth tokens, cookies, and session data. They are never written to disk — processed entirely in memory from upload to response.

## Key Decisions

### Architecture: Index-return over curl generation
**Decision**: LLM returns an index number; deterministic code generates the curl command.
**Why**: Eliminates hallucination. LLMs can fabricate headers, invent query parameters, or mangle URLs. By only asking "which request?" (a classification task), we get LLM benefits (semantic understanding) without LLM risks (fabrication).
**Alternatives considered**: Having the LLM generate curl directly (too unreliable), having it return the URL (still needs the rest of the request), having it return multiple fields (more complex output format with more failure modes).

### Model: gpt-4o-mini as default
**Decision**: Use `gpt-4o-mini` for all matching.
**Why**: Best cost/accuracy ratio for structured matching. Our eval suite shows 98.3% accuracy — equivalent to larger models on this task because the problem is well-constrained (pick from a numbered list with clear context). Cost is ~$0.001/query.
**Alternatives considered**: `gpt-4o` (3x cost, no accuracy improvement on our eval), embeddings-based matching (doesn't handle multi-signal matching well), fine-tuned model (unnecessary given high accuracy with prompting).

### Pipeline: Single-pass over multi-stage
**Decision**: One LLM call per query, no screening pass.
**Why**: Pre-filtering already reduces entry count to under 50 in most cases. A two-pass pipeline (nano model for screening, then mini for confirmation) adds latency and complexity for marginal token savings. The crossover point where two-pass wins is ~500 filtered entries — rare in practice.
**When to reconsider**: If HAR files regularly contain 500+ API requests after filtering (e.g., long-running SPA recordings).

### Deduplication: Path-parameterized with GraphQL awareness
**Decision**: Dedup by `"METHOD /parameterized/path"`, with GraphQL keyed by `"METHOD /path:operationName"`.
**Why**: Repeated requests (pagination, polling, retries) inflate token count without adding information. Path parameterization (`/users/123` → `/users/{id}`) catches numeric and UUID variants. GraphQL needs operationName to distinguish semantically different requests on the same endpoint.

### Filtering: Static skip-lists over dynamic classification
**Decision**: Hardcoded lists of domains (46), extensions (32), headers (28), and MIME types.
**Why**: Deterministic, zero-cost, auditable. No false positives on API requests. Lists are comprehensive enough that dynamic classification (e.g., using `_resourceType`) adds complexity without practical benefit.
**Maintenance**: New tracking domains occasionally need adding. The lists are centralized in `backend/src/common/constants/`.

### Curl: Custom generator over existing libraries
**Decision**: Build a ~50-line curl generator instead of using `har-to-curl` npm package.
**Why**: The popular `har-to-curl` package is archived, has known issues with shell quoting, and doesn't handle the edge cases we care about (`--data-raw`, cookie extraction, method inference). Our implementation is focused and auditable.

## What Was Considered But Rejected

| Approach | Why rejected |
|----------|-------------|
| **Embeddings for matching** | Requires vectorizing both the query and all entries, then computing similarity. Doesn't handle multi-signal matching (URL + method + body + response) as well as a prompted LLM. More infrastructure (vector store) for worse accuracy. |
| **Browser extension** | Would give richer data (DOM context, request initiator chains) but adds distribution complexity, browser compatibility issues, and security review requirements. HAR export is universal and good enough. |
| **Full HAR to LLM** | Catastrophically expensive. A 200-entry HAR file would cost ~$0.32 per query. Our approach: ~$0.002. |
| **Response body analysis** | Including full response bodies would help matching but explodes token count. Response previews (150 chars) are the compromise — enough context for semantic hints without the cost. |
| **Multi-model pipeline** | Nano model screens, mini model confirms. Adds latency, complexity, and failure modes. Only worthwhile above ~500 filtered entries, which is rare. |
| **Streaming responses** | LLM response is ~50 tokens of JSON. Streaming adds complexity for zero perceptible latency improvement. |
| **Client-side LLM calls** | Would expose the API key to the client. Server-side keeps credentials safe. |
| **`_resourceType` filtering** | Chrome-specific field, not in the HAR spec. Would miss API requests incorrectly typed as "other" and break on non-Chrome HAR files. |

## Future Considerations

### Near-term
- **Batch mode**: Analyze multiple descriptions against the same HAR file in one session (share the parse/filter/summarize work)
- **HAR diff**: Compare two HAR files to find what changed (useful for debugging "it worked yesterday")
- **Saved sessions**: Persist analysis results for sharing/review

### Medium-term
- **Two-pass pipeline**: If HAR files grow (long-running SPAs, mobile apps), implement nano-model screening to handle 500+ filtered entries efficiently
- **Request chain detection**: Identify auth flows (login → token → API call) and generate multi-step curl scripts
- **OpenAPI generation**: From identified endpoints, generate a basic OpenAPI spec

### Not planned
- Browser extension (HAR export is sufficient)
- Self-hosted LLM support (OpenAI API compatibility is wide enough)
- Real-time traffic capture (out of scope — use mitmproxy for that)
