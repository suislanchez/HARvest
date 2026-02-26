/**
 * Extended Playwright HAR Capture Script
 *
 * Captures HAR files from diverse public websites/APIs.
 * Focuses on sites that reliably work with headless browsers.
 *
 * Usage:
 *   npx playwright install chromium
 *   npx tsx test-fixtures/capture-extended-hars.ts
 *
 * Output: test-fixtures/captured/*.har (gitignored)
 */

import { chromium, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirnameCompat = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.join(__dirnameCompat, 'captured');

/** Max time per target (navigation + interaction + wait) */
const TARGET_TIMEOUT = 25_000;

interface CaptureTarget {
  name: string;
  filename: string;
  url: string;
  interact?: (page: Page) => Promise<void>;
  waitForApi?: string;
  extraWait?: number;
}

const targets: CaptureTarget[] = [
  {
    name: 'GitHub Trending',
    filename: 'github-trending.har',
    url: 'https://github.com/trending',
    extraWait: 2000,
  },
  {
    name: 'Wikipedia Search API',
    filename: 'wikipedia-search.har',
    url: 'https://en.wikipedia.org/wiki/Main_Page',
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        await fetch('https://en.wikipedia.org/w/api.php?action=opensearch&search=javascript&limit=10&format=json&origin=*');
        await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=typescript&format=json&origin=*');
      });
    },
    extraWait: 1000,
  },
  {
    name: 'Countries GraphQL API',
    filename: 'countries-graphql.har',
    url: 'https://countries.trevorblades.com/',
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const queries = [
          `{ countries { code name capital continent { name } } }`,
          `{ country(code: "US") { name capital currency languages { name } } }`,
          `{ continents { code name countries { code name } } }`,
        ];
        for (const query of queries) {
          await fetch('https://countries.trevorblades.com/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
          });
        }
      });
    },
    extraWait: 1000,
  },
  {
    name: 'OpenLibrary Book Search',
    filename: 'openlibrary-search.har',
    url: 'https://openlibrary.org/search?q=javascript',
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        await fetch('https://openlibrary.org/search.json?q=javascript&limit=5');
        await fetch('https://openlibrary.org/search.json?q=typescript&limit=5');
      });
    },
    extraWait: 1000,
  },
  {
    name: 'CoinGecko Crypto Prices',
    filename: 'coingecko-prices.har',
    url: 'https://www.coingecko.com/',
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
        await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1');
      });
    },
    extraWait: 2000,
  },
  {
    name: 'NASA APOD API',
    filename: 'nasa-apod.har',
    url: 'https://apod.nasa.gov/apod/astropix.html',
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY');
        await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=3');
      });
    },
    extraWait: 1000,
  },
  {
    name: 'HTTPBin Multi-Method',
    filename: 'httpbin-methods.har',
    url: 'https://httpbin.org/',
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        const base = 'https://httpbin.org';
        await fetch(`${base}/get?foo=bar&baz=123`);
        await fetch(`${base}/post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Test Post', items: [1, 2, 3] }),
        });
        await fetch(`${base}/put`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 1, name: 'Updated Item' }),
        });
        await fetch(`${base}/patch`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Patched Name' }),
        });
        await fetch(`${base}/delete`, { method: 'DELETE' });
        await fetch(`${base}/headers`);
      });
    },
    extraWait: 1000,
  },
  {
    name: 'npm Registry (react)',
    filename: 'npm-registry.har',
    url: 'https://www.npmjs.com/package/react',
    extraWait: 2000,
  },
  {
    name: 'Cat Facts API',
    filename: 'catfacts-api.har',
    url: 'https://catfact.ninja/',
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        await fetch('https://catfact.ninja/fact');
        await fetch('https://catfact.ninja/facts?limit=5');
        await fetch('https://catfact.ninja/breeds?limit=5');
      });
    },
    extraWait: 1000,
  },
  {
    name: 'REST Countries API',
    filename: 'restcountries.har',
    url: 'https://restcountries.com/',
    interact: async (page: Page) => {
      await page.evaluate(async () => {
        await fetch('https://restcountries.com/v3.1/name/united');
        await fetch('https://restcountries.com/v3.1/region/europe?fields=name,capital');
        await fetch('https://restcountries.com/v3.1/alpha/US');
      });
    },
    extraWait: 1000,
  },
];

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

async function captureHar(target: CaptureTarget): Promise<string> {
  const harPath = path.join(OUTPUT_DIR, target.filename);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordHar: { path: harPath, mode: 'full', urlFilter: /.*/ },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    console.log(`  [${target.name}] Navigating to ${target.url}...`);
    // Use domcontentloaded — much faster than networkidle for heavy sites
    await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    if (target.waitForApi) {
      try {
        await page.waitForResponse(target.waitForApi, { timeout: 8000 });
        console.log(`  [${target.name}] API response detected`);
      } catch {
        console.log(`  [${target.name}] API wait timed out (continuing)`);
      }
    }

    if (target.interact) {
      console.log(`  [${target.name}] Running interactions...`);
      await target.interact(page);
    }

    if (target.extraWait) {
      await page.waitForTimeout(target.extraWait);
    }
  } catch (err) {
    console.warn(`  [${target.name}] Warning: ${(err as Error).message}`);
  }

  await context.close();
  await browser.close();

  if (fs.existsSync(harPath)) {
    const stats = fs.statSync(harPath);
    const har = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
    const entryCount = har.log?.entries?.length || 0;
    console.log(`  [${target.name}] Saved ${target.filename} (${(stats.size / 1024).toFixed(1)}KB, ${entryCount} entries)`);
    return harPath;
  } else {
    console.error(`  [${target.name}] FAILED — no HAR file written`);
    return '';
  }
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('='.repeat(70));
  console.log('  EXTENDED HAR CAPTURE — Diverse API Patterns');
  console.log('='.repeat(70));
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log(`  Targets: ${targets.length} sites\n`);

  const results: Array<{ name: string; path: string; success: boolean }> = [];

  for (const target of targets) {
    console.log(`\n  Capturing: ${target.name}`);
    try {
      const harPath = await withTimeout(
        captureHar(target),
        TARGET_TIMEOUT,
        target.name,
      );
      results.push({ name: target.name, path: harPath, success: !!harPath });
    } catch (err) {
      console.error(`  [${target.name}] FAILED: ${(err as Error).message}`);
      results.push({ name: target.name, path: '', success: false });
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('  EXTENDED CAPTURE SUMMARY');
  console.log('='.repeat(70));
  const succeeded = results.filter((r) => r.success).length;
  console.log(`  Captured: ${succeeded}/${results.length}`);
  for (const r of results) {
    const icon = r.success ? 'OK' : 'FAIL';
    console.log(`    [${icon}] ${r.name}`);
  }
  console.log('='.repeat(70));

  if (succeeded === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
