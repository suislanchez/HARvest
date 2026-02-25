# 2. Reverse Engineering Patterns - API Matching Strategy

## Signal Ranking (Most → Least Important)

| Priority | Signal | Weight | Example |
|----------|--------|--------|---------|
| 1 | URL path segments | Highest | `/weather`, `/jokes`, `/recipes/search` |
| 2 | Query parameters | High | `city=SF`, `amount=5`, `calories=500` |
| 3 | Request body content | High | `{"query":"chicken","diet":"vegan"}` |
| 4 | Response body structure | High | `{"temperature":65,"humidity":40}` |
| 5 | Hostname/subdomain | Medium-High | `api.weather.com`, `v2.jokeapi.dev` |
| 6 | Custom headers | Medium | `X-API-Key`, `Authorization: Bearer` |
| 7 | Response Content-Type | Filtering | `application/json` vs `text/html` |

## Request Prioritization Scoring

```
SCORING ALGORITHM:

+3  Response Content-Type is application/json or application/xml
+2  Hostname contains "api." or URL path contains "/api/"
+2  Has Authorization or X-API-Key header
+2  Method is POST/PUT/PATCH with JSON body
+1  Chrome _resourceType is "xhr" or "fetch"
+1  URL matches REST patterns (/v1/, /v2/)
-1  URL contains healthcheck, ping, config
-∞  EXCLUDE: static extension, tracking domain, text/html response, status 0
```

## Common API Patterns to Recognize

### REST APIs (most common)
```
GET  /api/v1/weather?city=SF           → JSON
POST /api/v1/recipes/search            → JSON body + JSON response
GET  /jokes/random?count=5             → JSON
GET  /users/12345                      → Resource by ID
GET  /products?page=2&limit=20         → Paginated list
```
Detection: Multiple endpoints under common prefix, standard HTTP methods, path = resource

### GraphQL (single endpoint, query in body)
```
POST /graphql
Content-Type: application/json
Body: {"query":"query GetWeather($city:String!){weather(city:$city){temp}}",
       "variables":{"city":"San Francisco"},
       "operationName":"GetWeather"}
```
Detection: URL always `/graphql` or `/gql`, always POST, body has `query` field.
**Key**: `operationName` is critical for matching since URL is identical for all queries.

### gRPC-Web
```
POST /package.ServiceName/MethodName
Content-Type: application/grpc-web+proto
```
Detection: Content-Type `application/grpc-web*`, URL path = `Package.Service/Method`

### Server-Sent Events
```
GET /api/stream/weather?city=SF
Accept: text/event-stream
```
Detection: `Accept: text/event-stream` header, response is `text/event-stream`

## The Three Test Cases

### Case 1: SFGate Weather
- **User query**: "Return the API that fetches the weather of San Francisco"
- **What to expect**: 100-300+ entries, 95% noise (ads, tracking, static assets)
- **The needle**: 1-2 XHR/fetch calls to a weather provider API
- **Likely domains**: `api.weather.gov`, `api.foreca.net`, `dataservice.accuweather.com`
- **Matching signals**: Path contains `weather`/`forecast`, query params have city or lat/lng near SF (37.77, -122.42), response JSON has `temperature`/`humidity`/`wind`
- **Challenge**: Finding 1 API call among 200+ tracking/ad requests

### Case 2: RecipeScal
- **User query**: "Reverse engineer the API for recipes by portion and calorie count"
- **What to expect**: 15-30 entries (simple Next.js site)
- **The needle**: POST or GET to a recipe API (likely Spoonacular)
- **Matching signals**: Path contains `recipe`/`search`, params have `calories`/`servings`/`diet`, response has recipe objects
- **Challenge**: Easier - fewer entries, clearer API patterns

### Case 3: JokeAPI
- **User query**: "Give me a curl command to get 5 jokes via API"
- **jokes.har (easy)**: ~1-3 entries, the joke API call is obvious
- **jokes.large.har (difficult)**: 50-200+ entries with noise, must find `v2.jokeapi.dev/joke/Any?amount=5`
- **Endpoint**: `GET https://v2.jokeapi.dev/joke/Any?amount=5`
- **Response**: `{"error":false,"amount":5,"jokes":[...]}`
- **Challenge (large)**: Identifying jokeapi.dev among many unrelated requests

## LLM Prompt Strategy

### The "Index Return" Approach (zero hallucination)

```
SYSTEM PROMPT:
You are an API analyst. Given a user's description and a numbered list of
HTTP requests from a HAR file, identify which request best matches.

USER PROMPT:
User wants: "{user_description}"

Requests:
1. GET /api/weather?city=SF → application/json 200
2. POST /api/auth/login → application/json 200
3. GET /static/bundle.js → application/javascript 200
4. GET /tracking/pixel → image/gif 200

Return ONLY the index number of the best match.

EXPECTED OUTPUT: 1
```

### Why this works:
- LLM returns just an index → you look up the full HAR entry → generate curl
- **Zero hallucination** risk on the curl command itself
- Minimal output tokens (~5-10)
- The LLM does what it's good at (semantic matching) and code does the rest (curl generation)

### For ambiguous cases, add confidence:
```json
{
  "match_index": 1,
  "confidence": 0.95,
  "reason": "URL path '/weather' and query param 'city=SF' match weather request"
}
```

## Pre-filtering Pipeline (Before LLM)

```
RAW HAR (200+ entries)
       │
       ▼
[1. Remove by extension]     .js .css .png .jpg .woff .svg .map
       │  (~60% removed)
       ▼
[2. Remove by domain]        google-analytics, doubleclick, facebook, etc.
       │  (~20% removed)
       ▼
[3. Remove by MIME type]     text/html, text/css, image/*, font/*
       │  (~10% removed)
       ▼
[4. Remove by method]        OPTIONS (CORS preflight)
       │  (~2% removed)
       ▼
[5. Remove by status]        0 (failed), 204, 301, 302
       │  (~3% removed)
       ▼
FILTERED (10-30 API candidates)
```

This deterministic pipeline reduces 200 entries to ~10-30 **before touching the LLM**.
