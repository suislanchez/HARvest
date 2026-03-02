/**
 * Diverse HAR Capture Script — additional real-world public API targets.
 *
 * Captures browser traffic from 5+ additional public sites to expand the
 * benchmark's coverage of different API patterns.
 *
 * Usage:
 *   npx playwright install chromium
 *   npx tsx test-fixtures/capture-diverse-hars.ts
 *
 * Output: test-fixtures/captured/*.har
 */

import { chromium, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirnameCompat = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

const OUTPUT_DIR = path.join(__dirnameCompat, 'captured');

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
    name: 'Reddit JSON API (old.reddit.com)',
    filename: 'reddit-json.har',
    url: 'https://old.reddit.com/r/programming/.json',
    extraWait: 3000,
  },
  {
    name: 'Stack Overflow Questions API',
    filename: 'stackoverflow-api.har',
    url: 'https://api.stackexchange.com/2.3/questions?order=desc&sort=activity&site=stackoverflow&pagesize=5',
    extraWait: 2000,
  },
  {
    name: 'OpenStreetMap Nominatim Geocoding',
    filename: 'nominatim-geocode.har',
    url: 'https://nominatim.openstreetmap.org/search?format=json&q=San+Francisco',
    extraWait: 2000,
  },
  {
    name: 'Weather.gov Forecast API',
    filename: 'weathergov-forecast.har',
    url: 'https://api.weather.gov/gridpoints/MTR/85,105/forecast',
    extraWait: 2000,
  },
  {
    name: 'ExchangeRate API',
    filename: 'exchangerate-api.har',
    url: 'https://open.er-api.com/v6/latest/USD',
    extraWait: 2000,
  },
  {
    name: 'GitHub REST API (public repos)',
    filename: 'github-repos-api.har',
    url: 'https://api.github.com/search/repositories?q=language:typescript&sort=stars&per_page=5',
    extraWait: 2000,
  },
  {
    name: 'Wikipedia REST API',
    filename: 'wikipedia-rest.har',
    url: 'https://en.wikipedia.org/api/rest_v1/page/summary/HTTP_Archive',
    extraWait: 2000,
  },
  {
    name: 'iTunes Search API',
    filename: 'itunes-search.har',
    url: 'https://itunes.apple.com/search?term=radiohead&media=music&limit=5',
    extraWait: 2000,
  },
];

async function captureTarget(target: CaptureTarget): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordHar: {
      path: path.join(OUTPUT_DIR, target.filename),
      mode: 'full',
    },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) HARvest-Capture/1.0',
  });

  const page = await context.newPage();

  try {
    console.log(`  Capturing: ${target.name} (${target.url})`);

    if (target.waitForApi) {
      const [response] = await Promise.all([
        page.waitForResponse(target.waitForApi, { timeout: 15000 }).catch(() => null),
        page.goto(target.url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null),
      ]);
    } else {
      await page.goto(target.url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
    }

    if (target.interact) {
      await target.interact(page);
    }

    if (target.extraWait) {
      await page.waitForTimeout(target.extraWait);
    }

    console.log(`  Done: ${target.name}`);
  } catch (err) {
    console.warn(`  Warning: ${target.name} - ${(err as Error).message}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main(): Promise<void> {
  console.log('Diverse HAR Capture Script');
  console.log('=========================\n');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const target of targets) {
    try {
      await captureTarget(target);
    } catch (err) {
      console.error(`  Failed: ${target.name} - ${(err as Error).message}`);
    }
  }

  // Validate outputs
  console.log('\nValidation:');
  for (const target of targets) {
    const harPath = path.join(OUTPUT_DIR, target.filename);
    if (fs.existsSync(harPath)) {
      const content = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
      const entryCount = content.log?.entries?.length || 0;
      const sizeMB = (fs.statSync(harPath).size / (1024 * 1024)).toFixed(2);
      console.log(`  ${target.filename}: ${entryCount} entries, ${sizeMB} MB`);
    } else {
      console.log(`  ${target.filename}: MISSING`);
    }
  }
}

main().catch(console.error);
