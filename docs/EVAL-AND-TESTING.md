# Evaluation & Testing

## Overview

The eval suite validates the full analysis pipeline end-to-end: HAR parsing → filtering → deduplication → summarization → LLM matching. Each test case provides a HAR fixture, a natural-language description, and an expected URL pattern — then checks whether the LLM selects the correct request.

**Location**: `backend/src/modules/analysis/eval.spec.ts`
**Fixtures**: `test-fixtures/` (project root)

## Running the Eval Suite

```bash
# Full eval run (requires OPENAI_API_KEY in .env)
cd backend
npx jest eval.spec.ts --verbose

# Run a specific category
npx jest eval.spec.ts -t "E-commerce"

# Run a specific difficulty
npx jest eval.spec.ts -t "easy"
```

The suite has a 2-minute timeout per test (`jest.setTimeout(120000)`) to accommodate OpenAI API latency.

### Interpreting Results

The `afterAll` reporter prints:

1. **Overall totals**: total tests, passed, failed, pass rate %, average confidence
2. **By difficulty**: pass count and avg confidence for easy/medium/hard/extreme
3. **By category**: pass count and avg confidence for each fixture category
4. **Per-test table**: PASS/FAIL status, matched URL (truncated to 80 chars), confidence, filter ratio `[filtered/total entries]`, body match status

Example output:
```
Overall: 59/60 passed (98.3%), avg confidence: 92.1%

By difficulty:
  easy:    5/5   (100.0%)  avg confidence: 97.2%
  medium:  19/19 (100.0%)  avg confidence: 94.1%
  hard:    23/24 ( 95.8%)  avg confidence: 89.3%
  extreme: 12/12 (100.0%)  avg confidence: 86.7%
```

## Test Categories

| Category | Fixture | Tests | Difficulty | What it validates |
|----------|---------|-------|------------|-------------------|
| **Basic** | `simple.har` | 3 | easy | Simple REST APIs with clear URL patterns |
| **Recipe** | `recipe-search.har` | 3 | easy–medium | Search endpoints with query parameters |
| **E-commerce** | `ecommerce.har` | 6 | easy–hard | Product/cart/checkout flows with similar endpoints |
| **GraphQL** | `graphql-app.har` | 5 | medium–hard | operationName discrimination on single `/graphql` endpoint |
| **Noisy** | `multi-api-noisy.har` | 4 | medium–hard | Target API buried in tracking/analytics noise |
| **Dashboard** | `spa-dashboard.har` | 8 | medium–extreme | SPA with many similar data-fetching endpoints |
| **Streaming** | `streaming-platform.har` | 7 | medium–extreme | Media APIs with similar URL structures |
| **Fintech** | `fintech-banking.har` | 7 | medium–extreme | Financial APIs with auth-heavy flows |
| **Travel** | `travel-booking.har` | 7 | medium–hard | Booking flows with search/select/confirm patterns |
| **Collab** | `realtime-collab.har` | 7 | medium–extreme | Real-time app with WebSocket-adjacent REST endpoints |
| **Vague** | Mixed fixtures | 6 | extreme | Ambiguous descriptions that require inference |

### Difficulty Levels

| Level | Count | Description |
|-------|-------|-------------|
| **Easy** | 5 | Obvious URL match, clear description, few similar endpoints |
| **Medium** | 21 | Multiple plausible matches, requires considering method + path + body |
| **Hard** | 25 | Ambiguous descriptions, similar endpoints, needs response preview context |
| **Extreme** | 12 | Vague descriptions, many similar endpoints, or requires multi-signal reasoning |

## Test Case Structure

Each test case is defined as an object:

```typescript
{
  description: string;          // Natural-language query (what the user types)
  fixture: string;              // HAR fixture filename
  expectedUrlPattern: string;   // Substring that must appear in matched URL
  expectedBodyPattern?: string; // Optional: substring that must appear in request body
  difficulty: 'easy' | 'medium' | 'hard' | 'extreme';
  category: string;             // Category name for grouping in reports
}
```

### Assertion Logic

1. Load fixture (cached — parsed once per fixture, reused across tests)
2. Call `openai.identifyApiRequest(llmSummary, description, filtered.length)`
3. Get the matched entry's URL and body from the filtered array
4. Check: `matchedUrl.includes(expectedUrlPattern)` → must be true
5. If `expectedBodyPattern` defined: `matchedBody.includes(expectedBodyPattern)` → must be true
6. Test passes if both checks pass

## Adding New Test Cases

### 1. Create or select a fixture

Fixtures are HAR files in `test-fixtures/`. To create a new one:
- Record in Chrome DevTools (Network tab → Export HAR)
- Or craft a synthetic one — minimum structure:

```json
{
  "log": {
    "entries": [
      {
        "request": {
          "method": "GET",
          "url": "https://api.example.com/endpoint",
          "headers": [],
          "queryString": [],
          "postData": { "text": "" }
        },
        "response": {
          "status": 200,
          "content": {
            "mimeType": "application/json",
            "size": 1024,
            "text": "{\"key\": \"value\"}"
          }
        }
      }
    ]
  }
}
```

Include a mix of API requests and noise (static assets, tracking pixels) for realistic testing.

### 2. Add test cases

Add entries to the test case array in `eval.spec.ts`:

```typescript
{
  description: 'the endpoint that fetches user notifications',
  fixture: 'your-fixture.har',
  expectedUrlPattern: '/api/notifications',
  difficulty: 'medium',
  category: 'YourCategory',
}
```

### 3. Verify

```bash
cd backend
npx jest eval.spec.ts -t "YourCategory" --verbose
```

### Tips for Good Test Cases

- **Easy**: Description closely matches URL path (e.g., "user profile" → `/api/users/profile`)
- **Medium**: Description is semantic, not a path match (e.g., "how many items in my cart" → `/api/cart`)
- **Hard**: Multiple plausible endpoints, description is ambiguous (e.g., "the main data feed" when there are 5 feed endpoints)
- **Extreme**: Vague description requiring inference (e.g., "the thing that loads when you first open the app")
- Include `expectedBodyPattern` for GraphQL tests to verify operationName matching

## Unit Tests

Beyond the eval suite, the backend has unit tests for individual services:

```bash
# Run all backend tests
cd backend
npx jest

# Run specific test file
npx jest har-parser.service.spec.ts
```

### Coverage Areas

| Service | What's tested |
|---------|--------------|
| `HarParserService` | HAR parsing, each filter gate, dedup logic, path parameterization, summary format |
| `HarToCurlService` | Curl generation, shell quoting, header filtering, method inference, body handling |
| `AnalysisService` | Pipeline orchestration, error handling, result assembly |

## Quality Metrics

| Metric | Current Value | Target |
|--------|--------------|--------|
| Overall pass rate | 98.3% | >95% |
| Easy pass rate | 100% | 100% |
| Medium pass rate | 100% | >95% |
| Hard pass rate | 95.8% | >90% |
| Extreme pass rate | 100% | >85% |
| Avg confidence (all) | >90% | >85% |

## Known Limitations

- **GraphQL body matching edge cases**: When multiple GraphQL operations have very similar names (e.g., `GetUserProfile` vs `GetUserPreferences`), the LLM may occasionally pick the wrong one if the description is ambiguous
- **Non-deterministic**: Results can vary slightly between runs due to LLM temperature (0.1, not 0). A test that passes 99% of the time may occasionally fail
- **API dependency**: Eval suite requires a live OpenAI API key and network access — cannot run in fully offline CI
- **Fixture staleness**: Synthetic fixtures may not capture all edge cases found in real-world HAR files
- **Cost**: Full eval run makes 63 LLM API calls, costing approximately $0.05-0.10
