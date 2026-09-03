import { test as base, expect, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serveStatic } from './staticServer';
import { copySite } from './deploy';

const DIST = resolve(import.meta.dirname, '..', '..', 'dist');

export interface Site {
  /** Origin the built app is being served from. */
  readonly url: string;
  /** The served directory — a private copy, so a test may deploy over it. */
  readonly root: string;
}

/**
 * Every spec gets the built site on its own origin, from its own copy of
 * `dist/`. Separate origins matter as much as separate directories here: a
 * service worker, its caches and IndexedDB are all keyed by origin, so sharing
 * one would let a spec inherit another's worker.
 */
export const test = base.extend<{ site: Site }>({
  // Playwright insists the first parameter be a destructuring pattern, and this
  // fixture takes nothing from it. `provide` is Playwright's `use`, renamed
  // because a bare `use` reads as a React hook to the linter.
  // eslint-disable-next-line no-empty-pattern
  site: async ({}, provide) => {
    const workDir = mkdtempSync(join(tmpdir(), 'timedoco-e2e-'));
    const root = copySite(DIST, join(workDir, 'site'));
    const server = await serveStatic(root);
    await provide({ url: server.url, root });
    await server.close();
    rmSync(workDir, { recursive: true, force: true });
  },
});

export { expect };

export const openApp = async (page: Page, site: Site) => {
  await page.goto(`${site.url}/app/`);
  await expect(page.getByRole('button', { name: 'Analysis' })).toBeVisible();
};

/**
 * Put the page in the state a returning visit is in: a worker that has finished
 * installing, and a document it is actually serving. Nothing claims clients, so
 * the load that registers the worker is never the load it controls.
 */
export const loadUnderServiceWorkerControl = async (page: Page) => {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 15_000 });
};

/** The update check a returning tab makes on its own, without waiting for one. */
export const checkForServiceWorkerUpdate = async (page: Page) => {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
};
