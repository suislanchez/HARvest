import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { uploadHarFile, typeDescription, clickAnalyze, waitForResult, CAPTURED_DIR, FIXTURES_DIR } from './fixtures/test-helpers';

test.describe('Live Analysis — Real Backend + OpenAI', () => {
  // These tests require the backend to be running with OPENAI_API_KEY.
  // Start both servers first: npm run dev

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('jokes-real.har → finds JokeAPI', async ({ page }) => {
    const harPath = path.join(FIXTURES_DIR, 'jokes-real.har');
    test.skip(!fs.existsSync(harPath), 'jokes-real.har not found');

    await uploadHarFile(page, harPath);
    await typeDescription(page, 'Give me a curl to get 5 jokes from the API');
    await clickAnalyze(page);
    await waitForResult(page, 90_000);

    // Should find jokeapi.dev
    await expect(page.getByText('jokeapi.dev').first()).toBeVisible();
    // Should have some confidence
    await expect(page.getByText(/\d+% confidence/)).toBeVisible();
  });

  test('open-meteo-weather.har → finds weather forecast API', async ({ page }) => {
    const harPath = path.join(CAPTURED_DIR, 'open-meteo-weather.har');
    test.skip(!fs.existsSync(harPath), 'Run capture-real-hars.ts first');

    await uploadHarFile(page, harPath);
    await typeDescription(page, 'Find the weather forecast API call');
    await clickAnalyze(page);
    await waitForResult(page, 90_000);

    await expect(page.getByText('open-meteo').first()).toBeVisible();
  });

  test('pokeapi-pokemon.har → finds Pokemon API with reasonable confidence', async ({ page }) => {
    const harPath = path.join(CAPTURED_DIR, 'pokeapi-pokemon.har');
    test.skip(!fs.existsSync(harPath), 'Run capture-real-hars.ts first');

    await uploadHarFile(page, harPath);
    await typeDescription(page, 'Find the Pokemon data API call');
    await clickAnalyze(page);
    await waitForResult(page, 90_000);

    await expect(page.getByText('pokeapi.co').first()).toBeVisible();
  });

  test('dog-ceo-random.har → finds dog image API', async ({ page }) => {
    const harPath = path.join(CAPTURED_DIR, 'dog-ceo-random.har');
    test.skip(!fs.existsSync(harPath), 'Run capture-real-hars.ts first');

    await uploadHarFile(page, harPath);
    await typeDescription(page, 'Find the random dog image API');
    await clickAnalyze(page);
    await waitForResult(page, 90_000);

    await expect(page.getByText('dog.ceo').first()).toBeVisible();
  });
});
