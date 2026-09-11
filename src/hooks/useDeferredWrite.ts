import { useCallback, useEffect, useRef } from 'react';

/**
 * A write that waits for the user to stop typing, and is never dropped.
 *
 * The hand-rolled version of this is a `setTimeout` in an effect whose cleanup
 * calls `clearTimeout`, and that cleanup runs on unmount — so leaving the
 * screen silently cancels the write instead of performing it. Up to a debounce
 * of typing disappears, and nothing on screen says so.
 *
 * Unmount is the case this closes. The document going away is the other: React
 * runs no effect cleanup for that, so a pending write would go down with the
 * page. Two things cover it. A reload the *app itself* starts waits for
 * `settleDeferredWrites` first — the stale-chunk recovery and the service
 * worker update both do. Everything else the browser decides — closing the tab,
 * the user's own reload, switching away on a phone, the OS reclaiming the page
 * — is covered by the safety net below, which commits on the last events that
 * are guaranteed to run.
 *
 * Every part of that is in here rather than in each field: scheduling replaces
 * the pending write, `flush` performs it now for a blur or an Enter, and
 * unmounting flushes rather than clears. A field built on this cannot drop a
 * write however it is used, which is the point — the same class was already
 * fixed once in `SettingField` and then written by hand again next door.
 *
 * `flush` returns whatever the write returned, so a caller that must not race
 * it — stopping the timer the note belongs to — can await it.
 */
/**
 * Every mounted `useDeferredWrite`'s flush.
 *
 * A module-level registry rather than a context: the one caller is the
 * stale-chunk recovery, which runs from an error boundary outside any provider
 * a field of this kind sits under.
 */
const mountedFlushes = new Set<() => unknown>();

/**
 * Flush every pending deferred write now, returning what each produced so the
 * caller can wait for them. Used before a reload the app starts itself, where
 * effect cleanup does not run.
 */
export const flushDeferredWrites = (): unknown[] =>
  // Copied first: a write may unmount the field it belongs to, which would
  // otherwise mutate the set mid-iteration.
  [...mountedFlushes].map((flush) => {
    try {
      return flush();
    } catch (error) {
      // One field throwing must not abandon the fields after it in the
      // registry. Every caller of this is a last chance — a page going away, or
      // a reload about to replace it — so the others still have to be written.
      // Returned as a rejection so `settleDeferredWrites` accounts for it the
      // same way it accounts for an asynchronous failure; a synchronous throw
      // escaped `Promise.allSettled` entirely and took the whole flush with it.
      return Promise.reject(error);
    }
  });

/**
 * How long a reload will wait on pending writes before going ahead anyway. A
 * write that never settles must not strand the user on whatever screen the
 * reload was there to clear.
 */
export const FLUSH_BUDGET_MS = 500;

/**
 * Flush every pending deferred write and wait for them, up to a budget.
 *
 * The one thing an app-initiated reload has to do before it reloads, and it
 * lives here — beside the registry — rather than at each caller. There are two
 * such reloads: the stale-chunk recovery, and accepting a service worker
 * update. Only the first ever did this. The second reloads out from under a
 * debounce window while its own banner says "Anything you are part-way through
 * typing is saved first", which was not true of the note on a running timer or
 * of any `SettingField`. One helper, so the next reload the app learns to start
 * cannot quietly be the third.
 */
export const settleDeferredWrites = (budgetMs: number = FLUSH_BUDGET_MS): Promise<unknown> =>
  Promise.race([
    Promise.allSettled(flushDeferredWrites()),
    new Promise((resolve) => window.setTimeout(resolve, budgetMs)),
  ]);

/**
 * Commit every pending draft when the page stops being visible.
 *
 * The debounce is a second of typing on the tracker's note and half of one in
 * every `SettingField`, and until this it was a second of typing the user could
 * lose by doing nothing more unusual than closing the tab, hitting reload, or
 * switching apps on a phone. Nothing said so, and the note simply read as it
 * had before the last sentence.
 *
 * `visibilitychange` to hidden is the event to hang this on: it is the last one
 * a mobile browser reliably fires before the OS reclaims the page, where
 * `beforeunload` and `unload` often never run at all. It also fires on an
 * ordinary tab switch, which is a natural commit point anyway — the same answer
 * blur already gives. `pagehide` is the backstop for a desktop close where the
 * page was never hidden first.
 *
 * Best-effort by construction: the writes are asynchronous and nothing can wait
 * on them here. Starting them is what matters — an IndexedDB write issued
 * before the page goes is normally allowed to finish, and one never issued
 * certainly is not.
 *
 * Registered on the module, not in the hook: one listener however many fields
 * are mounted, and no component has to remember to opt in. That is the whole
 * point of the registry above.
 */
const commitPendingDrafts = () => {
  for (const result of flushDeferredWrites()) {
    // Nothing here can wait on these — the page is on its way out. Marked as
    // handled so a write that fails on the way does not leave an unhandled
    // rejection behind it.
    void Promise.resolve(result).catch(() => {});
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', commitPendingDrafts);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') commitPendingDrafts();
    });
  }
}

export const useDeferredWrite = (debounceMs: number) => {
  const pendingRef = useRef<(() => unknown) | null>(null);
  const timerRef = useRef<number | null>(null);

  const flush = useCallback((): unknown => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const write = pendingRef.current;
    if (!write) return;
    // Cleared before running, so a write that throws is not retried forever by
    // the next flush.
    pendingRef.current = null;
    return write();
  }, []);

  const schedule = useCallback((write: () => unknown) => {
    pendingRef.current = write;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void flush(); }, debounceMs);
  }, [debounceMs, flush]);

  useEffect(() => {
    mountedFlushes.add(flush);
    return () => {
      mountedFlushes.delete(flush);
      void flush();
    };
  }, [flush]);

  return { schedule, flush };
};
