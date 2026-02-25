# E2E Public API Testing Research

> Research for real end-to-end tests that hit live public APIs, run the full HAR → LLM → curl → execution pipeline, and verify actual responses.

## Goals

1. **Curl execution smoke tests** — generate HAR fixtures from known public APIs, run the full pipeline, execute the generated curl via the proxy route, and assert the response.
2. **Record-and-replay tests** — capture real API responses once, then replay them in tests (no live API dependency, but proves the curl was valid at recording time).

---

## 1. HTTP Echo / Inspection APIs

### 1A. httpbin.org

| Field | Value |
|---|---|
| **Base URL** | `https://httpbin.org` |
| **Reliability** | Very high; running since ~2013; self-hostable via Docker (`kennethreitz/httpbin`) |
| **Rate Limits** | None documented |
| **Auth Required** | None (has auth-testing endpoints) |

#### Key Endpoints

| Category | Endpoint | Method | What It Tests |
|---|---|---|---|
| Echo | `/anything` | ANY | Echoes headers, body, args, method — **gold standard for curl fidelity** |
| Methods | `/get`, `/post`, `/put`, `/patch`, `/delete` | Respective | Basic HTTP method handling |
| Auth | `/basic-auth/{user}/{passwd}` | GET | HTTP Basic Auth header |
| Auth | `/bearer` | GET | Bearer token (`Authorization: Bearer <token>`) |
| Headers | `/headers` | GET | Returns all request headers |
| Status | `/status/{code}` | ANY | Arbitrary status codes |
| Content Types | `/json`, `/xml`, `/html` | GET | Different response content types |
| Compression | `/gzip`, `/deflate`, `/brotli` | GET | `--compressed` flag verification |
| Cookies | `/cookies`, `/cookies/set/{name}/{value}` | GET | Cookie handling via `-b` flag |
| Redirects | `/redirect/{n}`, `/redirect-to?url=...` | GET | Redirect chain handling |
| Caching | `/cache`, `/cache/{seconds}`, `/etag/{etag}` | GET | Cache-Control, ETag, If-Modified-Since |
| Custom Headers | `/response-headers?key=value` | GET/POST | CORS, caching headers in response |
| Binary | `/image/jpeg`, `/image/png`, `/image/svg` | GET | Binary content types |
| Streaming | `/stream/{n}`, `/stream-bytes/{n}` | GET | Chunked encoding |
| Delay | `/delay/{seconds}` | ANY | Timeout testing (max 10s) |
| Dynamic | `/uuid`, `/bytes/{n}`, `/base64/{value}` | GET | Random/dynamic data |

**Key Insight**: The `/anything` endpoint echoes back the exact request, so you can assert that the curl command generated from a HAR entry produces the identical request (method, headers, body, query params).

---

### 1B. postman-echo.com

| Field | Value |
|---|---|
| **Base URL** | `https://postman-echo.com` |
| **Reliability** | Backed by Postman Inc; high uptime |
| **Rate Limits** | Generous |

| Endpoint | Method | What It Tests |
|---|---|---|
| `/get` | GET | Echo query params |
| `/post` | POST | Echo body + headers |
| `/put`, `/patch`, `/delete` | Respective | Full CRUD echo |
| `/basic-auth` | GET | Basic authentication |
| `/oauth1` | GET | OAuth 1.0 signature |
| `/headers` | GET | Request header inspection |
| `/cookies/set?foo=bar` | GET | Cookie setting |

---

## 2. Fake REST APIs (CRUD, Pagination, Relationships)

### 2A. jsonplaceholder.typicode.com

| Field | Value |
|---|---|
| **Base URL** | `https://jsonplaceholder.typicode.com` |
| **Reliability** | Extremely stable; one of the most well-known test APIs |
| **Rate Limits** | None |
| **CORS** | Full support |

#### Endpoints

| Resource | List | Single | Create | Update | Delete |
|---|---|---|---|---|---|
| Posts | `GET /posts` | `GET /posts/1` | `POST /posts` | `PUT /posts/1` | `DELETE /posts/1` |
| Comments | `GET /comments` | `GET /comments/1` | `POST /comments` | `PUT /comments/1` | `DELETE /comments/1` |
| Users | `GET /users` | `GET /users/1` | — | — | — |
| Todos | `GET /todos` | `GET /todos/1` | — | — | — |

**Special patterns**:
- Nested: `GET /posts/1/comments`
- Filtering: `GET /posts?userId=1`
- Pagination: `GET /posts?_page=1&_limit=10`

**POST body**: `{"title": "foo", "body": "bar", "userId": 1}` → returns `201` with `id`

---

### 2B. reqres.in

| Field | Value |
|---|---|
| **Base URL** | `https://reqres.in` |
| **Reliability** | High; well-maintained |

| Endpoint | Method | Response | What It Tests |
|---|---|---|---|
| `/api/users?page=2` | GET | Paginated list with `total`, `total_pages` | Pagination metadata |
| `/api/users/2` | GET | Single user | Simple GET |
| `/api/users` | POST `{"name":"morpheus","job":"leader"}` | `201` with id + createdAt | POST JSON body |
| `/api/users/2` | PUT | `200` with updatedAt | PUT |
| `/api/users/2` | DELETE | `204` (no content) | DELETE |
| `/api/register` | POST `{"email":"eve.holt@reqres.in","password":"pistol"}` | `200` with token | Auth flow |
| `/api/login` | POST `{"email":"eve.holt@reqres.in","password":"cityslicka"}` | `200` with token | Login |
| `/api/users/23` | GET | `404` | Error responses |

---

### 2C. dummyjson.com

| Field | Value |
|---|---|
| **Base URL** | `https://dummyjson.com` |
| **Reliability** | High; actively maintained |
| **Auth** | Bearer token via `POST /auth/login` |

| Feature | Endpoint | Details |
|---|---|---|
| **Login** | `POST /auth/login` with `{"username":"emilys","password":"emilyspass"}` | Returns `accessToken` + `refreshToken` |
| **Token Refresh** | `POST /auth/refresh` with `{"refreshToken":"...","expiresInMins":1}` | Refresh token flow |
| **Authenticated** | Any + `Authorization: Bearer <token>` | Bearer auth in HARs |
| **Products** | `/products`, `/products/1`, `/products/search?q=phone` | CRUD + search |
| **Pagination** | `/products?limit=10&skip=10` | Offset pagination |
| **Field selection** | `/products?select=title,price` | Sparse fieldsets |
| **Delay** | `/test?delay=1000` | Simulated latency |
| **Status codes** | `/http/200`, `/http/404`, `/http/500` | Status code testing |

---

### 2D. fakestoreapi.com

| Field | Value |
|---|---|
| **Base URL** | `https://fakestoreapi.com` |
| **Reliability** | Stable; widely used |

| Endpoint | Method | What It Tests |
|---|---|---|
| `/products` | GET | List products |
| `/products/1` | GET | Single product |
| `/products?limit=5&sort=desc` | GET | Query params: limit + sort |
| `/products/categories` | GET | Category list |
| `/products/category/electronics` | GET | Filter by path param |
| `/carts?startdate=2020-01-01&enddate=2020-12-31` | GET | Date-range query params |
| `/auth/login` | POST `{"username":"mor_2314","password":"83r5^_"}` | Auth token |

---

## 3. GraphQL APIs

### 3A. GraphQLZero (mirrors JSONPlaceholder)

| Field | Value |
|---|---|
| **Endpoint** | `POST https://graphqlzero.almansi.me/api` |
| **Auth** | None |
| **Reliability** | Medium; open source, self-hostable |

```graphql
query GetPosts { posts { data { id title } } }
query GetUsers { users { data { id name email } } }
mutation CreatePost { createPost(input: { title: "Test", body: "Body" }) { id } }
```

**Why ideal for dedup**: All requests go to the same URL as POST — the tool must differentiate by query body / operationName.

---

### 3B. Countries API (Trevor Blades)

| Field | Value |
|---|---|
| **Endpoint** | `POST https://countries.trevorblades.com/` |
| **Auth** | None |
| **Reliability** | Very stable |

```graphql
query { countries { code name capital currency } }
query { country(code: "US") { name capital languages { name } } }
query { continents { code name } }
```

---

### 3C. Rick and Morty API

| Field | Value |
|---|---|
| **GraphQL** | `POST https://rickandmortyapi.com/graphql` |
| **REST** | `https://rickandmortyapi.com/api/character`, etc. |
| **Auth** | None |

```graphql
query { characters(page: 1) { info { count pages } results { id name status } } }
query { character(id: 1) { name status species } }
```

Has both REST and GraphQL — tests both from same API. Cursor-based pagination.

---

## 4. Auth Pattern Coverage Matrix

| Pattern | API | How |
|---|---|---|
| No auth | JSONPlaceholder, httpbin `/get` | Baseline |
| HTTP Basic | httpbin `/basic-auth/user/passwd` | `Authorization: Basic <base64>` |
| Bearer Token | httpbin `/bearer`, DummyJSON, ReqRes | `Authorization: Bearer <token>` |
| Login → Token → Use | DummyJSON (`POST /auth/login` then use token) | Multi-request auth flow |
| Token Refresh | DummyJSON (`POST /auth/refresh`) | Refresh token pattern |

---

## 5. Content Type Coverage

| Content Type | API | Endpoint |
|---|---|---|
| `application/json` | All APIs | Default |
| `application/xml` | httpbin | `/xml` |
| `text/html` | httpbin | `/html` |
| `image/png` | httpbin | `/image/png` |
| `image/jpeg` | httpbin | `/image/jpeg` |
| `image/svg+xml` | httpbin | `/image/svg` |
| `application/gzip` | httpbin | `/gzip` |

---

## 6. Pagination Pattern Coverage

| Style | API | How |
|---|---|---|
| Page-based | JSONPlaceholder | `?_page=1&_limit=10` |
| Page-based with metadata | ReqRes | `?page=2` → `total`, `total_pages` |
| Offset-based | DummyJSON | `?limit=10&skip=20` |
| Limit + sort | FakeStoreAPI | `?limit=5&sort=desc` |
| Cursor/page (GraphQL) | Rick and Morty | `info { next prev count pages }` |

---

## 7. Recommended Minimal CI Test Matrix

22 test cases covering all edge cases:

| # | Test Case | API | Endpoint | Verifies |
|---|---|---|---|---|
| 1 | Simple GET | JSONPlaceholder | `GET /posts/1` | Basic fetch |
| 2 | GET + query params | JSONPlaceholder | `GET /posts?userId=1` | Query string preservation |
| 3 | POST JSON body | JSONPlaceholder | `POST /posts` | `--data-raw` body |
| 4 | PUT JSON body | JSONPlaceholder | `PUT /posts/1` | `-X PUT` + body |
| 5 | DELETE | JSONPlaceholder | `DELETE /posts/1` | `-X DELETE` |
| 6 | Nested resources | JSONPlaceholder | `GET /posts/1/comments` | Nested URL path |
| 7 | Header echo | httpbin | `GET /headers` | Header fidelity |
| 8 | Full request echo | httpbin | `POST /anything` | Complete curl fidelity |
| 9 | Basic Auth | httpbin | `GET /basic-auth/user/passwd` | Auth header |
| 10 | Bearer Auth | httpbin | `GET /bearer` | Bearer token |
| 11 | Status codes | httpbin | `GET /status/201` | Non-200 status handling |
| 12 | XML response | httpbin | `GET /xml` | Content type variety |
| 13 | Compressed | httpbin | `GET /gzip` | `--compressed` flag |
| 14 | Cookies | httpbin | `GET /cookies/set/testcookie/testvalue` | `-b` cookie flag |
| 15 | Redirect | httpbin | `GET /redirect/2` | Redirect following |
| 16 | Pagination | ReqRes | `GET /api/users?page=2` | Pagination params |
| 17 | Login flow | DummyJSON | `POST /auth/login` | Auth POST body |
| 18 | Auth + data | DummyJSON | `GET /auth/products` with Bearer | Token-based access |
| 19 | Error response | ReqRes | `GET /api/users/23` | 404 handling |
| 20 | GraphQL query | GraphQLZero | `POST /api` with query | GraphQL body |
| 21 | GraphQL dedup | Countries API | Two queries, same URL | operationName dedup |
| 22 | Binary response | httpbin | `GET /image/png` | Binary content |

---

## 8. CI Reliability Assessment

| API | Uptime | Self-Hostable | CI Risk |
|---|---|---|---|
| httpbin.org | High | Yes (Docker) | Low |
| jsonplaceholder.typicode.com | Very High | Yes (json-server) | Low |
| reqres.in | High | No | Low-Medium |
| dummyjson.com | High | Yes (open source) | Low |
| graphqlzero.almansi.me | Medium | Yes | Medium |
| countries.trevorblades.com | High | Yes | Low |
| rickandmortyapi.com | High | Yes | Low-Medium |
| postman-echo.com | High | No | Low |

**Recommendation**: Use httpbin + jsonplaceholder as primary (most stable). Tag live-API tests so they can be skipped in offline CI. Use record-and-replay for deterministic runs.

---

## 9. Test Architecture

### Smoke Tests (live API)
```
1. Build HAR fixture programmatically (known URL, headers, body)
2. Feed HAR through full pipeline (parse → filter → LLM match → curl gen)
3. Execute generated curl via proxy route
4. Assert: response status, content-type, body structure
```

### Record-and-Replay Tests
```
1. First run: hit live API, save response to __recordings__/
2. Subsequent runs: load recording, assert curl output matches
3. Periodically refresh recordings to catch API changes
```

### HAR Fixture Generation
```typescript
function makeRealHarEntry(url, method, headers, body, response) {
  // Creates a valid HAR entry from real API call data
  // Used to build test fixtures that mirror actual browser captures
}
```

---

## 10. Key Testing Insights

1. **httpbin `/anything`** is the single most valuable endpoint — it echoes back your exact request so you can diff the HAR entry against what the generated curl actually sends.

2. **GraphQL dedup** requires testing multiple queries to the same endpoint (GraphQLZero, Countries API) to ensure `operationName` differentiation works.

3. **Auth flows** (DummyJSON login → token → use) test multi-step HAR scenarios where the tool must identify the right request from a sequence.

4. **The proxy route** is the execution layer — tests should verify both the curl generation AND the actual HTTP execution through it.

5. **Record-and-replay** eliminates flakiness from API downtime while still proving the curl was valid at recording time.
