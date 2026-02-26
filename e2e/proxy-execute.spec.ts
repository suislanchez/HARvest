import { test, expect } from '@playwright/test';
import { mockAnalyzeEndpoint, mockProxyEndpoint } from './fixtures/mock-api';
import { uploadHarFile, typeDescription, clickAnalyze, waitForResult, MINIMAL_HAR } from './fixtures/test-helpers';

test.describe('Proxy Execution — Execute curl and view response', () => {
  test.beforeEach(async ({ page }) => {
    await mockAnalyzeEndpoint(page);
    await mockProxyEndpoint(page);
    await page.goto('/');

    // Run through analysis first
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');
    await clickAnalyze(page);
    await waitForResult(page);
  });

  test('Execute button is visible after analysis result', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Execute/i })).toBeVisible();
  });

  test('clicking Execute shows loading state then response', async ({ page }) => {
    await page.getByRole('button', { name: /Execute/i }).click();

    // Should show "Executing..." loading card
    await expect(page.getByText('Executing...')).toBeVisible();

    // Wait for response card to appear
    await expect(page.getByText('Response')).toBeVisible({ timeout: 10_000 });
  });

  test('response card shows status badge with 200 OK', async ({ page }) => {
    await page.getByRole('button', { name: /Execute/i }).click();
    await expect(page.getByText('Response')).toBeVisible({ timeout: 10_000 });

    // Status badge
    await expect(page.getByText('200 OK')).toBeVisible();
    // Duration
    await expect(page.getByText('145ms')).toBeVisible();
  });

  test('response body tab shows JSON content', async ({ page }) => {
    await page.getByRole('button', { name: /Execute/i }).click();
    await expect(page.getByText('Response')).toBeVisible({ timeout: 10_000 });

    // Body tab should be active by default and show the mock response data
    await expect(page.getByText('"Alice"')).toBeVisible();
    await expect(page.getByText('"Bob"')).toBeVisible();
  });

  test('headers tab shows response headers', async ({ page }) => {
    await page.getByRole('button', { name: /Execute/i }).click();
    await expect(page.getByText('Response')).toBeVisible({ timeout: 10_000 });

    // Click Headers tab
    await page.getByRole('tab', { name: 'Headers' }).click();

    // Should show headers from mock response
    await expect(page.getByText('content-type')).toBeVisible();
    await expect(page.getByText('x-request-id')).toBeVisible();
  });
});
