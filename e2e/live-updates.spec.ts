import { expect, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

test('a second Staff member receives a Ping over the stream, and Acknowledging clears it', async ({
  page,
  browser,
}, testInfo) => {
  // Laura reads her Pings in a browser of her own, with its own client IP.
  const lauraContext = await browser.newContext({
    ...testInfo.project.use,
    extraHTTPHeaders: { 'fly-client-ip': `10.1.${testInfo.workerIndex % 250}.${Date.now() % 250}` },
  });
  const laura = await lauraContext.newPage();
  await signIn(laura, 'laura.gomez@example.com');
  // The stream opens with the page: wait for it, so the Ping can only reach her through it.
  const streamOpened = laura.waitForResponse(
    (res) => res.url().endsWith('/api/live') && res.status() === 200,
  );
  await laura.goto('/pings');
  await expect(laura.getByRole('heading', { name: 'Pings' })).toBeVisible();
  await streamOpened;

  // Jordi starts a Thread in Teaching, which Laura is in: it Pings her.
  const title = `Live ${testInfo.project.name} ${Date.now()}`;
  await signIn(page, 'jordi.puig@example.com');
  await page.goto(`/channels/${SEED.teaching}`);
  await page.getByRole('button', { name: 'New Thread' }).click();
  const dialog = page.getByRole('dialog', { name: 'New Thread' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Start Thread' }).click();
  await expect(dialog).toBeHidden();

  // It appears on Laura's open Pings view without a reload.
  const row = laura
    .getByRole('listitem')
    .filter({ has: laura.getByRole('heading', { name: title }) });
  await expect(row).toBeVisible();

  // Acknowledging clears it.
  await row.getByRole('button', { name: `Mark ${title} read` }).click();
  await expect(row).toBeHidden();

  await lauraContext.close();
});
