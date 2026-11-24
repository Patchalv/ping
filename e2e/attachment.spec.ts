import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

/** The stripper's fixtures: each image carries Exif GPS, XMP and a comment. */
const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../apps/server/src/features/attachment/fixtures/${name}`, import.meta.url),
  );

/** Another Staff member, signed in in their own browser context with their own address. */
async function signedInAs(browser: Browser, email: string, octet: number): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'fly-client-ip': `198.51.100.${octet}` },
  });
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

test('an Attachment round trip: attach while writing, then open it as another member', async ({
  page,
  browser,
}) => {
  const title = `Heater photos ${test.info().project.name} ${Date.now()}`;
  await signIn(page, 'jordi.puig@example.com');
  await page.goto(`/channels/${SEED.frontDesk}`);
  await page.getByRole('button', { name: 'New Thread' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Thread' });
  await dialog.getByLabel('Title').fill(title);

  // Picked while writing: four images and a file, each sent with progress.
  await dialog
    .locator('input[type=file]')
    .setInputFiles([
      fixture('with-metadata.jpg'),
      fixture('with-metadata.png'),
      fixture('with-metadata.webp'),
      fixture('with-metadata.gif'),
      fixture('README.md'),
    ]);
  const picked = dialog.getByRole('list', { name: 'Attachments' });
  // README.md isn't an allowed type: refused in the composer, and removable.
  await expect(
    picked.getByText('Ping can’t take this kind of file.', { exact: false }),
  ).toBeVisible();
  await picked.getByRole('button', { name: 'Remove README.md' }).click();
  await expect(picked.getByRole('listitem')).toHaveCount(4);
  await expect(picked.getByRole('progressbar')).toHaveCount(0);
  await expect(picked.locator('img')).toHaveCount(4);

  await dialog.getByRole('button', { name: 'Start Thread' }).click();
  await expect(dialog).toBeHidden();
  const panel = page.getByRole('region', { name: title });
  await expect(panel.getByRole('list', { name: 'Images' }).getByRole('img')).toHaveCount(4);

  // The Thread row shows the first three and how many more.
  const row = page
    .getByRole('region', { name: 'Threads' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title }) });
  await expect(row.getByText('+1 more')).toBeVisible();

  // Editing the Thread adds a fifth; the picker counts the four already there.
  await panel.getByRole('button', { name: 'Thread actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Thread' });
  await editDialog.locator('input[type=file]').setInputFiles({
    name: 'rota.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,room\nMarta,2\n'),
  });
  await expect(editDialog.getByText('rota.csv')).toBeVisible();
  await expect(editDialog.getByRole('button', { name: 'Attach files' })).toBeDisabled();
  await expect(editDialog.getByRole('progressbar')).toHaveCount(0);
  await editDialog.getByRole('button', { name: 'Save' }).click();
  await expect(editDialog).toBeHidden();
  await expect(panel.getByRole('list', { name: 'Files' }).getByText('rota.csv')).toBeVisible();

  // Another member opens the Thread: every image decodes in the browser, after the server
  // stripped it, served from object storage through a signed link.
  const laura = await signedInAs(browser, 'laura.gomez@example.com', 21);
  await laura.goto(page.url());
  const images = laura.getByRole('region', { name: title }).getByRole('list', { name: 'Images' });
  await expect(images.getByRole('img')).toHaveCount(4);
  for (const image of await images.getByRole('img').all()) {
    await expect
      .poll(() => image.evaluate((element) => (element as { naturalWidth?: number }).naturalWidth))
      .toBeGreaterThan(0);
  }

  // What storage serves carries none of the metadata.
  const links = await Promise.all(
    (await images.getByRole('link').all()).map((link) => link.getAttribute('href')),
  );
  for (const link of links) {
    const response = await laura.request.get(link ?? '');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-disposition']).toMatch(/^inline;/);
    const body = await response.body();
    for (const trace of ['Exif', 'PingTestCamera', 'xmpmeta', 'Ping test comment']) {
      expect(body.includes(trace)).toBe(false);
    }
  }
  await laura.context().close();
});
