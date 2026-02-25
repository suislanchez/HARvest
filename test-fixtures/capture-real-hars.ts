/**
 * Playwright HAR Capture Script
 *
 * Automates browser visits to real public websites and exports actual HAR files.
 * These HAR files contain real-world noise (analytics, ads, static assets, etc.)
 * making them ideal for stress-testing the analysis pipeline.
 *
 * Usage:
 *   npx playwright install chromium
 *   npx tsx test-fixtures/capture-real-hars.ts
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

interface CaptureTarget {
  name: string;
  filename: string;
  url: string;
  /** Optional: interact with the page to trigger API calls */
  interact?: (page: Page) => Promise<void>;
  /** Wait for specific network activity before closing */
  waitForApi?: string;
  /** Extra wait time in ms after page load */
  extraWait?: number;
}

const targets: CaptureTarget[] = [
  {
    name: 'Open-Meteo Weather API',
    filename: 'open-meteo-weather.har',
    url: 'https://open-meteo.com/en/docs',
    waitForApi: '**/v1/forecast*',
    extraWait: 3000,
  },
  {
    name: 'USGS Earthquake GeoJSON',
    filename: 'usgs-earthquakes.har',
    url: 'https://earthquake.usgs.gov/earthquakes/map/',
    waitForApi: '**/fdsnws/**',
    extraWait: 5000,
  },
  {
    name: 'PokeAPI Pokemon Detail',
    filename: 'pokeapi-pokemon.har',
    url: 'https://pokeapi.co/',
    interact: async (page: Page) => {
      // Type a pokemon name in the search/input if available, or visit API directly
      await page.goto('https://pokeapi.co/api/v2/pokemon/pikachu');
      await page.waitForTimeout(1000);
      // Go back to the main page which makes XHR calls
      await page.goto('https://pokeapi.co/');
      await page.waitForTimeout(2000);
    },
    extraWait: 2000,
  },
  {
    name: 'Hacker News Firebase API',
    filename: 'hackernews-firebase.har',
    url: 'https://news.ycombinator.com/',
    extraWait: 3000,
  },
  {
    name: 'Dog CEO Random Image API',
    filename: 'dog-ceo-random.har',
    url: 'https://dog.ceo/dog-api/',
    interact: async (page: Page) => {
      // Click the "Fetch!" button if it exists to trigger API call
      try {
        const fetchBtn = page.locator('button', { hasText: /fetch/i });
        if (await fetchBtn.isVisible({ timeout: 3000 })) {
          await fetchBtn.click();
          await page.waitForTimeout(2000);
          await fetchBtn.click();
          await page.waitForTimeout(2000);
        }
      } catch {
        // Button may not exist, that's fine — the page itself makes API calls
      }
    },
    extraWait: 3000,
  },
  {
    name: 'JSONPlaceholder REST API',
    filename: 'jsonplaceholder-todos.har',
    url: 'https://jsonplaceholder.typicode.com/',
    interact: async (page: Page) => {
      // Use fetch() from page context to create XHR-style API calls
      // (navigating directly returns text/html content-type which gets filtered)
      await page.evaluate(async () => {
        await fetch('https://jsonplaceholder.typicode.com/todos');
        await fetch('https://jsonplaceholder.typicode.com/posts/1');
        await fetch('https://jsonplaceholder.typicode.com/users');
        await fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'test', body: 'test post', userId: 1 }),
        });
      });
    },
    extraWait: 1000,
  },
];

async function captureHar(target: CaptureTarget): Promise<string> {
  const harPath = path.join(OUTPUT_DIR, target.filename);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordHar: {
      path: harPath,
      mode: 'full',
      urlFilter: /.*/,
    },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    console.log(`  [${target.name}] Navigating to ${target.url}...`);
    await page.goto(target.url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for specific API response if configured
    if (target.waitForApi) {
      try {
        await page.waitForResponse(target.waitForApi, { timeout: 10000 });
        console.log(`  [${target.name}] API response detected`);
      } catch {
        console.log(`  [${target.name}] API wait timed out (may still have captured requests)`);
      }
    }

    // Run custom interactions
    if (target.interact) {
      console.log(`  [${target.name}] Running interactions...`);
      await target.interact(page);
    }

    // Extra wait for any lazy-loaded API calls
    if (target.extraWait) {
      await page.waitForTimeout(target.extraWait);
    }
  } catch (err) {
    console.warn(`  [${target.name}] Warning during capture: ${(err as Error).message}`);
  }

  // Close context to flush HAR
  await context.close();
  await browser.close();

  // Verify the HAR was written and has entries
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
  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('='.repeat(70));
  console.log('  HAR CAPTURE — Real Browser Traffic');
  console.log('='.repeat(70));
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log(`  Targets: ${targets.length} sites\n`);

  const results: Array<{ name: string; path: string; success: boolean }> = [];

  for (const target of targets) {
    console.log(`\n  Capturing: ${target.name}`);
    try {
      const harPath = await captureHar(target);
      results.push({ name: target.name, path: harPath, success: !!harPath });
    } catch (err) {
      console.error(`  [${target.name}] FAILED: ${(err as Error).message}`);
      results.push({ name: target.name, path: '', success: false });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  CAPTURE SUMMARY');
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
