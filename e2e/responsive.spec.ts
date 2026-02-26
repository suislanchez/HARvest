import { test, expect } from '@playwright/test';

test.describe('Responsive — Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page renders without horizontal scroll', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });

  test('upload zone is visible and usable at mobile width', async ({ page }) => {
    await expect(
      page.getByText('Drag & drop a .har file here, or click to browse'),
    ).toBeVisible();

    // Should be able to upload
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'mobile-test.har',
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

    await expect(page.getByText('mobile-test.har')).toBeVisible();
  });

  test('history sidebar renders as full-width overlay on mobile', async ({ page }) => {
    await page.keyboard.press('h');

    // The sidebar panel should be visible
    const sidebar = page.locator('.fixed.top-0.right-0');
    await expect(sidebar).toBeVisible();
  });
});
