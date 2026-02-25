# Complete Test Suite Overview

> Every test in the project — what it does, what it hits, what passes.

---

## Summary at a Glance

| Suite | File | Tests | Mocked? | Status |
|---|---|---|---|---|
| HAR Parser Unit | `har-parser.service.spec.ts` | 48 | Yes | 48/48 pass |
| Curl Generation Unit | `har-to-curl.service.spec.ts` | 35 | Yes | 35/35 pass |
| Analysis Service Unit | `analysis.service.spec.ts` | 8 | Yes | 8/8 pass |
| Controller Integration | `analysis.controller.spec.ts` | 6 | Yes | 6/6 pass |
| OpenAI Service Unit | `openai.service.spec.ts` | 17 | Yes | 17/17 pass |
| SSRF / Security | `proxy-ssrf.spec.ts` | 51 | Yes | 51/51 pass |
| Performance / Stress | `performance.spec.ts` | 4 | Yes | 4/4 pass |
| NestJS E2E | `app.e2e-spec.ts` | 3 | OpenAI mocked | 3/3 pass |
| **Eval (63 scenarios)** | `eval.spec.ts` | **63** | **Real OpenAI** | **~98% pass** |
| **Real-World Eval** | `eval-real-world.spec.ts` | **5** | **Real OpenAI + Real APIs** | **5/5 pass** |
| **E2E Live APIs** | `e2e-live.spec.ts` | **33** | **Real OpenAI + Real APIs** | **32/33 pass (1 skipped)** |
| **Total** | **11 files** | **~273** | | |

---

## 1. Unit Tests (189 tests, all mocked, all passing)

### HAR Parser — 48 tests
**File:** `backend/src/modules/analysis/har-parser.service.spec.ts`

**parseHar()**
- Parses valid JSON HAR files
- Rejects invalid JSON with BadRequestException
- Validates log.entries is present
- Accepts empty entries array

**filterApiRequests() — 30 tests**
Verifies the 7-layer noise filter:

| Filter | What It Removes | Tests |
|---|---|---|
| Static extensions | `.js`, `.css`, `.png`, `.woff2`, `.svg`, `.map` | 6 |
| Tracking domains | google-analytics, facebook, googletagmanager, hotjar | 4 |
| MIME types | `text/html`, `application/javascript`, `image/*`, `font/*`, `audio/*`, `video/*`, `application/wasm` | 8 |
| HTTP status | Status 0 (failed), OPTIONS preflight, 301/302/303/307/308 redirects | 6 |
| Data URIs | `data:image/gif;base64,...` | 1 |
| Invalid URLs | Empty strings, malformed | 2 |
| Conservative keeps | Unknown content types, 4xx/5xx errors, octet-stream | 3 |

**summarizeEntries()** — Index numbering, method/URL extraction, `[AUTH]` detection, body preview, truncation

**generateLlmSummary()** — Hostname grouping, auth type display, dedup with `×N`, GraphQL operationName differentiation, UUID parameterization, size formatting

**parameterizePath()** — Numeric IDs → `{id}`, UUIDs → `{id}`, mixed segments, preserves non-ID segments

---

### Curl Generation — 35 tests
**File:** `backend/src/modules/analysis/har-to-curl.service.spec.ts`

**generateCurl()**
| Test | What's Verified |
|---|---|
| Basic GET | No `-X` flag needed |
| POST with body | `--data-raw` used, curl infers POST |
| PUT/PATCH/DELETE | `-X METHOD` flag included |
| Header filtering | Strips `Sec-*`, `:authority`, `Host`, `Connection` |
| Cookie handling | Uses `-b` flag instead of `-H Cookie:` |
| Shell quoting | O'Brien → `O'\''Brien` (single quote escape) |
| `--compressed` | Always appended |
| `@` in body | `--data-raw` prevents file interpretation |

**parseCurlToRequest()** — Roundtrip parsing: URL extraction, method, headers, body, cookies via `-b`, line continuations

**Roundtrip tests** — generate → parse → verify identical

---

### Analysis Service — 8 tests
**File:** `backend/src/modules/analysis/analysis.service.spec.ts`

- Full pipeline produces curl + metadata
- Error when all entries filtered
- `allRequests` includes ALL entries (not just filtered)
- Correct LLM summary passed to OpenAI
- Entry time preservation / default to 0
- Charset stripping from contentType

---

### Controller — 6 tests
**File:** `backend/src/modules/analysis/analysis.controller.spec.ts`

- `POST /api/analyze` with valid HAR → 201 with full response shape
- No file → 400
- Short description (< 5 chars) → 400
- `.txt` file → 400
- Response body type verification

---

### OpenAI Service — 17 tests
**File:** `backend/src/modules/openai/openai.service.spec.ts`

- Parse well-formed topMatches
- Handle flat response (no array)
- Throw on empty/invalid JSON
- Filter out-of-range indices
- Coerce string indices to numbers
- Handle NaN confidence → 0
- Default to gpt-4o-mini
- Propagate rate limit + network errors

---

### SSRF / Security — 51 tests
**File:** `backend/src/modules/analysis/proxy-ssrf.spec.ts`

| Category | Blocked | Tests |
|---|---|---|
| Localhost | `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0` | 6 |
| Private IPs | `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x` | 6 |
| Cloud metadata | `169.254.169.254`, `metadata.google.internal` | 2 |
| Link-local | `169.254.x.x` | 1 |
| Protocols | `ftp://`, `file://`, `gopher://` | 3 |
| IP obfuscation | Octal, hex, decimal, credential notation | 5 |
| IPv6 | `[::1]`, `[::]`, `[::ffff:127.0.0.1]`, mapped private IPs | 8 |
| Allowed | Public IPs, external URLs, 172.15/172.32 | 7 |
| Curl parsing | GET, POST, headers, cookies, continuations | 7 |
| Documented | DNS rebinding limitation | 1 |

---

### Performance — 4 tests
**File:** `backend/src/modules/analysis/performance.spec.ts`

- Filter 1,000 entries < 200ms
- LLM summary for 1,000 entries < 500ms
- 100KB response body with truncation < 100ms
- Parse 2,000-entry HAR < 500ms

---

### NestJS E2E — 3 tests
**File:** `backend/test/app.e2e-spec.ts`

- `POST /api/analyze` valid HAR → 201 with curl
- Invalid JSON → 400
- Unknown route → 404

---

## 2. Eval Suite — 63 tests (Real OpenAI, Synthetic HAR Fixtures)

**File:** `backend/src/modules/analysis/eval.spec.ts`

Uses 10 hand-crafted HAR fixtures in `test-fixtures/` that simulate real-world websites. Real OpenAI API calls (gpt-4o-mini). ~98% pass rate.

### By Difficulty

| Difficulty | Tests | Pass Rate |
|---|---|---|
| Easy | 5 | 100% |
| Medium | 21 | 100% |
| Hard | 25 | ~96% |
| Extreme | 12 | ~92% |

### All 63 Test Cases

#### Basic (3 tests) — `simple.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 1 | The weather forecast API | `/v3/wx/forecast` | Easy |
| 2 | The joke API | `joke-api.appspot.com` | Easy |
| 3 | GraphQL weather alerts query | `graphql` + body: `GetWeatherAlerts` | Easy |

#### Recipe App (3 tests) — `recipe-search.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 4 | The recipe search API | `/v2/search` | Easy |
| 5 | Recipe detail endpoint | `/v2/recipes/` | Easy |
| 6 | Endpoint that returns food categories | `/v2/categories` | Medium |

#### E-commerce (6 tests) — `ecommerce.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 7 | Shopping cart API | `/v1/cart` | Easy |
| 8 | Checkout or order creation endpoint | `/v1/orders` | Medium |
| 9 | Stripe payment intent | `payment_intents` | Medium |
| 10 | Listing products by category | `/v1/products?` | Medium |
| 11 | Individual product detail page data | `/v1/products/8827` | Medium |
| 12 | Token refresh endpoint | `/v1/auth/refresh` | Hard |

#### GraphQL (5 tests) — `graphql-app.har`
| # | Description | Expected URL + Body | Difficulty |
|---|---|---|---|
| 13 | User profile query | `graphql` + `GetUserProfile` | Medium |
| 14 | News feed or timeline | `graphql` + `GetFeed` | Medium |
| 15 | Create post mutation | `graphql` + `CreatePost` | Medium |
| 16 | Follower list query | `graphql` + `GetFollowers` | Hard |
| 17 | Notification data | `graphql` + `GetNotifications` | Hard |

#### Multi-API Noisy (4 tests) — `multi-api-noisy.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 18 | Joke API | `jokeapi` | Medium |
| 19 | Current weather data for a city | `/data/2.5/weather` | Medium |
| 20 | Email newsletter subscription | `/newsletter/subscribe` | Medium |
| 21 | 5-day forecast, not current conditions | `/data/2.5/forecast` | Hard |

#### SPA Dashboard (8 tests) — `spa-dashboard.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 22 | CPU usage metrics time series | `metric=cpu` | Hard |
| 23 | Active critical alerts | `/alerts` | Medium |
| 24 | Dashboard configuration or layout | `/dashboards/d_` | Hard |
| 25 | Add new widget to dashboard | `/widgets` + body: `timeseries` | Hard |
| 26 | Current user profile endpoint | `/users/me` | Medium |
| 27 | Search for metrics | `/search` + body: `error rate` | Hard |
| 28 | Service map GraphQL query | `graphql` + `GetServiceMap` | Extreme |
| 29 | List of third-party integrations | `/integrations` | Hard |

#### Streaming Platform (7 tests) — `streaming-platform.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 30 | Search for TV shows or movies | `/catalog/search` | Medium |
| 31 | Title details including cast and synopsis | `/catalog/titles/tt_` | Medium |
| 32 | Episode list for a season | `/episodes` | Medium |
| 33 | Start video playback, get streaming URL | `/playback/start` + body: `titleId` | Hard |
| 34 | Add to watchlist | `/watchlist` + body: `add` | Hard |
| 35 | Personalized content recommendations | `/recommendations` | Medium |
| 36 | Video manifest for adaptive streaming | `.mpd` | Extreme |

#### Fintech Banking (7 tests) — `fintech-banking.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 37 | List of bank accounts | `/accounts` | Medium |
| 38 | Transaction history | `/transactions` | Medium |
| 39 | Money transfer or send money | `/transfers` + body: `fromAccount` | Hard |
| 40 | Check account balance | `/balance` | Hard |
| 41 | Schedule recurring bill payment | `/payments/schedule` + body: `recurring` | Hard |
| 42 | Freeze or lock a credit card | `/freeze` + body: `lost` | Extreme |
| 43 | Saved payees or beneficiaries list | `/payees` | Hard |

#### Travel Booking (7 tests) — `travel-booking.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 44 | Flight search SFO to Tokyo | `flights.example.com` + body: `SFO` | Medium |
| 45 | Hotel search in a city | `hotels.example.com` + body: `Tokyo` | Medium |
| 46 | Room types and pricing for a hotel | `/rooms` | Hard |
| 47 | Final booking or reservation creation | `/reservations` + body: `flightId` | Hard |
| 48 | Currency exchange rates USD to JPY | `exchangerate` | Hard |
| 49 | Google Maps geocoding request | `maps.googleapis.com` | Medium |
| 50 | Past trips or bookings | `/user/trips` | Hard |

#### Real-time Collaboration (7 tests) — `realtime-collab.har`
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 51 | List of documents in a workspace | `/documents` | Medium |
| 52 | Collaborative editing (insert text) | `/changes` + body: `insert` | Extreme |
| 53 | Create a new document | `/documents` + body: `Meeting Notes` | Hard |
| 54 | Comments on a document | `/comments` | Medium |
| 55 | Export document as PDF | `/export` + body: `pdf` | Hard |
| 56 | Search for users to @mention | `/users/search` | Hard |
| 57 | Version history of a document | `/history` | Hard |

#### Vague / Natural Language (6 tests) — various fixtures
| # | Description | Expected URL | Difficulty |
|---|---|---|---|
| 58 | "The API call that happens when you click buy" | `/v1/orders` | Extreme |
| 59 | "What loads when you press play" | `/playback/start` | Extreme |
| 60 | "Sending money to someone" | `/transfers` | Extreme |
| 61 | "Main search that kicks off when you look for flights" | `flights.example.com` | Extreme |
| 62 | "Typing in the editor" | `/changes` | Extreme |
| 63 | "Main data that populates the chart" | `/metrics/timeseries` | Extreme |

---

## 3. Real-World Eval — 5 tests (Real OpenAI + Real HAR files + Curl Execution)

**File:** `backend/src/modules/analysis/eval-real-world.spec.ts`

These use **actual HAR captures from real websites** — the original take-home assignment test cases.

| # | Test | HAR File | Size | Prompt | Expected URL | Method | Execution |
|---|---|---|---|---|---|---|---|
| 1 | **SFGate Weather** | `sfgate.har` | 5.0 MB | "Return the API that fetches the weather of San Francisco" | `forecast7.com/en/37d77n122d42/san-francisco/` | GET | Curl executed → 200, real forecast data |
| 2 | **RecipeScal** | `recipescal.har` | 1.7 MB | "Reverse engineer the API that gives me recipes for a given portion and calorie count" | `recipescal.com/api/bookapi` | POST | Body contains `newData` |
| 3 | **JokeAPI** | `jokes-real.har` | 1.6 MB | "Give me a curl command to get 5 jokes via API" | `v2.jokeapi.dev/joke/Any?amount=5` | GET | Curl executed → 200, 5 jokes returned |
| 4 | **JokeAPI Large** | `jokes-large.har` | 87 MB | Same as above | Same | GET | Performance test with huge HAR |
| 5 | **SFGate Execution** | `sfgate.har` | 5.0 MB | Same as #1 | Same | GET | Actually fetches live weather from forecast7.com |

**What makes these special:**
- HAR files captured from real browser sessions (not synthetic)
- `sfgate.har` has hundreds of entries (ads, trackers, CDN assets) — the tool must find the weather API needle in the haystack
- `jokes-large.har` at 87MB tests the pipeline won't choke on massive files
- Curl execution tests prove the generated command actually works against the live API

---

## 4. E2E Live API Tests — 33 tests (Real OpenAI + Real Public APIs)

**File:** `backend/src/modules/analysis/e2e-live.spec.ts`

Full pipeline with zero mocks: build HAR → parse → filter → LLM match → curl generation → **actual HTTP execution against live APIs**.

### Suite 1: JSONPlaceholder (REST CRUD) — 6 tests

| # | Test | Endpoint | Method | What's Verified |
|---|---|---|---|---|
| 1 | GET single post | `/posts/1` | GET | Response has `id`, `title`, `body`, `userId` |
| 2 | GET with query params | `/posts?userId=1` | GET | Array of posts, all `userId === 1` |
| 3 | POST create | `/posts` | POST | `--data-raw` body sent, 201 returned, body has `id` |
| 4 | PUT update | `/posts/1` | PUT | `-X PUT` in curl, body updated |
| 5 | DELETE | `/posts/1` | DELETE | `-X DELETE` in curl, 200 returned |
| 6 | Nested resource | `/posts/1/comments` | GET | Array with `postId === 1`, has `email` field |

### Suite 2: httpbin (Curl Fidelity) — 8 tests

| # | Test | Endpoint | What's Verified |
|---|---|---|---|
| 7 | Header echo | `/headers` | Custom `X-Custom-Test` header preserved in curl |
| 8 | POST /anything echo | `/anything` | Method is POST, JSON body echoed back identically |
| 9 | Query params | `/get?foo=bar&baz=qux` | `args` echoed: `{foo: "bar", baz: "qux"}` |
| 10 | Status code | `/status/201` | Response status is 201 |
| 11 | Gzip | `/gzip` | `--compressed` flag in curl, `gzipped: true` in body |
| 12 | XML response | `/xml` | Body contains `<?xml` |
| 13 | Bearer auth | `/bearer` | `Authorization: Bearer test-token-abc123` preserved, `authenticated: true` |
| 14 | Basic auth | `/basic-auth/testuser/testpass` | Base64 credentials preserved, `user: "testuser"` |

### Suite 3: DummyJSON (Pagination & Auth) — 3 tests

| # | Test | Endpoint | What's Verified |
|---|---|---|---|
| 15 | Paginated list | `/products?limit=5&skip=10` | `skip: 10`, `limit: 5`, has `total` field |
| 16 | POST create product | `/products/add` | POST method, `title: "BMW Pencil"`, 201 status |
| 17 | Login auth | `/auth/login` | POST with `emilys` credentials, returns `accessToken` |

### Suite 4: GraphQL (Dedup & Execution) — 3 tests + 1 skipped

| # | Test | API | What's Verified |
|---|---|---|---|
| 18 | Posts query | GraphQLZero | Body contains `posts`, returns post data with `id` + `title` |
| 19 | ~~Users query~~ | ~~GraphQLZero~~ | **Skipped** — dedup collapses same-URL queries (known limitation) |
| 20 | All countries | Countries API | Returns 250+ countries with `code`, `name`, `capital` |
| 21 | Single country (US) | Countries API | `country.name === "United States"` |

### Suite 5: FakeStoreAPI (E-commerce) — 3 tests

| # | Test | Endpoint | What's Verified |
|---|---|---|---|
| 22 | Product categories | `/products/categories` | Array contains `"electronics"` |
| 23 | Category filter | `/products/category/electronics` | All products have `category: "electronics"` |
| 24 | Sort + limit | `/products?limit=5&sort=desc` | Array length ≤ 5 |

### Suite 6: Mixed APIs (Noisy HAR) — 4 tests

A HAR with 4 different APIs + double noise entries (12 noise, 4 real).

| # | Test | API | What's Verified |
|---|---|---|---|
| 25 | Todo item | JSONPlaceholder `/todos/1` | Has `completed`, `title` fields |
| 26 | UUID generator | httpbin `/uuid` | UUID matches regex pattern |
| 27 | Product categories | FakeStoreAPI `/products/categories` | Contains `"electronics"` |
| 28 | Random quote | DummyJSON `/quotes/random` | Has `quote` and `author` fields |

### Suite 7: Record & Replay — 5 tests

First run: hits live API, saves response to `__recordings__/`. Subsequent runs: replays from file (7-day TTL).

| # | Test | API | What's Verified |
|---|---|---|---|
| 29 | JSONPlaceholder GET | `/posts/1` | Live body matches recording (`id`, `title`) |
| 30 | httpbin POST | `/anything` | Echoed JSON matches, method is POST |
| 31 | Countries GraphQL | `countries.trevorblades.com` | `country.name === "United States"` |
| 32 | restful-api.dev POST | `/objects` | Returns `id` and `name: "Replay Test Phone"` |
| 33 | DummyJSON login | `/auth/login` | Returns `accessToken` and `username: "emilys"` |

---

## 5. Test Fixtures

### Real-World HAR Captures

| File | Source | Size | Entries | What's Inside |
|---|---|---|---|---|
| `sfgate.har` | sfgate.com weather page | 5.0 MB | Hundreds | Ads, trackers, CDN assets, **forecast7.com weather API** |
| `recipescal.har` | recipescal.com | 1.7 MB | Many | Static assets, **POST /api/bookapi recipe API** |
| `jokes-real.har` | v2.jokeapi.dev | 1.6 MB | Many | API calls, **GET /joke/Any?amount=5** |
| `jokes-large.har` | Same, stress test | 87 MB | Thousands | Performance stress test version |

### Synthetic HAR Fixtures

| File | Simulates | Size | API Entries | Key Endpoints |
|---|---|---|---|---|
| `simple.har` | Weather dashboard | 16 KB | 3 | Weather forecast, joke API, GraphQL weather alerts |
| `recipe-search.har` | Recipe app | 17 KB | 5-8 | `/v2/search`, `/v2/recipes/`, `/v2/categories` |
| `ecommerce.har` | E-commerce site | 22 KB | 10-15 | Cart, orders, Stripe, products, auth refresh |
| `graphql-app.har` | Social media | 30 KB | 4-6 | Same-URL GraphQL: profile, feed, posts, followers, notifications |
| `multi-api-noisy.har` | Multi-API page | 30 KB | 8-12 | JokeAPI, OpenWeatherMap, newsletter + heavy noise |
| `spa-dashboard.har` | Monitoring dashboard | 69 KB | 15-20 | Metrics, alerts, widgets, integrations, GraphQL service map |
| `streaming-platform.har` | Video streaming | 46 KB | 12-18 | Search, titles, episodes, playback, watchlist, recommendations |
| `fintech-banking.har` | Banking app | 43 KB | 6-10 | Accounts, transactions, transfers, payments, payees |
| `travel-booking.har` | Travel booking | 54 KB | 15-20 | Flights, hotels, rooms, reservations, exchange rates, maps |
| `realtime-collab.har` | Collaborative editor | 41 KB | 10-15 | Documents, changes, comments, export, mentions, history |

---

## 6. APIs Hit By Tests

### Real APIs (live HTTP requests in tests)

| API | Base URL | Used In | What's Tested |
|---|---|---|---|
| JSONPlaceholder | `jsonplaceholder.typicode.com` | e2e-live | GET, POST, PUT, DELETE, nested, query params |
| httpbin | `httpbin.org` | e2e-live | Header echo, body echo, auth, gzip, XML, status codes |
| DummyJSON | `dummyjson.com` | e2e-live | Pagination, product create, auth login |
| GraphQLZero | `graphqlzero.almansi.me` | e2e-live | GraphQL query execution |
| Countries API | `countries.trevorblades.com` | e2e-live | GraphQL country queries |
| FakeStoreAPI | `fakestoreapi.com` | e2e-live | Categories, filtering, sorting |
| restful-api.dev | `api.restful-api.dev` | e2e-live (record/replay) | Object creation |
| JokeAPI | `v2.jokeapi.dev` | eval-real-world | Joke retrieval, execution verification |
| forecast7.com | `forecast7.com` | eval-real-world | Weather forecast, execution verification |
| OpenAI | `api.openai.com` | eval, eval-real-world, e2e-live | LLM matching (gpt-4o-mini) |

### Simulated APIs (in synthetic HAR fixtures, not hit live)

| API | Fixtures | Pattern |
|---|---|---|
| Weather API | simple.har | `/v3/wx/forecast` |
| Recipe API | recipe-search.har | `/v2/search`, `/v2/recipes/` |
| E-commerce | ecommerce.har | `/v1/cart`, `/v1/orders`, `/v1/products` |
| Stripe | ecommerce.har | `payment_intents` |
| OpenWeatherMap | multi-api-noisy.har | `/data/2.5/weather`, `/data/2.5/forecast` |
| Monitoring | spa-dashboard.har | `/metrics/timeseries`, `/alerts` |
| Streaming | streaming-platform.har | `/catalog/search`, `/playback/start` |
| Banking | fintech-banking.har | `/accounts`, `/transfers`, `/payments` |
| Travel | travel-booking.har | `flights.example.com`, `hotels.example.com` |
| Collaboration | realtime-collab.har | `/documents`, `/changes`, `/comments` |

---

## 7. Running the Tests

```bash
cd backend

# All unit tests (189 tests, ~1s, no API key needed)
npx jest har-parser har-to-curl analysis.service analysis.controller openai.service proxy-ssrf performance --verbose

# NestJS E2E (3 tests, mocked OpenAI)
npx jest app.e2e-spec --verbose

# Eval suite — 63 scenarios (requires OPENAI_API_KEY, ~2min)
npx jest eval.spec --testTimeout=120000 --verbose

# Real-world eval — sfgate, recipescal, jokeapi (requires OPENAI_API_KEY, ~30s)
npx jest eval-real-world --testTimeout=120000 --verbose

# E2E live API tests — 33 tests hitting real APIs (requires OPENAI_API_KEY, ~45s)
npx jest e2e-live --testTimeout=60000 --verbose

# Everything at once
npx jest --testTimeout=120000 --verbose
```

---

## 8. Known Limitations

1. **GraphQL same-URL dedup** — When two GraphQL queries hit the same URL with the same method, the dedup logic collapses them into one summary line with `(×2)`, hiding the second query body from the LLM. The eval suite handles this via HAR fixtures that include `operationName`, but the e2e-live test skips this case.

2. **ReqRes.in blocked** — ReqRes is behind Cloudflare bot protection as of Feb 2026. E2E tests use DummyJSON, FakeStoreAPI, and restful-api.dev as alternatives.

3. **LLM non-determinism** — Tests with very similar endpoints (e.g., `/posts` vs `/posts?userId=1` from the same host) can occasionally fail when gpt-4o-mini picks the wrong one. These tests use isolated HAR fixtures to reduce ambiguity.

4. **External API dependency** — E2E live tests depend on public APIs being available. Record-and-replay mitigates this with 7-day cached recordings.
