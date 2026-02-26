import { test, expect } from '@playwright/test';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('pressing ? opens keyboard shortcuts modal', async ({ page }) => {
    // Click the body to ensure focus is on the page, then dispatch '?' keydown
    await page.locator('body').click();
    await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    // The KeyboardShortcuts component should be visible
    await expect(page.locator('h2', { hasText: 'Keyboard Shortcuts' })).toBeVisible();
  });

  test('pressing Escape closes modals', async ({ page }) => {
    // Open shortcuts modal
    await page.locator('body').click();
    await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    await expect(page.locator('h2', { hasText: 'Keyboard Shortcuts' })).toBeVisible();

    // Close with Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('h2', { hasText: 'Keyboard Shortcuts' })).not.toBeVisible();
  });

  test('pressing H opens History sidebar', async ({ page }) => {
    await page.keyboard.press('h');
    await expect(page.getByText('History')).toBeVisible();
  });

  test('pressing I opens Tech Info panel', async ({ page }) => {
    await page.locator('body').click();
    await page.keyboard.press('i');
    // TechDeepDive modal contains filter layer info
    await expect(page.getByText('URL validity')).toBeVisible({ timeout: 5_000 });
  });

  test('shortcuts are ignored when typing in description textarea', async ({ page }) => {
    // First upload a HAR so the description input appears
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test.har',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [{
            startedDateTime: '2024-01-01T00:00:00.000Z', time: 100,
            request: { method: 'GET', url: 'https://api.test.com/data', httpVersion: 'HTTP/2.0', cookies: [], headers: [{ name: 'Accept', value: 'application/json' }], queryString: [], headersSize: -1, bodySize: -1 },
            response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/2.0', cookies: [], headers: [{ name: 'Content-Type', value: 'application/json' }], content: { size: 50, mimeType: 'application/json' }, redirectURL: '', headersSize: -1, bodySize: 50 },
            cache: {}, timings: { send: 0, wait: 50, receive: 50 },
          }],
        },
      })),
    });

    // Focus the description textarea and type '?'
    const textarea = page.locator('#description');
    await textarea.click();
    await textarea.type('? test query');

    // The shortcuts modal should NOT have opened
    await expect(page.locator('h2', { hasText: 'Keyboard Shortcuts' })).not.toBeVisible();
    // The textarea should contain the typed text
    await expect(textarea).toHaveValue('? test query');
  });
});
