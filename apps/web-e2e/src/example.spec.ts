import { test, expect } from '@playwright/test';

test('renders the Sentinel dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Sentinel/);
  await expect(page.locator('h1')).toHaveText('Overview');
  await expect(page.getByText('SECURITY SCORE', { exact: true })).toBeVisible();
});

test('renders the sign-in route', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle(/Sentinel/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
