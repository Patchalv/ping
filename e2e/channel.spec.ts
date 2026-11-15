import { expect, test } from '@playwright/test';
import { SEED, signIn, signInHere, useOwnClientIp } from './support';

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
  // By role: Base UI's radio is a span with role="radio", backed by a hidden native input.
  await dialog.getByRole('radio', { name: /^Private/ }).check();
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

test('the next person to sign in on the same browser never sees the last one’s Private channel', async ({
  page,
}) => {
  // Jordi is in Owners. He opens it, then signs out without a page load.
  await signIn(page, 'jordi.puig@example.com');
  await page
    .getByRole('navigation', { name: 'Channels' })
    .getByRole('link', { name: 'Owners, Private' })
    .click();
  await expect(page.getByRole('region', { name: 'Channel' })).toBeVisible();
  await page.getByRole('button', { name: 'Account: Jordi Puig' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  // Marta signs in. Her sidebar request is held, so anything shown now came from a cache.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Both the sidebar and the Channel (the URL still points at Owners) are held.
  await page.route('**/api/channels**', async (route) => {
    await held;
    await route.continue();
  });
  await signInHere(page, 'marta.ruiz@example.com');
  // Not a retrying assertion: Owners must not appear even for a moment.
  expect(await page.getByText('Owners').count()).toBe(0);
  release();
  await expect(page.getByRole('heading', { name: 'Channel not found' })).toBeVisible();
  expect(await page.getByText('Owners').count()).toBe(0);
});

test('a Staff member whose session has gone is sent back to sign-in', async ({ page }) => {
  await signIn(page, 'laura.gomez@example.com');
  await page.context().clearCookies();
  await page
    .getByRole('navigation', { name: 'Channels' })
    .getByRole('link', { name: /Teaching/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Sign in to Ping' })).toBeVisible();
});

test('creating a Channel without a connection says so and lets the Staff member retry', async ({
  page,
}) => {
  await signIn(page, 'pablo.serra@example.com');
  await page.route('**/api/channels', (route) =>
    route.request().method() === 'POST' ? route.abort() : route.continue(),
  );
  await page.getByRole('button', { name: 'Create channel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a Channel' });
  await dialog.getByLabel('Name').fill('Offline');
  await dialog.getByRole('button', { name: 'Create channel' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Can’t reach Ping. Try again.');
  await expect(dialog.getByRole('button', { name: 'Create channel' })).toBeEnabled();
});

test('a form mistake is shown on its field', async ({ page }) => {
  await signIn(page, 'pablo.serra@example.com');
  await page.getByRole('button', { name: 'Create channel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a Channel' });
  await dialog.getByRole('button', { name: 'Create channel' }).click();
  const name = dialog.getByLabel('Name');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAccessibleDescription('Give the Channel a name.');
  await expect(name).toBeFocused();

  // Fixing it clears the mistake as the Staff member types.
  await name.fill('Ops');
  await expect(name).not.toHaveAttribute('aria-invalid');
  await expect(dialog.getByText('Give the Channel a name.')).toHaveCount(0);
});

test('a mistake the server finds is shown on its field, and clears when fixed', async ({
  page,
}) => {
  await signIn(page, 'pablo.serra@example.com');
  let refused = false;
  // The first create is refused as the server would refuse a bad name; the retry goes through.
  await page.route('**/api/channels', async (route) => {
    if (route.request().method() !== 'POST' || refused) return route.continue();
    refused = true;
    await route.fulfill({
      status: 400,
      json: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Check the highlighted fields.',
          issues: [{ path: 'name', message: 'Pick a different name.' }],
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Create channel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a Channel' });
  const name = dialog.getByLabel('Name');
  await name.fill('Refused');
  await dialog.getByLabel('Description').focus();
  await dialog.getByRole('button', { name: 'Create channel' }).click();

  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toHaveAccessibleDescription('Pick a different name.');
  await expect(name).toBeFocused();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Check the highlighted' })).toHaveCount(
    0,
  );

  const fixed = `Accepted ${test.info().project.name} ${Date.now()}`;
  await name.fill(fixed);
  await expect(name).not.toHaveAttribute('aria-invalid');
  await dialog.getByRole('button', { name: 'Create channel' }).click();
  await expect(
    page.getByRole('region', { name: 'Channel' }).getByRole('heading', { name: fixed }),
  ).toBeVisible();
});
