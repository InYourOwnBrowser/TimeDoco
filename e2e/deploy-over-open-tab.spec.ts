import { test, expect, openApp, loadUnderServiceWorkerControl, checkForServiceWorkerUpdate } from './support/fixtures';
import { redeployChunk, removeChunk } from './support/deploy';

/**
 * Flow 5: a deploy lands while a tab is open.
 *
 * Every piece of this app is correct on its own; the failure only exists in the
 * sequence. A tab loads, holding the names of that build's hashed chunks. A
 * deploy replaces them. The tab then navigates to a code-split route, asks for
 * a file the origin no longer serves, and the dynamic import rejects — which
 * `React.lazy` turns into a thrown error and the ErrorBoundary turns into an
 * error screen, in the middle of what the user was doing.
 *
 * Nothing about that is hypothetical: it fires on the first deploy after the
 * app has users, for everyone with it open. The tab most exposed to it is the
 * one a worker is not yet serving — every first visit, for its whole session.
 */

test('an open tab still reaches a code-split route after the chunk it knows is redeployed', async ({ page, site }) => {
  await openApp(page, site);

  redeployChunk(site.root, 'AnalysisView');

  await page.getByRole('button', { name: 'Analysis' }).click();

  // Recovered, and on the tab that was clicked rather than back at the start.
  await expect(page.getByRole('heading', { name: 'Analysis & Reports' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('a tab the service worker controls is not left holding a purged chunk', async ({ page, site }) => {
  await openApp(page, site);
  await loadUnderServiceWorkerControl(page);
  await expect(page.getByRole('button', { name: 'Analysis' })).toBeVisible();

  redeployChunk(site.root, 'AnalysisView');
  await checkForServiceWorkerUpdate(page);

  await page.getByRole('button', { name: 'Analysis' }).click();

  // The update installs, but nothing activates it, so this build's precache is
  // still intact and still serving the chunk names this page is holding.
  await expect(page.getByRole('heading', { name: 'Analysis & Reports' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('a chunk that stays missing gets one reload, then the error screen', async ({ page, site }) => {
  await openApp(page, site);

  let loads = 0;
  page.on('load', () => { loads += 1; });

  // No replacement is deployed, so the reload asks for the same missing file.
  removeChunk(site.root, 'AnalysisView');

  await page.getByRole('button', { name: 'Analysis' }).click();

  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('updated while this tab was open')).toBeVisible();
  // One recovery reload, and no second one: a build that is actually broken has
  // to stop and say so rather than cycle.
  await expect.poll(() => loads, { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(2_000);
  expect(loads).toBe(1);
});
