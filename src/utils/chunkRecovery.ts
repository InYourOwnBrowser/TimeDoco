import { lazy } from 'react';
import { flushDeferredWrites } from '../hooks/useDeferredWrite';

/**
 * Recovery from a code-split chunk that is no longer being served.
 *
 * The app splits four routes out of the main bundle, and each import asks for a
 * file named after that build's content hash. Deploy while a tab is open and
 * those names stop resolving: the origin serves the new build, the running page
 * still holds the old names, and the first click on Analysis, Timesheet,
 * Management or Resources rejects. `React.lazy` turns the rejection into a
 * thrown error and the ErrorBoundary turns that into an error screen — over a
 * missing file the next load would have fetched correctly.
 *
 * So reload, once. The guard below is what keeps "once" honest: a build that is
 * genuinely broken must show the error screen rather than reload forever. It is
 * set when a reload is triggered and cleared only when a chunk actually loads,
 * which is the one unambiguous signal that the page is on a working build.
 */

const RELOAD_GUARD_KEY = 'timedoco.reloadedForChunk';

/**
 * The message differs per engine, and none of them is a typed error: Chromium
 * says "Failed to fetch dynamically imported module", Firefox "error loading
 * dynamically imported module", Safari "Importing a module script failed".
 * Vite's own preload helper adds the CSS variant.
 */
const STALE_CHUNK = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export const isStaleChunkError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return STALE_CHUNK.test(message);
};

// Storage access throws outright in some privacy modes, and a failure to read
// the guard must not become a second error on top of the one being handled.
const readGuard = (): boolean => {
  try {
    return sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
  } catch {
    return false;
  }
};

const writeGuard = (value: '1' | null): void => {
  try {
    if (value === null) sessionStorage.removeItem(RELOAD_GUARD_KEY);
    else sessionStorage.setItem(RELOAD_GUARD_KEY, value);
  } catch {
    // Without storage there is no guard, and a reload loop is worse than an
    // error screen, so the caller treats an unwritable guard as already set.
  }
};

let recoveryReloadInFlight = false;

/**
 * Whether the app itself is reloading to recover from a stale chunk.
 *
 * The running-timer `beforeunload` guard asks: it exists to catch a user
 * closing the tab on a timer, and a recovery reload is neither of those things.
 * Without this the silent recovery surfaced a "Leave site?" modal, and choosing
 * Stay left the guard already spent — so the automatic path would not try again
 * for the rest of the session, over a file the next load would have fetched.
 */
export const isRecoveryReloadInFlight = (): boolean => recoveryReloadInFlight;

/**
 * How long the reload will wait on pending writes before going ahead anyway. A
 * write that never settles must not leave the user stranded on the error
 * screen, which is the thing the reload is there to clear.
 */
const FLUSH_BUDGET_MS = 500;

/**
 * Reload for a chunk the origin no longer has, at most once per failure run.
 * Returns whether a reload was started — the caller has nothing left to do if
 * it was.
 *
 * Returns synchronously; the reload itself happens once pending writes have
 * settled, or once the budget above runs out.
 */
export const reloadOnceForStaleChunk = (error: unknown): boolean => {
  if (!isStaleChunkError(error)) return false;
  if (readGuard()) return false;

  writeGuard('1');
  // An unwritable guard means the next failure would reload again, and the one
  // after that, so don't start the cycle at all.
  if (!readGuard()) return false;

  recoveryReloadInFlight = true;

  // React runs no effect cleanup for a reload, so every debounced draft still
  // in flight would go down with the page — the one loss `useDeferredWrite`
  // cannot prevent from inside itself. This is a reload the app chose, so it
  // can flush first and wait, unlike one the user triggers.
  void Promise.race([
    Promise.allSettled(flushDeferredWrites()),
    new Promise((resolve) => window.setTimeout(resolve, FLUSH_BUDGET_MS)),
  ]).then(() => window.location.reload());

  return true;
};

/** A chunk loaded, so the page is on a build whose chunks exist. */
export const noteChunkLoaded = (): void => writeGuard(null);

/**
 * Whether this page load is the one the recovery above started. True only
 * between the reload and the next chunk arriving, which is the window in which
 * the app can put the user back where the failure interrupted them: a reload
 * that lands them on a different screen than the one they clicked is a fix they
 * still have to notice and undo.
 */
export const wasStaleChunkReload = (): boolean => readGuard();

/**
 * `React.lazy`, plus the report that the chunk arrived. Every code-split route
 * goes through this so the guard is cleared by the app working, rather than by
 * a timer or by a mount that has not actually loaded anything.
 */
export const lazyChunk: typeof lazy = (load) =>
  lazy(() =>
    load().then((module) => {
      noteChunkLoaded();
      return module;
    }),
  );
