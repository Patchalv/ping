import { expect, type Page, test } from '@playwright/test';

// Seeded by apps/server/src/db/seed.ts.
export const PASSWORD = 'ping-local-dev-password';
export const SEED = {
  frontDesk: '00000000-0000-4000-8000-000000000101',
  owners: '00000000-0000-4000-8000-000000000102',
  teaching: '00000000-0000-4000-8000-000000000103',
} as const;

/**
 * Locally nothing sets Fly-Client-IP, so Better Auth's sign-in rate limiter would put
 * every test in one shared bucket. Each test gets its own address, as on Fly. The counter
 * is shared by every spec file in the worker, so two files never hand out the same one.
 */
let nextIp = 1;
export function useOwnClientIp(): void {
  test.beforeEach(async ({ page }, testInfo) => {
    // Each worker has its own block, so a retried worker (a new index) never reuses one.
    const block = testInfo.workerIndex % 250;
    const octet = nextIp++ % 250;
    await page.setExtraHTTPHeaders({ 'fly-client-ip': `10.0.${block}.${octet + 1}` });
  });
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await signInHere(page, email);
}

/** Signs in on the sign-in page already showing, without a page load. */
export async function signInHere(page: Page, email: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /^Account: / })).toBeVisible();
}
