import { expect, test } from '@playwright/test';
import { SEED, signIn, useOwnClientIp } from './support';

useOwnClientIp();

test('the logo returns to Home, which counts Pings and Saved Threads on a laptop', async ({
  page,
}) => {
  await signIn(page, 'laura.gomez@example.com');
  await page.goto(`/channels/${SEED.frontDesk}`);
  await page.getByRole('link', { name: 'Ping home' }).click();
  await expect(page).toHaveURL('/');

  // On a phone, Home is the sidebar; the counts are the laptop's main area.
  if (test.info().project.name === 'phone') return;
  const home = page.getByRole('main');
  await expect(home.getByRole('link', { name: /Pings$/ })).toHaveAttribute('href', '/pings');
  const saved = home.getByRole('link', { name: /Saved$/ });
  await expect(saved).toHaveAttribute('href', '/saved');
  await saved.click();
  await expect(page).toHaveURL('/saved');
});
