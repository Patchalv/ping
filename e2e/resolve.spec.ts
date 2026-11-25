import { expect, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

// From "Resolved Thread improvements" (#113).
test('a member resolves a Thread, responds without reopening it, and reopens it', async ({
  page,
}) => {
  // Laptop and phone share the database, so each run's Thread has its own title.
  const title = `Projector ${test.info().project.name} ${Date.now()}`;
  await signIn(page, 'jordi.puig@example.com');
  await page.goto(`/channels/${SEED.frontDesk}`);
  await page.getByRole('button', { name: 'New Thread' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Thread' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Start Thread' }).click();
  await expect(dialog).toBeHidden();

  const panel = page.getByRole('region', { name: title });
  const row = page
    .getByRole('region', { name: 'Threads' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });
  const strip = panel.getByText(/^Resolved by Jordi Puig · /);
  const note = panel.getByText('This Thread is Resolved. Your Thread Response won’t reopen it.');

  // Resolve: the header button gives way to the strip, which says who resolved it.
  await panel.getByRole('button', { name: 'Resolve' }).click();
  await expect(strip).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
  await expect(note).toBeVisible();
  // The Channel's Thread list shows open Threads by default.
  await expect(row).toHaveCount(0);

  // A Thread Response leaves it Resolved.
  await panel.getByRole('textbox', { name: 'Thread Response' }).click();
  await page.keyboard.type('Fixed the cable.');
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(
    panel.getByRole('region', { name: 'Thread Responses' }).getByText('Fixed the cable.'),
  ).toBeVisible();
  await expect(strip).toBeVisible();

  // Reopen: the strip and the note go, Resolve returns, and the row is listed again.
  await panel.getByRole('button', { name: 'Reopen' }).click();
  await expect(panel.getByRole('button', { name: 'Resolve' })).toBeVisible();
  await expect(strip).toHaveCount(0);
  await expect(note).toHaveCount(0);
  await expect(row.getByRole('heading', { name: title })).toBeVisible();
});
