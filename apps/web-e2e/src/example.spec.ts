import { expect, test } from '@playwright/test';

test('redirects unauthenticated visitors to the sign-in route', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Sentinel/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('renders the sign-in route', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveTitle(/Sentinel/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('offers registration from the sign-in route', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create one' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});

test('offers password reset from the sign-in route', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();
  await expect(page).toHaveURL(/\/forgot-password/);
});
