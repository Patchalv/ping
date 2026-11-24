import { expect, type Page, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

/** A word no other run uses: letters only, so stemming leaves it alone. */
const uniqueWord = () =>
  `lantern${Date.now()
    .toString()
    .replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)] ?? 'a')}${test.info().project.name}`;

const channelUrl = `/channels/${SEED.frontDesk}`;

async function startThread(page: Page, title: string) {
  await page.goto(channelUrl);
  await page.getByRole('button', { name: 'New Thread' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Thread' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('textbox', { name: 'Description' }).click();
  await page.keyboard.type('Found by the search dialog');
  await dialog.getByRole('button', { name: 'Start Thread' }).click();
  await expect(dialog).toBeHidden();
}

/** Opens the search dialog the way each size offers: the bar on a laptop, the icon on a phone. */
async function openSearch(page: Page) {
  if (test.info().project.name === 'phone') {
    await page.getByRole('button', { name: 'Search' }).click();
  } else {
    await page.getByRole('searchbox', { name: 'Search' }).click();
  }
  const input = page.getByRole('combobox', { name: 'Search Channels and Threads' });
  await expect(input).toBeFocused();
  return input;
}

test('the search dialog opens a Thread over the Channel, and Back returns to it', async ({
  page,
}) => {
  const word = uniqueWord();
  const title = `Broken ${word}`;
  await signIn(page, 'jordi.puig@example.com');
  await startThread(page, title);
  await page.goto(channelUrl);

  const input = await openSearch(page);
  await input.fill(word);
  // Opened from a Channel, it offers to narrow to it.
  await expect(page.getByRole('option', { name: /Only in #Front desk/ })).toBeVisible();
  const result = page.getByRole('option', { name: new RegExp(title) });
  await expect(result).toBeVisible();
  // Typing never changes the route.
  await expect(page).toHaveURL(new RegExp(`${channelUrl}$`));

  await result.click();
  await expect(page).toHaveURL(new RegExp(`${channelUrl}/threads/[0-9a-f-]{36}$`));
  await expect(page.getByRole('region', { name: title })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${channelUrl}$`));
});

test('Enter opens every result, and the × returns to the Channel', async ({ page }) => {
  const word = uniqueWord();
  const title = `Cold ${word}`;
  await signIn(page, 'jordi.puig@example.com');
  await startThread(page, title);
  await page.goto(channelUrl);

  const input = await openSearch(page);
  await input.fill(word);
  await expect(page.getByRole('option', { name: new RegExp(title) })).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${word}`));
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page).toHaveURL(new RegExp(`${channelUrl}$`));
  await expect(page.getByRole('heading', { name: 'Front desk' })).toBeVisible();

  // The dialog reopens with the last text selected, so typing replaces it.
  const again = await openSearch(page);
  await expect(again).toHaveValue(word);
  await page.keyboard.type('x');
  await expect(again).toHaveValue('x');
});
