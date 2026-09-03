import { useCallback, useEffect, useRef } from 'react';

/**
 * A write that waits for the user to stop typing, and is never dropped.
 *
 * The hand-rolled version of this is a `setTimeout` in an effect whose cleanup
 * calls `clearTimeout`, and that cleanup runs on unmount — so leaving the
 * screen silently cancels the write instead of performing it. Up to a debounce
 * of typing disappears, and nothing on screen says so.
 *
 * Unmount is the case this closes. A page reload is *not*: React does not run
 * effect cleanup when the document goes away, so a pending write is still lost
 * there, and the flush below is void-ed rather than awaited because teardown
 * cannot wait on a promise. A caller that must not lose a write across a
 * reload has to `flush()` from something the browser does run first — a blur,
 * an Enter, or the `beforeunload` guard the running timer already installs.
 *
 * A reload the *app itself* starts is the one case it can do better than that,
 * which is what `flushDeferredWrites` below is for: the stale-chunk recovery
 * calls it and waits before reloading, so the drafts this hook exists to
 * protect are not lost to the very reload that fixes the page.
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
  [...mountedFlushes].map((flush) => flush());

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
