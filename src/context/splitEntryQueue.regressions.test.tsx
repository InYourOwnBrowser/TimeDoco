import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { TimeTrackerProvider, useTimeTracker } from './TimeTrackerContext';
import { ToastProvider } from './ToastContext';
import * as db from '../db';

/**
 * `splitEntry` against the mutations it has to serialise with.
 *
 * It has the shape the serial queue was built for — read a whole entry, derive
 * two records from that snapshot, write both back — and `updateEntry` and
 * `deleteEntry` are already on the queue for exactly that reason. While
 * `splitEntry` stayed off it, the three did not serialise against each other at
 * all.
 *
 * Both tests hold the queue open from *inside* a mutation that is on it, then
 * ask what `splitEntry` does while it is held. That is deterministic, where
 * racing the two and hoping the interleaving lands is not: `splitEntry` reaches
 * its `db.getEntry` synchronously, so "did it read while the queue was held" is
 * settled before any scheduling can intervene.
 */

const clearDB = async () => {
  try {
    await db.wipeAllData();
  } catch {}
  await db.resetDBForTests();
};

const TestConsumer: React.FC<{ onReady: (c: ReturnType<typeof useTimeTracker>) => void }> = ({ onReady }) => {
  const context = useTimeTracker();
  useEffect(() => { onReady(context); }, [context, onReady]);
  return <div data-testid="ready">Ready</div>;
};

const mountApp = async () => {
  let ctx: ReturnType<typeof useTimeTracker> | undefined;
  render(
    <ToastProvider><TimeTrackerProvider>
      <TestConsumer onReady={(c) => (ctx = c)} />
    </TimeTrackerProvider></ToastProvider>
  );
  await waitFor(() => expect(ctx?.settings).not.toBeNull());
  return () => ctx!;
};

/** One entry, an hour long, ready to split down the middle. */
const seedEntry = async (get: () => ReturnType<typeof useTimeTracker>) => {
  await act(async () => {
    await get().addTimecode('Client work', undefined, undefined, 100);
  });
  const timecodeId = get().timecodes[0].id;
  await act(async () => {
    await get().addManualEntry({
      startTime: '2026-03-10T09:00:00.000Z',
      endTime: '2026-03-10T10:00:00.000Z',
      timecodeId,
      note: 'original',
    });
  });
  return get().entries[0];
};

/**
 * Suspend the next `db.getEntry` after its real read, so whichever queued
 * mutation issued it holds the queue until released. Later reads run normally.
 */
const holdQueueOnNextRead = () => {
  const original = db.getEntry;
  let release: (() => void) | undefined;
  const reached = new Promise<void>((resolve) => {
    vi.spyOn(db, 'getEntry').mockImplementationOnce(async (id: string) => {
      const snapshot = await original(id);
      resolve();
      await new Promise<void>((r) => { release = r; });
      return snapshot;
    });
  });
  return { reached, release: () => release?.() };
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(async () => {
  await clearDB();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('splitEntry and the serial queue', () => {
  it('does not read the entry while another whole-record write holds the queue', async () => {
    const get = await mountApp();
    const entry = await seedEntry(get);

    const barrier = holdQueueOnNextRead();

    await act(async () => {
      // Takes the queue and stops inside it, mid read-modify-write.
      const edit = get().updateEntry(entry.id, { note: 'edited during split' });
      await barrier.reached;
      const readsWhileHeld = vi.mocked(db.getEntry).mock.calls.length;

      // Off the queue, `splitEntry` reached its own `db.getEntry` here — before
      // the edit in flight had written anything — and went on to build both
      // halves from that pre-edit snapshot.
      const split = get().splitEntry(entry.id, '2026-03-10T09:30:00.000Z');
      await flush();
      expect(vi.mocked(db.getEntry).mock.calls.length).toBe(readsWhileHeld);

      barrier.release();
      await Promise.all([edit, split]);
    });

    // And with the read deferred, the edit is no longer overwritten by a
    // snapshot taken before it.
    const stored = await db.getEntry(entry.id);
    expect(stored?.note).toBe('edited during split');
  });

  it('declines to split an entry a queued delete has already trashed', async () => {
    const get = await mountApp();
    const entry = await seedEntry(get);

    const barrier = holdQueueOnNextRead();
    let result: Awaited<ReturnType<ReturnType<typeof get>['splitEntry']>> | undefined;

    await act(async () => {
      const remove = get().deleteEntry(entry.id);
      await barrier.reached;

      const split = get().splitEntry(entry.id, '2026-03-10T09:30:00.000Z').then((r) => { result = r; });

      barrier.release();
      await Promise.all([remove, split]);
    });

    // Waiting its turn, the split sees the trashed record and refuses — the
    // check at the top of the function is finally load-bearing. Interleaved, it
    // held a pre-delete snapshot, wrote `deletedAt: undefined` back over the
    // delete, and created a second half from a record already in the trash.
    expect(result?.ok).toBe(false);

    const stored = await db.getEntry(entry.id);
    expect(stored?.deletedAt).toBeTruthy();

    const live = (await db.getEntries()).filter((e) => !e.deletedAt);
    expect(live).toHaveLength(0);
  });
});
