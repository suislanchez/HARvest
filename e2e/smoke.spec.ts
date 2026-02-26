import { test, expect } from '@playwright/test';

test.describe('Smoke — Page loads correctly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page title and header are visible', async ({ page }) => {
    await expect(page.locator('text=HAR Reverse Engineer')).toBeVisible();
  });

  test('hero text is visible', async ({ page }) => {
    await expect(
      page.getByText('Reverse engineer any API from your browser'),
    ).toBeVisible();
  });

  test('upload zone is visible with instructions', async ({ page }) => {
    await expect(
      page.getByText('Drag & drop a .har file here, or click to browse'),
    ).toBeVisible();
  });

  test('capability stats are shown in empty state', async ({ page }) => {
    await expect(page.getByText('71', { exact: true })).toBeVisible();
    await expect(page.getByText('Blocked domains')).toBeVisible();
    await expect(page.getByText('5', { exact: true })).toBeVisible();
    await expect(page.getByText('Output languages')).toBeVisible();
    await expect(page.getByText('8', { exact: true })).toBeVisible();
    await expect(page.getByText('Filter layers')).toBeVisible();
  });

  test('tips section is visible', async ({ page }) => {
    await expect(page.getByText('Tips')).toBeVisible();
    await expect(page.getByText('Export HAR with content')).toBeVisible();
  });

  test('footer renders', async ({ page }) => {
    await expect(
      page.getByText('Built with Next.js, NestJS, and GPT-4o-mini'),
    ).toBeVisible();
  });

  test('nav buttons are present', async ({ page }) => {
    // History button
    await expect(page.locator('button[title="History (H)"]')).toBeVisible();
    // Info button
    await expect(page.locator('button[title="Tech Info (I)"]')).toBeVisible();
  });
});
