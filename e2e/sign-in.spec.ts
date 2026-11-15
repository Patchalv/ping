import { expect, test } from '@playwright/test';
import { PASSWORD, signIn, useOwnClientIp } from './support';

useOwnClientIp();

test('a Staff member signs in, sees their name, and signs out', async ({ page }) => {
  await signIn(page, 'jordi.puig@example.com');

  await page.reload();
  const account = page.getByRole('button', { name: 'Account: Jordi Puig' });
  await expect(account).toBeVisible();

  await account.click();
  await expect(page.getByText('jordi.puig@example.com')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to Ping' })).toBeVisible();
});

test('a wrong password is refused', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('laura.gomez@example.com');
  await page.getByLabel('Password').fill('not-the-right-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('That email and password don’t match.');
});

test('a Deactivated Staff member is refused', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('carlos.vidal@example.com');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'You’ve been Deactivated in Ping. Ask a Ping Admin.',
  );
  await expect(page.getByRole('heading', { name: 'Sign in to Ping' })).toBeVisible();
});
