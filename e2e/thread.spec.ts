import { expect, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

test('a member starts a Thread with formatting, and it opens beside the feed', async ({ page }) => {
  // Laptop and phone share the database, so each run's Thread has its own title.
  const title = `Heater broken ${test.info().project.name} ${Date.now()}`;
  await signIn(page, 'jordi.puig@example.com');
  await page.goto(`/channels/${SEED.frontDesk}`);
  await page.getByRole('button', { name: 'New Thread' }).click();

  const dialog = page.getByRole('dialog', { name: 'New Thread' });
  // A missing title is caught on submit, shown on the field and focused.
  await dialog.getByRole('button', { name: 'Start Thread' }).click();
  await expect(dialog.getByText('Give the Thread a title.')).toBeVisible();
  await expect(dialog.getByLabel('Title')).toBeFocused();

  await dialog.getByLabel('Title').fill(title);
  const description = dialog.getByRole('textbox', { name: 'Description' });
  await description.click();
  // The toolbar, so what the editor emits goes through the server's allowlist.
  const toolbar = dialog.getByRole('toolbar', { name: 'Formatting' });
  await toolbar.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type('Room 2 is cold');
  await toolbar.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.press('Enter');
  await toolbar.getByRole('button', { name: 'Bulleted list' }).click();
  await page.keyboard.type('Call the plumber');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Heating docs');
  await page.keyboard.press('Shift+Home');
  await toolbar.getByRole('button', { name: 'Link' }).click();
  await dialog.getByLabel('Link address').fill('example.com/heating');
  await dialog.getByLabel('Link address').press('Enter');
  await dialog.getByRole('button', { name: 'Start Thread' }).click();

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/channels/${SEED.frontDesk}/threads/[0-9a-f-]{36}$`));
  const panel = page.getByRole('region', { name: title });
  await expect(panel.getByRole('heading', { name: title })).toBeVisible();
  await expect(panel.locator('strong', { hasText: 'Room 2 is cold' })).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: 'Call the plumber' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Heating docs' })).toHaveAttribute(
    'href',
    'https://example.com/heating',
  );

  // The feed lists it, with its author and a preview.
  await page.goto(`/channels/${SEED.frontDesk}`);
  // By title: the other project's run may have started a newer one.
  const row = page
    .getByRole('region', { name: 'Threads' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });
  await expect(row.getByRole('heading', { name: title })).toBeVisible();
  await expect(row.getByText('Jordi Puig')).toBeVisible();
  await expect(row.getByText('Room 2 is cold Call the plumber Heating docs')).toBeVisible();

  // Opening it again from the row.
  await row.getByRole('link').click();
  await expect(page.getByRole('region', { name: title })).toBeVisible();
});

test('a Staff member reading a Public channel they haven’t joined sees Join, not New Thread', async ({
  page,
}) => {
  // Marta isn't in Teaching.
  await signIn(page, 'marta.ruiz@example.com');
  await page.goto(`/channels/${SEED.teaching}`);
  const bar = page.getByRole('region', { name: 'Channel' });
  await expect(bar.getByRole('button', { name: 'Join' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'New Thread' })).toHaveCount(0);
});

test('a description over the limit is shown on the editor, which takes focus', async ({ page }) => {
  await signIn(page, 'jordi.puig@example.com');
  await page.goto(`/channels/${SEED.frontDesk}`);
  await page.getByRole('button', { name: 'New Thread' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Thread' });
  await dialog.getByLabel('Title').fill('Too long');
  const description = dialog.getByRole('textbox', { name: 'Description' });
  await description.click();
  // Typing 20,001 characters would be slow; the editor's own insert is the same edit.
  await description.evaluate((element) => {
    // TipTap puts its editor on the editable element.
    const { editor } = element as unknown as {
      editor: { commands: { insertContent(text: string): void } };
    };
    editor.commands.insertContent('x'.repeat(20_001));
  });
  await dialog.getByLabel('Title').focus();
  await dialog.getByRole('button', { name: 'Start Thread' }).click();
  await expect(dialog.getByText('Keep the text to 20,000 characters or fewer.')).toBeVisible();
  await expect(description).toBeFocused();
});

test('an unsent new Thread is kept as a draft, and cleared once started', async ({ page }) => {
  const title = `Draft ${test.info().project.name} ${Date.now()}`;
  await signIn(page, 'laura.gomez@example.com');
  await page.goto(`/channels/${SEED.teaching}`);
  await page.getByRole('button', { name: 'New Thread' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Thread' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('textbox', { name: 'Description' }).click();
  await page.keyboard.type('Bring the projector back.');
  // The draft saves after a short pause in typing.
  await page.waitForTimeout(600);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.reload();
  await page.getByRole('button', { name: 'New Thread' }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue(title);
  await expect(dialog.getByText('Bring the projector back.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Start Thread' }).click();
  await expect(page.getByRole('region', { name: title })).toBeVisible();

  await page.goto(`/channels/${SEED.teaching}`);
  await page.getByRole('button', { name: 'New Thread' }).click();
  await expect(dialog.getByLabel('Title')).toHaveValue('');
});
