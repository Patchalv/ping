import { expect, type Page, test } from '@playwright/test';

// Seeded by apps/server/src/db/seed.ts.
export const PASSWORD = 'ping-local-dev-password';
export const SEED = {
  frontDesk: '00000000-0000-4000-8000-000000000101',
  owners: '00000000-0000-4000-8000-000000000102',
} as const;

/**
 * Locally nothing sets Fly-Client-IP, so Better Auth's sign-in rate limiter would put
 * every test in one shared bucket. Each test gets its own address, as on Fly.
 */
export function useOwnClientIp(): void {
  let nextIp = 1;
  test.beforeEach(async ({ page }, testInfo) => {
    const octet = (testInfo.workerIndex * 16 + nextIp++) % 250;
    await page.setExtraHTTPHeaders({ 'fly-client-ip': `192.0.2.${octet + 1}` });
  });
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation', { name: 'Channels' })).toBeVisible();
}
