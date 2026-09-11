import React, { useEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TimeTrackerProvider, useTimeTracker } from './TimeTrackerContext';
import { ToastProvider } from './ToastContext';
import * as db from '../db';
import type { Entry, Timecode } from '../types';

/**
 * Two tabs of the app, editing the same record.
 *
 * The in-tab serial queue is a promise chain on a ref, so it orders this tab's
 * mutations and knows nothing about any other tab's. Every whole-record writer
 * here reads the record, changes a field and writes the whole thing back, so
 * two tabs interleaved on that sequence lost one of the two edits — and both
 * reported success, which is the part that made it invisible: a note typed in
 * one window vanished under a tag added in the other, with a green "Changes
 * saved" on each.
 *
 * jsdom implements no Web Locks, so the shim below stands in for the browser's.
 * It is the API's contract and nothing more — one holder at a time per name,
 * FIFO, released when the callback settles — which is exactly the guarantee the
 * fix leans on.
 */

const installWebLocksShim = () => {
  const tails = new Map<string, Promise<unknown>>();
  const locks = {
    request: (name: string, _options: { signal?: AbortSignal }, callback: () => Promise<unknown>) => {
      const tail = tails.get(name) ?? Promise.resolve();
      const result = tail.then(callback, callback);
      tails.set(name, result.then(() => undefined, () => undefined));
      return result;
    },
  };
  Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true });
  return () => { Reflect.deleteProperty(globalThis.navigator as object, 'locks'); };
};

const clearDB = async () => {
  try { await db.wipeAllData(); } catch { /* nothing stored yet */ }
  await db.resetDBForTests();
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('time-tracker-db');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
};

const Consumer: React.FC<{ onReady: (c: ReturnType<typeof useTimeTracker>) => void }> = ({ onReady }) => {
  const context = useTimeTracker();
  useEffect(() => { onReady(context); }, [context, onReady]);
  return <div />;
};

/** A browser tab: its own React tree, its own provider, its own serial queue. */
const openTab = async () => {
  let ctx: ReturnType<typeof useTimeTracker> | undefined;
  render(
    <ToastProvider><TimeTrackerProvider>
      <Consumer onReady={(c) => { ctx = c; }} />
    </TimeTrackerProvider></ToastProvider>
  );
  await waitFor(() => expect(ctx?.settings).not.toBeNull());
  return () => ctx!;
};

const TIMECODE = {
  id: 'tc-1', name: 'Dev', groupId: null, color: '#123456',
  hourlyRate: 100, archived: false, updatedAt: '2026-01-01T00:00:00.000Z',
} as Timecode;

const ENTRY = {
  id: 'e-1', timecodeId: 'tc-1',
  startTime: '2026-01-02T09:00:00.000Z', endTime: '2026-01-02T10:00:00.000Z',
  duration: 3600, note: '', tags: [], isRunning: false, isPaused: false,
  pausedSegments: [], manualAmount: null, editHistory: [],
  createdAt: '2026-01-02T09:00:00.000Z', updatedAt: '2026-01-02T09:00:00.000Z',
} as Entry;

describe('two tabs writing the same record', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(async () => {
    await clearDB();
    uninstall = installWebLocksShim();
    await db.putTimecode(TIMECODE);
    await db.putEntry(ENTRY);
  });

  afterEach(() => { uninstall?.(); uninstall = null; });

  it('keeps both edits when each tab changes a different field', async () => {
    const tabA = await openTab();
    const tabB = await openTab();

    const [okA, okB] = await Promise.all([
      tabA().updateEntry('e-1', { note: 'call with the client' }),
      tabB().updateEntry('e-1', { tags: ['billable'] }),
    ]);
    expect([okA, okB]).toEqual([true, true]);

    const stored = await db.getEntry('e-1');
    // Both writes reported success, so both edits have to be there. Either one
    // missing means a tab was told its change was saved when it was not.
    expect(stored?.note).toBe('call with the client');
    expect(stored?.tags).toEqual(['billable']);
  }, 20000);

  it('keeps both edits to settings, which has a queue of its own', async () => {
    const tabA = await openTab();
    const tabB = await openTab();

    const [okA, okB] = await Promise.all([
      tabA().updateSettings({ currencySymbol: '€' }),
      tabB().updateSettings({ weeklyTargetHours: 32 }),
    ]);
    expect([okA, okB]).toEqual([true, true]);

    const stored = await db.getSettings();
    expect(stored?.currencySymbol).toBe('€');
    expect(stored?.weeklyTargetHours).toBe(32);
  }, 20000);

  it('records both edits in the history rather than one overwriting the other', async () => {
    const tabA = await openTab();
    const tabB = await openTab();

    await Promise.all([
      tabA().updateEntry('e-1', { note: 'call with the client' }),
      tabB().updateEntry('e-1', { tags: ['billable'] }),
    ]);

    const fields = (await db.getEntry('e-1'))!.editHistory.map((change) => change.field).sort();
    expect(fields).toEqual(['note', 'tags']);
  }, 20000);
});

describe('a browser without Web Locks', () => {
  beforeEach(async () => {
    await clearDB();
    Reflect.deleteProperty(globalThis.navigator as object, 'locks');
    await db.putTimecode(TIMECODE);
    await db.putEntry(ENTRY);
  });

  it('still saves, rather than refusing to write at all', async () => {
    // The lock needs a secure context and is not everywhere. Without it the app
    // is exactly as correct as it was before — single-tab correct — and must
    // certainly not stop working.
    expect((globalThis.navigator as { locks?: unknown }).locks).toBeUndefined();
    const tab = await openTab();

    expect(await tab().updateEntry('e-1', { note: 'still saved' })).toBe(true);
    expect((await db.getEntry('e-1'))?.note).toBe('still saved');
  }, 20000);
});

describe('a tab that never releases the lock', () => {
  it('does not stop the other tabs writing for ever', async () => {
    vi.useFakeTimers();
    try {
      const { withCrossTabLock } = await import('../utils/crossTabLock');
      Object.defineProperty(globalThis.navigator, 'locks', {
        value: {
          // A wedged holder: the request waits until the caller's signal aborts.
          request: (_n: string, options: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              options.signal?.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            }),
        },
        configurable: true,
      });

      let ran = false;
      const pending = withCrossTabLock(async () => { ran = true; return 'written'; });

      expect(ran).toBe(false);
      await vi.advanceTimersByTimeAsync(6_000);

      // Gives up waiting and writes anyway, which is what it did before the
      // lock existed. A stalled tab must not become a stalled browser.
      await expect(pending).resolves.toBe('written');
      expect(ran).toBe(true);
    } finally {
      Reflect.deleteProperty(globalThis.navigator as object, 'locks');
      vi.useRealTimers();
    }
  }, 20000);
});
