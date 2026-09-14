import { expect, test } from '@playwright/test';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

test.describe('authenticated workspace flow', () => {
  test('registers and lands on the live overview', async ({ page, request }) => {
    const health = await request.get(`${apiBase}/health`).catch(() => null);
    test.skip(!health?.ok(), 'API is not running');

    const email = `e2e-${Date.now()}@sentinel.test`;
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('CorrectHorseBattery9!');
    await page.getByLabel('Confirm password').fill('CorrectHorseBattery9!');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('PROTECTED ASSETS')).toBeVisible();
  });
});
