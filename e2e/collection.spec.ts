import { test, expect } from '@playwright/test';
import { mockAnalyzeEndpoint } from './fixtures/mock-api';
import { uploadHarFile, typeDescription, clickAnalyze, waitForResult, MINIMAL_HAR } from './fixtures/test-helpers';

test.describe('Collection / History Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear localStorage before each test
    await page.evaluate(() => localStorage.clear());
  });

  test('after analysis, item is auto-saved to collection', async ({ page }) => {
    await mockAnalyzeEndpoint(page);
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');
    await clickAnalyze(page);
    await waitForResult(page);

    // Check localStorage has saved the item
    const collection = await page.evaluate(() => localStorage.getItem('har-re-collection'));
    expect(collection).toBeTruthy();
    const items = JSON.parse(collection!);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].description).toBe('Find the users API');
  });

  test('pressing H opens History sidebar with saved item', async ({ page }) => {
    await mockAnalyzeEndpoint(page);
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');
    await clickAnalyze(page);
    await waitForResult(page);

    // Open history sidebar
    await page.keyboard.press('h');

    // Sidebar should show the saved item
    const sidebar = page.locator('.fixed.top-0.right-0');
    await expect(sidebar.getByText('History')).toBeVisible();
    await expect(sidebar.getByText('Find the users API')).toBeVisible();
    await expect(sidebar.getByText('api.example.com/v1/users')).toBeVisible();
  });

  test('clicking History button opens sidebar', async ({ page }) => {
    await page.locator('button[title="History (H)"]').click();
    await expect(page.getByText('History')).toBeVisible();
  });

  test('empty collection shows "No saved requests" message', async ({ page }) => {
    await page.keyboard.press('h');
    await expect(page.getByText('No saved requests yet')).toBeVisible();
  });

  test('sidebar closes on Escape', async ({ page }) => {
    await page.locator('button[title="History (H)"]').click();
    const sidebar = page.locator('.fixed.top-0.right-0');
    await expect(sidebar).toHaveClass(/translate-x-0/);

    await page.keyboard.press('Escape');
    // After close, the sidebar panel should have translate-x-full (off-screen)
    await expect(sidebar).toHaveClass(/translate-x-full/);
  });

  test('Clear All empties the collection', async ({ page }) => {
    await mockAnalyzeEndpoint(page);
    await uploadHarFile(page, MINIMAL_HAR);
    await typeDescription(page, 'Find the users API');
    await clickAnalyze(page);
    await waitForResult(page);

    // Open sidebar
    await page.keyboard.press('h');
    const sidebar = page.locator('.fixed.top-0.right-0');
    await expect(sidebar.getByText('Find the users API')).toBeVisible();

    // Click Clear All
    await sidebar.getByRole('button', { name: 'Clear All' }).click();

    // Should now show empty state
    await expect(page.getByText('No saved requests yet')).toBeVisible();

    // Verify localStorage is cleared
    const collection = await page.evaluate(() => localStorage.getItem('har-re-collection'));
    const items = collection ? JSON.parse(collection) : [];
    expect(items.length).toBe(0);
  });
});
