import { test, expect } from '@playwright/test';
import { uploadHarFile, MINIMAL_HAR } from './fixtures/test-helpers';

test.describe('HAR Inspector Table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await uploadHarFile(page, MINIMAL_HAR);
  });

  test('table renders with correct request count badge', async ({ page }) => {
    await expect(page.getByText('5 requests')).toBeVisible();
  });

  test('table shows request entries with URLs', async ({ page }) => {
    // Check that request data is visible in the inspector table
    // URLs might be truncated in the table, so use partial matching
    await expect(page.getByText('/v1/users').first()).toBeVisible();
    await expect(page.getByText('/v1/auth/login').first()).toBeVisible();
    await expect(page.getByText('/v1/posts').first()).toBeVisible();
  });

  test('table shows various HTTP methods', async ({ page }) => {
    // Should have GET and POST entries
    const inspectorCard = page.locator('text=2. HAR Inspector').locator('..');
    await expect(page.getByText('GET').first()).toBeVisible();
    await expect(page.getByText('POST').first()).toBeVisible();
  });

  test('example prompts are shown in description input', async ({ page }) => {
    // The description input section should show example prompt buttons
    await expect(page.getByText('The Spotify playlist fetch API')).toBeVisible();
    await expect(page.getByText('GraphQL query that fetches user profile')).toBeVisible();

    // Clicking an example prompt fills the textarea
    await page.getByText('The Spotify playlist fetch API').click();
    const textarea = page.locator('#description');
    await expect(textarea).toHaveValue('The Spotify playlist fetch API');
  });
});
