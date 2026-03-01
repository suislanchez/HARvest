/**
 * Public HAR Collection Builder
 *
 * Captures HAR files from diverse public APIs and websites,
 * saving them to public-captures/ for inclusion in the repo
 * as a ready-to-use collection for the auto-capture feature.
 *
 * Usage:
 *   npx playwright install chromium
 *   npx tsx scripts/capture-public-collection.ts
 */

import { chromium, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

const OUTPUT_DIR = path.join(__dirname, '..', 'public-captures');

interface CaptureTarget {
  name: string;
  filename: string;
  url: string;
  description: string;
  tags: string[];
  interact?: (page: Page) => Promise<void>;
  extraWait?: number;
}

const targets: CaptureTarget[] = [
  // ── REST APIs ──────────────────────────────────────────
  {
    name: 'JSONPlaceholder - Posts & Comments',
    filename: 'jsonplaceholder-posts.har',
    url: 'https://jsonplaceholder.typicode.com/',
    description: 'Classic REST API - posts, comments, users',
    tags: ['rest', 'json', 'crud'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://jsonplaceholder.typicode.com';
        await fetch(`${base}/posts`);
        await fetch(`${base}/posts/1`);
        await fetch(`${base}/posts/1/comments`);
        await fetch(`${base}/users`);
        await fetch(`${base}/posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'test', body: 'hello', userId: 1 }),
        });
      });
    },
    extraWait: 1000,
  },
  {
    name: 'Dog CEO - Random Dogs API',
    filename: 'dog-api.har',
    url: 'https://dog.ceo/dog-api/',
    description: 'Fun image API with breed filtering',
    tags: ['rest', 'images', 'public'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://dog.ceo/api';
        await fetch(`${base}/breeds/list/all`);
        await fetch(`${base}/breed/husky/images/random/3`);
        await fetch(`${base}/breed/labrador/images/random`);
        await fetch(`${base}/breeds/image/random`);
      });
    },
    extraWait: 1000,
  },
  {
    name: 'PokéAPI - Pokemon Data',
    filename: 'pokeapi.har',
    url: 'https://pokeapi.co/',
    description: 'Nested REST API with pagination and linked resources',
    tags: ['rest', 'json', 'nested', 'pagination'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://pokeapi.co/api/v2';
        await fetch(`${base}/pokemon?limit=10`);
        await fetch(`${base}/pokemon/pikachu`);
        await fetch(`${base}/pokemon/charizard`);
        await fetch(`${base}/type/fire`);
        await fetch(`${base}/ability/overgrow`);
      });
    },
    extraWait: 1000,
  },
  {
    name: 'Open-Meteo Weather',
    filename: 'open-meteo-weather.har',
    url: 'https://open-meteo.com/',
    description: 'Weather forecast API with geo-coordinates',
    tags: ['rest', 'weather', 'geo', 'timeseries'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://api.open-meteo.com/v1';
        // San Francisco
        await fetch(`${base}/forecast?latitude=37.77&longitude=-122.42&current_weather=true`);
        // Tokyo
        await fetch(`${base}/forecast?latitude=35.68&longitude=139.69&hourly=temperature_2m&forecast_days=3`);
        // London
        await fetch(`${base}/forecast?latitude=51.51&longitude=-0.13&daily=temperature_2m_max,temperature_2m_min&timezone=Europe/London`);
      });
    },
    extraWait: 1000,
  },
  {
    name: 'REST Countries',
    filename: 'restcountries.har',
    url: 'https://restcountries.com/',
    description: 'Country data API with filtering and field selection',
    tags: ['rest', 'geo', 'filtering'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://restcountries.com/v3.1';
        await fetch(`${base}/all?fields=name,capital,population,flags`);
        await fetch(`${base}/name/japan`);
        await fetch(`${base}/region/africa?fields=name,capital`);
        await fetch(`${base}/alpha?codes=US,GB,FR`);
      });
    },
    extraWait: 1000,
  },

  // ── GraphQL APIs ───────────────────────────────────────
  {
    name: 'Countries GraphQL',
    filename: 'countries-graphql.har',
    url: 'https://countries.trevorblades.com/',
    description: 'GraphQL API for country data - queries, nested fields',
    tags: ['graphql', 'geo'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const url = 'https://countries.trevorblades.com/';
        const gql = (query: string) =>
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          });
        await gql(`{ countries { code name capital emoji continent { name } } }`);
        await gql(`{ country(code: "JP") { name native capital currency languages { name } states { name } } }`);
        await gql(`{ continents { code name countries { code name } } }`);
        await gql(`{ languages { code name native rtl } }`);
      });
    },
    extraWait: 1000,
  },
  {
    name: 'SpaceX GraphQL',
    filename: 'spacex-graphql.har',
    url: 'https://spacex-production.up.railway.app/',
    description: 'SpaceX launch data via GraphQL',
    tags: ['graphql', 'space', 'nested'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const url = 'https://spacex-production.up.railway.app/graphql';
        const gql = (query: string) =>
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          });
        await gql(`{ launches(limit: 5) { mission_name launch_date_utc rocket { rocket_name } launch_success } }`);
        await gql(`{ rockets { name description first_flight height { meters } mass { kg } } }`);
        await gql(`{ company { name founder founded employees launch_sites vehicles } }`);
      });
    },
    extraWait: 1000,
  },

  // ── Rich web apps / SPAs ───────────────────────────────
  {
    name: 'Hacker News',
    filename: 'hackernews.har',
    url: 'https://news.ycombinator.com/',
    description: 'Classic multi-page site with Firebase API',
    tags: ['web', 'news', 'firebase'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://hacker-news.firebaseio.com/v0';
        await fetch(`${base}/topstories.json?limitToFirst=10&orderBy="$key"`);
        await fetch(`${base}/item/1.json`);
        await fetch(`${base}/newstories.json?limitToFirst=5&orderBy="$key"`);
      });
    },
    extraWait: 2000,
  },
  {
    name: 'GitHub Trending',
    filename: 'github-trending.har',
    url: 'https://github.com/trending',
    description: 'Heavy SPA with many asset requests + API calls',
    tags: ['web', 'spa', 'heavy'],
    extraWait: 3000,
  },
  {
    name: 'npm Registry - React',
    filename: 'npm-react.har',
    url: 'https://www.npmjs.com/package/react',
    description: 'npm package page with registry API calls',
    tags: ['web', 'registry', 'spa'],
    extraWait: 3000,
  },

  // ── Specialized / fun APIs ─────────────────────────────
  {
    name: 'NASA Astronomy Picture of the Day',
    filename: 'nasa-apod.har',
    url: 'https://apod.nasa.gov/apod/astropix.html',
    description: 'NASA APOD API with DEMO_KEY auth',
    tags: ['rest', 'space', 'auth-key'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY');
        await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=3');
      });
    },
    extraWait: 1000,
  },
  {
    name: 'HTTPBin - All Methods',
    filename: 'httpbin-methods.har',
    url: 'https://httpbin.org/',
    description: 'HTTP test service - GET, POST, PUT, PATCH, DELETE',
    tags: ['rest', 'testing', 'methods'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://httpbin.org';
        await fetch(`${base}/get?search=hello&page=1`);
        await fetch(`${base}/post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Custom-Header': 'test-value' },
          body: JSON.stringify({ title: 'New Post', tags: ['api', 'test'] }),
        });
        await fetch(`${base}/put`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 42, name: 'Updated Resource' }),
        });
        await fetch(`${base}/patch`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        });
        await fetch(`${base}/delete`, { method: 'DELETE' });
        await fetch(`${base}/headers`);
        await fetch(`${base}/ip`);
        await fetch(`${base}/user-agent`);
      });
    },
    extraWait: 1000,
  },
  {
    name: 'Cat Facts',
    filename: 'catfacts.har',
    url: 'https://catfact.ninja/',
    description: 'Simple paginated API with breeds and facts',
    tags: ['rest', 'pagination', 'simple'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        await fetch('https://catfact.ninja/fact');
        await fetch('https://catfact.ninja/facts?limit=10');
        await fetch('https://catfact.ninja/breeds?limit=5');
        await fetch('https://catfact.ninja/facts?page=2&limit=5');
      });
    },
    extraWait: 1000,
  },
  {
    name: 'OpenLibrary - Book Search',
    filename: 'openlibrary-books.har',
    url: 'https://openlibrary.org/',
    description: 'Book search and details API',
    tags: ['rest', 'search', 'books'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://openlibrary.org';
        await fetch(`${base}/search.json?q=dune&limit=5`);
        await fetch(`${base}/search.json?q=neuromancer&limit=5`);
        await fetch(`${base}/works/OL45883W.json`); // Dune
        await fetch(`${base}/authors/OL34221A.json`); // Frank Herbert
      });
    },
    extraWait: 1000,
  },
  {
    name: 'Wikipedia Search API',
    filename: 'wikipedia-search.har',
    url: 'https://en.wikipedia.org/wiki/Main_Page',
    description: 'MediaWiki API - opensearch and query endpoints',
    tags: ['rest', 'search', 'wiki'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://en.wikipedia.org/w/api.php';
        await fetch(`${base}?action=opensearch&search=artificial+intelligence&limit=10&format=json&origin=*`);
        await fetch(`${base}?action=query&list=search&srsearch=machine+learning&format=json&origin=*`);
        await fetch(`${base}?action=query&titles=TypeScript&prop=extracts&exintro=true&format=json&origin=*`);
      });
    },
    extraWait: 1500,
  },
  {
    name: 'DummyJSON - E-commerce',
    filename: 'dummyjson-ecommerce.har',
    url: 'https://dummyjson.com/',
    description: 'Fake e-commerce API - products, carts, auth',
    tags: ['rest', 'ecommerce', 'auth', 'crud'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://dummyjson.com';
        await fetch(`${base}/products?limit=10`);
        await fetch(`${base}/products/search?q=phone`);
        await fetch(`${base}/products/categories`);
        await fetch(`${base}/carts/1`);
        await fetch(`${base}/users/1`);
        await fetch(`${base}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'emilys', password: 'emilyspass' }),
        });
      });
    },
    extraWait: 1000,
  },
  {
    name: 'Reqres - User CRUD',
    filename: 'reqres-users.har',
    url: 'https://reqres.in/',
    description: 'User management API with pagination and CRUD',
    tags: ['rest', 'crud', 'pagination', 'auth'],
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://reqres.in/api';
        await fetch(`${base}/users?page=1`);
        await fetch(`${base}/users?page=2`);
        await fetch(`${base}/users/2`);
        await fetch(`${base}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Jane', job: 'Engineer' }),
        });
        await fetch(`${base}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'eve.holt@reqres.in', password: 'pistol' }),
        });
      });
    },
    extraWait: 1000,
  },
];

async function captureOne(target: CaptureTarget): Promise<{ entries: number; size: number } | null> {
  const harPath = path.join(OUTPUT_DIR, target.filename);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordHar: { path: harPath, mode: 'full' },
  });
  const page = await context.newPage();

  try {
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 15_000 });

    if (target.interact) {
      await target.interact(page);
    }

    if (target.extraWait) {
      await page.waitForTimeout(target.extraWait);
    }
  } catch (err) {
    console.warn(`    ⚠ ${(err as Error).message}`);
  }

  await context.close();
  await browser.close();

  if (!fs.existsSync(harPath)) return null;

  const stats = fs.statSync(harPath);
  const har = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
  const entries = har.log?.entries?.length || 0;

  return { entries, size: stats.size };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('');
  console.log('═'.repeat(65));
  console.log('  PUBLIC HAR COLLECTION BUILDER');
  console.log('═'.repeat(65));
  console.log(`  Output:  ${OUTPUT_DIR}`);
  console.log(`  Targets: ${targets.length} sites`);
  console.log('');

  const results: Array<{
    name: string;
    filename: string;
    description: string;
    tags: string[];
    entries: number;
    sizeKB: number;
    success: boolean;
  }> = [];

  for (const target of targets) {
    process.stdout.write(`  ▸ ${target.name}... `);
    try {
      const result = await captureOne(target);
      if (result && result.entries > 0) {
        console.log(`✓ ${result.entries} entries (${(result.size / 1024).toFixed(0)}KB)`);
        results.push({
          name: target.name,
          filename: target.filename,
          description: target.description,
          tags: target.tags,
          entries: result.entries,
          sizeKB: Math.round(result.size / 1024),
          success: true,
        });
      } else {
        console.log('✗ no entries');
        results.push({
          name: target.name,
          filename: target.filename,
          description: target.description,
          tags: target.tags,
          entries: 0,
          sizeKB: 0,
          success: false,
        });
      }
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
      results.push({
        name: target.name,
        filename: target.filename,
        description: target.description,
        tags: target.tags,
        entries: 0,
        sizeKB: 0,
        success: false,
      });
    }
  }

  // Write index file
  const succeeded = results.filter((r) => r.success);
  const index = {
    generatedAt: new Date().toISOString(),
    totalCaptures: succeeded.length,
    captures: succeeded.map((r) => ({
      name: r.name,
      filename: r.filename,
      description: r.description,
      tags: r.tags,
      entries: r.entries,
      sizeKB: r.sizeKB,
    })),
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'index.json'),
    JSON.stringify(index, null, 2),
  );

  console.log('');
  console.log('═'.repeat(65));
  console.log(`  DONE: ${succeeded.length}/${targets.length} captured`);
  console.log('═'.repeat(65));
  for (const r of results) {
    const icon = r.success ? '✓' : '✗';
    const info = r.success ? `${r.entries} entries, ${r.sizeKB}KB` : 'failed';
    console.log(`  ${icon} ${r.name} — ${info}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
