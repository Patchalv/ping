import { expect, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

// "Owners" is Private. Pablo is a Member and Marta a company Admin; neither is a member.
for (const [who, email] of [
  ['a non-member Member', 'pablo.serra@example.com'],
  ['a company Admin who is not a member', 'marta.ruiz@example.com'],
] as const) {
  test(`a Private channel is absent for ${who}`, async ({ page }) => {
    await signIn(page, email);
    const sidebar = page.getByRole('navigation', { name: 'Channels' });
    await expect(sidebar.getByRole('link', { name: /Front desk/ })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /Owners/ })).toHaveCount(0);

    await page.goto(`/channels/${SEED.owners}`);
    await expect(page.getByRole('heading', { name: 'Channel not found' })).toBeVisible();
    await expect(page.getByText('Owners')).toHaveCount(0);
    await expect(page.getByText('Contracts and budgets')).toHaveCount(0);
  });
}

test('a member opens a Private channel from the sidebar', async ({ page }) => {
  await signIn(page, 'jordi.puig@example.com');
  await page
    .getByRole('navigation', { name: 'Channels' })
    .getByRole('link', { name: 'Owners, Private' })
    .click();

  await expect(page).toHaveURL(`/channels/${SEED.owners}`);
  const bar = page.getByRole('region', { name: 'Channel' });
  await expect(bar.getByRole('heading', { name: 'Owners' })).toBeVisible();
  await expect(bar.getByText('Private')).toBeVisible();
  await expect(bar.getByText('2 members')).toBeVisible();
  await expect(bar.getByText('Contracts and budgets. Owners only.')).toBeVisible();
  await expect(page.getByText('No Threads yet')).toBeVisible();
});

test('a Staff member creates a Private channel and lands in it', async ({ page }) => {
  const name = `Plans ${test.info().project.name} ${Date.now()}`;
  await signIn(page, 'pablo.serra@example.com');
  await page.getByRole('button', { name: 'Create channel' }).click();

  const dialog = page.getByRole('dialog', { name: 'Create a Channel' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Description').fill('Next term’s plans.');
  await dialog.getByLabel(/^Private/).check();
  await dialog.getByRole('button', { name: 'Create channel' }).click();

  const bar = page.getByRole('region', { name: 'Channel' });
  await expect(bar.getByRole('heading', { name })).toBeVisible();
  await expect(bar.getByText('1 member')).toBeVisible();
  await expect(page).toHaveURL(/\/channels\/[0-9a-f-]{36}$/);

  await page.goto('/');
  await expect(
    page
      .getByRole('navigation', { name: 'Channels' })
      .getByRole('link', { name: `${name}, Private` }),
  ).toBeVisible();
});
