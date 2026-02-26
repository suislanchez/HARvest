import { Page, expect } from '@playwright/test';
import path from 'path';

export const MINIMAL_HAR = path.resolve(__dirname, 'minimal.har');
export const FIXTURES_DIR = path.resolve(__dirname, '../../test-fixtures');
export const CAPTURED_DIR = path.resolve(__dirname, '../../test-fixtures/captured');

/**
 * Upload a HAR file via the hidden file input.
 */
export async function uploadHarFile(page: Page, harPath: string) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(harPath);
  // Wait for the HAR Inspector card to appear (step 2)
  await expect(page.getByText('2. HAR Inspector')).toBeVisible({ timeout: 10_000 });
}

/**
 * Type text into the description textarea.
 */
export async function typeDescription(page: Page, description: string) {
  const textarea = page.locator('#description');
  await textarea.fill(description);
}

/**
 * Click the "Analyze HAR" button.
 */
export async function clickAnalyze(page: Page) {
  await page.getByRole('button', { name: /Analyze HAR/i }).click();
}

/**
 * Wait for the analysis result card to appear (contains "Result" heading + confidence badge).
 */
export async function waitForResult(page: Page, timeoutMs = 90_000) {
  // The CurlOutput card has a CardTitle with text "Result"
  await expect(page.locator('text=Result').first()).toBeVisible({ timeout: timeoutMs });
}

/**
 * Full flow: upload → describe → analyze → wait for result
 */
export async function fullAnalysisFlow(
  page: Page,
  harPath: string,
  description: string,
  timeoutMs = 90_000,
) {
  await uploadHarFile(page, harPath);
  await typeDescription(page, description);
  await clickAnalyze(page);
  await waitForResult(page, timeoutMs);
}
