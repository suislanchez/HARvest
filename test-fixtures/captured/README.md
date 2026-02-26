# Captured HAR Files

Real browser network traffic captured via Playwright. These files are **gitignored** — regenerate them with:

```bash
npm run capture:all
```

Or individually:

```bash
npm run capture:hars          # Original 6 targets
npm run capture:hars:extended # Extended 10 targets
```

## All 16 Captured HARs

### Original Captures (capture-real-hars.ts)

| File | Source | Size | Entries | API Pattern |
|------|--------|------|---------|-------------|
| `open-meteo-weather.har` | open-meteo.com | 1.9 MB | 67 | Weather forecast REST |
| `usgs-earthquakes.har` | earthquake.usgs.gov | 3.6 MB | 26 | GeoJSON earthquake data |
| `pokeapi-pokemon.har` | pokeapi.co | 6.9 MB | 193 | Pokemon REST API |
| `hackernews-firebase.har` | news.ycombinator.com | 72 KB | 6 | Firebase server-rendered |
| `dog-ceo-random.har` | dog.ceo | 4.3 MB | 87 | Random image REST |
| `jsonplaceholder-todos.har` | jsonplaceholder.typicode.com | 1.5 MB | 17 | REST CRUD |

### Extended Captures (capture-extended-hars.ts)

| File | Source | Size | Entries | API Pattern |
|------|--------|------|---------|-------------|
| `github-trending.har` | github.com/trending | 7.1 MB | 156 | REST + pagination |
| `wikipedia-search.har` | en.wikipedia.org | 2.0 MB | 37 | MediaWiki opensearch |
| `countries-graphql.har` | countries.trevorblades.com | 1.7 MB | 5 | **GraphQL** POST queries |
| `openlibrary-search.har` | openlibrary.org | 2.4 MB | 104 | REST search + facets |
| `coingecko-prices.har` | coingecko.com | 12 MB | 281 | REST + real-time polling |
| `nasa-apod.har` | api.nasa.gov | 708 KB | 9 | REST with API key |
| `httpbin-methods.har` | httpbin.org | 2.3 MB | 16 | **POST/PUT/PATCH/DELETE** |
| `npm-registry.har` | npmjs.com | 7.4 MB | 19 | CouchDB-style REST |
| `catfacts-api.har` | catfact.ninja | 1.9 MB | 11 | Simple REST |
| `restcountries.har` | restcountries.com | 200 KB | 9 | REST with field filters |

**Total: ~54 MB, 1,043 entries across 16 files**

## Used By

- **Playwright live tests** (`e2e/analysis-live.spec.ts`) — uploads these through the real browser UI
- **Jest E2E tests** (`backend/src/modules/analysis/e2e-*.spec.ts`) — feeds them through the backend pipeline
- **Stress tests** — concurrent upload, large file, and consistency checks
