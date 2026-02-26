import { test, expect } from '@playwright/test';
import path from 'path';
import { MINIMAL_HAR } from './fixtures/test-helpers';

test.describe('File Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('file input accepts .har and .json files', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute('accept', '.har,.json');
  });

  test('uploading minimal.har shows filename and file size', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(MINIMAL_HAR);

    // Should display the filename
    await expect(page.getByText('minimal.har')).toBeVisible();
    // Should show file size (the file is ~4KB)
    await expect(page.getByText(/KB/)).toBeVisible();
  });

  test('after upload, HAR Inspector and Description sections appear', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(MINIMAL_HAR);

    // Step 2: HAR Inspector
    await expect(page.getByText('2. HAR Inspector')).toBeVisible();
    // Request count badge
    await expect(page.getByText('5 requests')).toBeVisible();
    // Step 3: Description
    await expect(page.getByText('3. Describe the API')).toBeVisible();
  });

  test('hero text and empty state disappear after upload', async ({ page }) => {
    // Visible before upload
    await expect(page.getByText('Reverse engineer any API from your browser')).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(MINIMAL_HAR);

    // Hero and stats should be hidden after HAR is loaded
    await expect(page.getByText('Reverse engineer any API from your browser')).not.toBeVisible();
    await expect(page.getByText('Blocked domains')).not.toBeVisible();
  });

  test('uploading invalid JSON shows error', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    // Create a temp invalid file
    await fileInput.setInputFiles({
      name: 'bad.har',
      mimeType: 'application/json',
      buffer: Buffer.from('this is not valid json {{{'),
    });

    await expect(page.getByText('Invalid JSON file')).toBeVisible();
  });

  test('uploading JSON without log.entries shows error', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'incomplete.har',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ data: 'no log entries here' })),
    });

    await expect(page.getByText('Invalid HAR file: missing log.entries')).toBeVisible();
  });

  test('replacing file updates the display', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    // Upload first file
    await fileInput.setInputFiles(MINIMAL_HAR);
    await expect(page.getByText('minimal.har')).toBeVisible();

    // Upload a replacement
    await fileInput.setInputFiles({
      name: 'replacement.har',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        log: {
          version: '1.2',
          creator: { name: 'test', version: '1.0' },
          entries: [{
            startedDateTime: '2024-01-01T00:00:00.000Z',
            time: 100,
            request: { method: 'GET', url: 'https://api.test.com/data', httpVersion: 'HTTP/2.0', cookies: [], headers: [{ name: 'Accept', value: 'application/json' }], queryString: [], headersSize: -1, bodySize: -1 },
            response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/2.0', cookies: [], headers: [{ name: 'Content-Type', value: 'application/json' }], content: { size: 50, mimeType: 'application/json' }, redirectURL: '', headersSize: -1, bodySize: 50 },
            cache: {},
            timings: { send: 0, wait: 50, receive: 50 },
          }],
        },
      })),
    });

    await expect(page.getByText('replacement.har')).toBeVisible();
    await expect(page.getByText('1 requests')).toBeVisible();
  });
});
