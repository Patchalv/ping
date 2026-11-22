import { type Browser, expect, type Page, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

/** Another Staff member, signed in in their own browser context with their own address. */
async function signedInAs(browser: Browser, email: string, octet: number): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'fly-client-ip': `198.51.100.${octet}` },
  });
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

/** Starts a Thread in Front desk through the composer and returns its panel. */
async function startThread(page: Page, title: string) {
  await page.goto(`/channels/${SEED.frontDesk}`);
  await page.getByRole('button', { name: 'New Thread' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Thread' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Start Thread' }).click();
  await expect(dialog).toBeHidden();
  return page.getByRole('region', { name: title });
}

async function sendThreadResponse(page: Page, panel: ReturnType<Page['getByRole']>, text: string) {
  await panel.getByRole('textbox', { name: 'Thread Response' }).click();
  await page.keyboard.type(text);
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(
    panel.getByRole('region', { name: 'Thread Responses' }).getByText(text),
  ).toBeVisible();
}

test('a member sends, edits and deletes their own Thread Response', async ({ page }) => {
  const title = `Plumber ${test.info().project.name} ${Date.now()}`;
  await signIn(page, 'jordi.puig@example.com');
  const panel = await startThread(page, title);

  // An empty Thread Response is caught, shown on the editor and focused.
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.getByText('Write something before sending.')).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Thread Response' })).toBeFocused();

  await page.keyboard.type('Booked for 3pm.');
  await panel.getByRole('button', { name: 'Send' }).click();
  const responses = panel.getByRole('region', { name: 'Thread Responses' });
  await expect(responses.getByText('Booked for 3pm.')).toBeVisible();
  // The composer starts again empty.
  await expect(panel.getByRole('textbox', { name: 'Thread Response' })).toHaveText('');

  // The row counts it.
  const row = page
    .getByRole('region', { name: 'Threads' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });
  await expect(row.getByText('1 Thread Response')).toBeVisible();

  // Edit: marked "edited".
  await responses.getByRole('button', { name: 'Thread Response actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await responses.getByRole('textbox', { name: 'Edit Thread Response' }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Booked for 4pm.');
  await responses.getByRole('button', { name: 'Save' }).click();
  await expect(responses.getByText('Booked for 4pm.')).toBeVisible();
  await expect(responses.getByText('edited', { exact: true })).toBeVisible();

  // Delete: a placeholder stays.
  await responses.getByRole('button', { name: 'Thread Response actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this Thread Response?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(responses.getByText('Thread Response deleted')).toBeVisible();
  await expect(responses.getByText('Booked for 4pm.')).toHaveCount(0);
});

test('a company Admin’s edit reads "edited by", and deleting a Thread counts other people’s Thread Responses', async ({
  page,
  browser,
}) => {
  const title = `Heater ${test.info().project.name} ${Date.now()}`;
  const octet = test.info().project.name === 'phone' ? 20 : 10;
  await signIn(page, 'jordi.puig@example.com');
  await startThread(page, title);
  const threadUrl = page.url();

  // Laura, another member, responds.
  const laura = await signedInAs(browser, 'laura.gomez@example.com', octet);
  await laura.goto(threadUrl);
  await sendThreadResponse(laura, laura.getByRole('region', { name: title }), 'I can let them in.');
  // She can't edit or delete Jordi's Thread.
  await expect(
    laura.getByRole('region', { name: title }).getByRole('button', { name: 'Thread actions' }),
  ).toHaveCount(0);

  // Marta, a company Admin, edits Laura's Thread Response.
  const marta = await signedInAs(browser, 'marta.ruiz@example.com', octet + 1);
  await marta.goto(threadUrl);
  const responses = marta
    .getByRole('region', { name: title })
    .getByRole('region', { name: 'Thread Responses' });
  await responses.getByRole('button', { name: 'Thread Response actions' }).click();
  await marta.getByRole('menuitem', { name: 'Edit' }).click();
  await responses.getByRole('textbox', { name: 'Edit Thread Response' }).click();
  await marta.keyboard.press('End');
  await marta.keyboard.type(' After 3pm.');
  await responses.getByRole('button', { name: 'Save' }).click();
  await expect(responses.getByText('edited by Marta Ruiz')).toBeVisible();

  // Jordi deletes his Thread: the confirmation says one of other people's goes with it.
  await page.reload();
  const panel = page.getByRole('region', { name: title });
  await panel.getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this Thread?' });
  await expect(
    confirm.getByText('This also deletes 1 Thread Response by other people.'),
  ).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(new RegExp(`/channels/${SEED.frontDesk}$`));
  await expect(page.getByRole('heading', { name: title })).toHaveCount(0);

  // It's gone for Laura too.
  await laura.reload();
  await expect(laura.getByText('Thread not found')).toBeVisible();
});

test('the author edits a Thread’s title and description', async ({ page }) => {
  const title = `Projector ${test.info().project.name} ${Date.now()}`;
  await signIn(page, 'laura.gomez@example.com');
  const panel = await startThread(page, title);
  await panel.getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Thread' });
  await dialog.getByLabel('Title').fill(`${title} (fixed)`);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const edited = page.getByRole('region', { name: `${title} (fixed)` });
  await expect(edited.getByRole('heading', { name: `${title} (fixed)` })).toBeVisible();
  await expect(edited.getByText('edited', { exact: true })).toBeVisible();
});
