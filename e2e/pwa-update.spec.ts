import { test, expect, openApp, loadUnderServiceWorkerControl, checkForServiceWorkerUpdate } from './support/fixtures';
import { redeployAsset } from './support/deploy';

/**
 * An update has to be both offered and refusable.
 *
 * Before this, registration was a bare `register()` call with no update
 * handling at all: a new worker installed, waited, and was applied only once
 * every tab had been closed — which for an installed PWA can be never. Applying
 * it automatically is the opposite failure, since a reload nobody asked for can
 * land inside a `SettingField` debounce and take the edit with it.
 */

const banner = 'A new version of TimeDoco is ready.';
const marker = '<meta name="e2e-build" content="2" />';

const deployNewBuild = (root: string) =>
  redeployAsset(root, 'app/index.html', (html) => html.replace('</head>', `${marker}</head>`));

const buildMarkerCount = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.querySelectorAll('meta[name="e2e-build"]').length);

test('an installed update is offered rather than applied', async ({ page, site }) => {
  await openApp(page, site);
  await loadUnderServiceWorkerControl(page);
  await expect(page.getByText(banner)).toHaveCount(0);

  deployNewBuild(site.root);
  await checkForServiceWorkerUpdate(page);

  await expect(page.getByText(banner)).toBeVisible({ timeout: 20_000 });
  // Offered, not applied: this document is still the one it loaded with.
  expect(await buildMarkerCount(page)).toBe(0);

  // Declining leaves the running build alone — the notice goes away and the app
  // keeps working on the version it started on.
  await page.getByRole('button', { name: 'Dismiss update notice' }).click();
  await expect(page.getByText(banner)).toHaveCount(0);
  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Analysis & Reports' })).toBeVisible({ timeout: 20_000 });
  expect(await buildMarkerCount(page)).toBe(0);
});

test('accepting the update applies it and reloads into the new build', async ({ page, site }) => {
  await openApp(page, site);
  await loadUnderServiceWorkerControl(page);

  deployNewBuild(site.root);
  await checkForServiceWorkerUpdate(page);
  await expect(page.getByText(banner)).toBeVisible({ timeout: 20_000 });

  // A marker on the document this page is running, so the wait below is for the
  // reload actually happening rather than for a state the page was already in.
  await page.evaluate(() => Object.assign(window, { __beforeUpdate: true }));
  await page.getByRole('button', { name: 'Reload' }).click();
  await page.waitForFunction(() => !('__beforeUpdate' in window), null, { timeout: 20_000 });

  await page.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Analysis' })).toBeVisible();
  await expect(page.getByText(banner)).toHaveCount(0);
  // The worker that took over is serving the new build, not the old precache.
  expect(await buildMarkerCount(page)).toBe(1);
});
