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
 * Every part of that is in here rather than in each field: scheduling replaces
 * the pending write, `flush` performs it now for a blur or an Enter, and
 * unmounting flushes rather than clears. A field built on this cannot drop a
 * write however it is used, which is the point — the same class was already
 * fixed once in `SettingField` and then written by hand again next door.
 *
 * `flush` returns whatever the write returned, so a caller that must not race
 * it — stopping the timer the note belongs to — can await it.
 */
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

  useEffect(() => () => { void flush(); }, [flush]);

  return { schedule, flush };
};
