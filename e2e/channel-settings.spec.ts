import { expect, type Locator, type Page, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

/** Opens the Channel settings dialog from the bar. Its button is icon-only on a phone. */
async function openSettings(page: Page): Promise<Locator> {
  await page
    .getByRole('region', { name: 'Channel' })
    .getByRole('button', { name: 'Settings' })
    .click();
  return page.getByRole('dialog', { name: 'Channel settings' });
}

/** A read-only dialog: the settings as text, nothing to edit, and Close. */
async function expectReadOnly(dialog: Locator, description: string): Promise<void> {
  await expect(dialog.getByText(description)).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Make Private…' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
}

// "Owners" is Private. Jordi is its Channel admin and Laura a member.
test('a member who is not a Channel admin reads the settings, and can Leave', async ({ page }) => {
  await signIn(page, 'laura.gomez@example.com');
  await page.goto(`/channels/${SEED.owners}`);
  const bar = page.getByRole('region', { name: 'Channel' });
  await expect(bar.getByRole('heading', { name: 'Owners' })).toBeVisible();
  // The description, Archive and Leave are in the dialog, not the bar.
  await expect(bar.getByText('Contracts and budgets. Owners only.')).toHaveCount(0);
  await expect(bar.getByRole('button', { name: /Leave|Archive/ })).toHaveCount(0);

  const dialog = await openSettings(page);
  await expectReadOnly(dialog, 'Contracts and budgets. Owners only.');
  await expect(dialog.getByText('Only its Channel admins can change these.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Leave…' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Archive…' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
});

// "Teaching" is Public, and Pablo isn't in it.
test('a Staff member reading a Public channel they haven’t joined reads its settings', async ({
  page,
}) => {
  await signIn(page, 'pablo.serra@example.com');
  await page.goto(`/channels/${SEED.teaching}`);
  const bar = page.getByRole('region', { name: 'Channel' });
  await expect(bar.getByRole('button', { name: 'Join' })).toBeVisible();

  const dialog = await openSettings(page);
  await expectReadOnly(dialog, 'Timetables, cover and course materials.');
  await expect(dialog.getByRole('region', { name: 'Channel actions' })).toHaveCount(0);
});

test('a Channel admin edits the settings, and archives, unarchives and tries to leave from them', async ({
  page,
}) => {
  const name = `Rota ${test.info().project.name} ${Date.now()}`;
  await signIn(page, 'pablo.serra@example.com');
  await page.getByRole('button', { name: 'Create channel' }).click();
  const create = page.getByRole('dialog', { name: 'Create a Channel' });
  await create.getByLabel('Name').fill(name);
  await create.getByRole('button', { name: 'Create channel' }).click();

  const bar = page.getByRole('region', { name: 'Channel' });
  await expect(bar.getByRole('heading', { name })).toBeVisible();
  // The Thread list controls share the tabs' row, on the Threads tab only.
  await expect(bar.getByRole('button', { name: /^Status:/ })).toBeVisible();
  await bar.getByRole('link', { name: 'Members' }).click();
  await expect(bar.getByRole('button', { name: /^Status:/ })).toHaveCount(0);

  // Edit and save the description: it shows in the dialog, not the bar.
  let dialog = await openSettings(page);
  await dialog.getByLabel('Description').fill('Who covers which shift.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(bar.getByText('Who covers which shift.')).toHaveCount(0);
  dialog = await openSettings(page);
  await expect(dialog.getByLabel('Description')).toHaveValue('Who covers which shift.');

  // The only member can't leave: the server says why.
  await dialog.getByRole('button', { name: 'Leave…' }).click();
  const leave = page.getByRole('dialog', { name: `Leave ${name}?` });
  await leave.getByRole('button', { name: 'Leave' }).click();
  await expect(leave.getByRole('alert')).toHaveText(/^You’re the only member of this Channel\./);
  await leave.getByRole('button', { name: 'Cancel' }).click();

  // Cancel returns to the settings; Archive closes them once it's done.
  dialog = page.getByRole('dialog', { name: 'Channel settings' });
  await dialog.getByRole('button', { name: 'Archive…' }).click();
  await page
    .getByRole('dialog', { name: `Archive ${name}?` })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(bar.getByText(/^Archived: you can read it/)).toBeVisible();

  // An Archived channel's settings are read-only, even for its Channel admin.
  dialog = await openSettings(page);
  await expectReadOnly(dialog, 'Who covers which shift.');
  await dialog.getByRole('button', { name: 'Unarchive' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(bar.getByText(/^Archived: you can read it/)).toHaveCount(0);
});
