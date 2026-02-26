import { test, expect } from '@playwright/test';
import { mockAnalyzeEndpoint, MOCK_ANALYSIS_RESPONSE } from './fixtures/mock-api';
import { uploadHarFile, typeDescription, clickAnalyze, waitForResult, MINIMAL_HAR } from './fixtures/test-helpers';

test.describe('Analysis Flow — Mocked Backend', () => {
  test.beforeEach(async ({ page }) => {
    await mockAnalyzeEndpoint(page);
    await page.goto('/');
  });

  test('full flow: upload → describe → analyze → see result', async ({ page }) => {
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users list API');
    await clickAnalyze(page);
    await waitForResult(page);

    // Confidence badge
    await expect(page.getByText('92% confidence')).toBeVisible();
  });

  test('pipeline stepper animates during analysis', async ({ page }) => {
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users list API');
    await clickAnalyze(page);

    // The stepper steps should appear
    await expect(page.getByText('Parsing HAR file...')).toBeVisible();
    await expect(page.getByText('Filtering requests...')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Matching with AI...')).toBeVisible({ timeout: 5_000 });

    // Wait for result to complete
    await waitForResult(page);

    // Stepper should be gone after result appears
    await expect(page.getByText('Parsing HAR file...')).not.toBeVisible({ timeout: 5_000 });
  });

  test('result card shows matched request details', async ({ page }) => {
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');
    await clickAnalyze(page);
    await waitForResult(page);

    // Method badge in the result card
    const resultsSection = page.locator('#results-section');
    await expect(resultsSection.getByText('GET').first()).toBeVisible();
    // URL in the matched request line
    await expect(resultsSection.getByText('api.example.com/v1/users').first()).toBeVisible();
    // Reason
    await expect(page.getByText('Best match for user list API endpoint')).toBeVisible();
  });

  test('curl output is displayed in code block', async ({ page }) => {
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');
    await clickAnalyze(page);
    await waitForResult(page);

    // The curl tab should be active by default and show the curl command
    await expect(page.getByText("curl -X GET").first()).toBeVisible();
    await expect(page.getByText("api.example.com/v1/users").first()).toBeVisible();
  });

  test('alternative matches are shown', async ({ page }) => {
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');
    await clickAnalyze(page);
    await waitForResult(page);

    // "Other matches" section
    await expect(page.getByText('Other matches:')).toBeVisible();
    // Second match URL
    await expect(page.getByText('api.example.com/v1/posts').first()).toBeVisible();
    // Second match confidence
    await expect(page.getByText('65%')).toBeVisible();
  });

  test('code generation tabs work (Python, JavaScript, Go, Ruby)', async ({ page }) => {
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');
    await clickAnalyze(page);
    await waitForResult(page);

    const resultsSection = page.locator('#results-section');

    // Click Python tab
    await resultsSection.getByRole('button', { name: 'Python' }).click();
    await expect(resultsSection.getByText('import requests')).toBeVisible();

    // Click JavaScript tab
    await resultsSection.getByRole('button', { name: 'JavaScript' }).click();
    await expect(resultsSection.getByText('fetch(')).toBeVisible();

    // Click Go tab
    await resultsSection.getByRole('button', { name: 'Go' }).click();
    await expect(resultsSection.getByText('http.NewRequest')).toBeVisible();

    // Click Ruby tab
    await resultsSection.getByRole('button', { name: 'Ruby' }).click();
    await expect(resultsSection.getByText('Net::HTTP')).toBeVisible();
  });

  test('description minimum 5 chars enforced — button disabled', async ({ page }) => {
    await uploadHarFile(page, MINIMAL_HAR);

    // Type too-short description
    await typeDescription(page, 'hi');

    // The Analyze button should be disabled
    const analyzeBtn = page.getByRole('button', { name: /Analyze HAR/i });
    await expect(analyzeBtn).toBeDisabled();

    // Type a valid description
    await typeDescription(page, 'Find the users API endpoint');
    await expect(analyzeBtn).toBeEnabled();
  });

  test('Cmd+Enter triggers analysis', async ({ page }) => {
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');

    // Press Cmd+Enter (Meta+Enter)
    const textarea = page.locator('#description');
    await textarea.press('Meta+Enter');

    // Should trigger analysis — wait for result
    await waitForResult(page);
    await expect(page.getByText('92% confidence')).toBeVisible();
  });
});
