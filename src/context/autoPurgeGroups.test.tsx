import React, { useEffect } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TimeTrackerProvider, useTimeTracker } from './TimeTrackerContext';
import { ToastProvider } from './ToastContext';
import * as db from '../db';
import type { Entry, Group, Timecode } from '../types';

/**
 * The thirty-day trash cleanup, on a group something live still belongs to.
 *
 * The timecode half of this purge already refuses to remove a trashed timecode
 * that still has live entries, because purging it would take them with it. The
 * group half had no such rule: it stripped the group from every timecode
 * pointing at it, live ones included, and hard-deleted it — permanently,
 * unprompted, thirty days after a deletion the user has no reason to connect to
 * the timecodes they are still billing against.
 *
 * The state is reachable through a merge-mode backup import, which writes a
 * live timecode whose `groupId` names a group trashed on this device;
 * `validateBackupPayload` does not tie the two together.
 */

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

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

/** Mount the app, which runs the purge on load, and wait for it to settle. */
const openApp = async () => {
  let ctx: ReturnType<typeof useTimeTracker> | undefined;
  render(
    <ToastProvider><TimeTrackerProvider>
      <Consumer onReady={(c) => { ctx = c; }} />
    </TimeTrackerProvider></ToastProvider>
  );
  await waitFor(() => expect(ctx?.settings).not.toBeNull());
  return () => ctx!;
};

const group = (over: Partial<Group> = {}): Group => ({
  id: 'g-1', name: 'Acme', color: '#123456', archived: false,
  deletedAt: daysAgo(31), updatedAt: daysAgo(31), ...over,
} as Group);

const timecode = (over: Partial<Timecode> = {}): Timecode => ({
  id: 'tc-1', name: 'Design', groupId: 'g-1', color: '#123456',
  hourlyRate: 90, archived: false, updatedAt: daysAgo(31), ...over,
} as Timecode);

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e-1', timecodeId: 'tc-1',
  startTime: '2026-01-02T09:00:00.000Z', endTime: '2026-01-02T11:00:00.000Z',
  duration: 7200, note: 'billable work', tags: [], isRunning: false, isPaused: false,
  pausedSegments: [], editHistory: [],
  createdAt: '2026-01-02T09:00:00.000Z', updatedAt: '2026-01-02T09:00:00.000Z', ...over,
} as Entry);

describe('the 30-day trash cleanup, on a trashed group', () => {
  beforeEach(async () => { await clearDB(); });

  it('leaves it alone while a live timecode still belongs to it', async () => {
    await db.putGroup(group());
    await db.putTimecode(timecode());          // live
    await db.putEntry(entry());                // live

    await openApp();

    await waitFor(async () => {
      expect(await db.getTimecode('tc-1')).toBeDefined();
    });
    // The grouping the user is still billing against is intact, and so is the
    // group it points at.
    expect((await db.getTimecode('tc-1'))?.groupId).toBe('g-1');
    expect(await db.getGroup('g-1')).toBeDefined();
    expect(await db.getEntry('e-1')).toBeDefined();
  }, 20000);

  it('still purges it once nothing live points at it', async () => {
    await db.putGroup(group());
    await db.putTimecode(timecode({ deletedAt: daysAgo(31) }));
    await db.putEntry(entry({ deletedAt: daysAgo(31) }));

    await openApp();

    // Skipping is a delay, not an amnesty: a group nothing live belongs to is
    // cleaned up exactly as before.
    await waitFor(async () => {
      expect(await db.getGroup('g-1')).toBeUndefined();
    }, { timeout: 10000 });
  }, 20000);

  it('leaves a group whose only timecodes are trashed but too recent to purge', async () => {
    // The timecode is trashed, so nothing live belongs to the group — but it is
    // three days old, so it is not purged yet and still names the group.
    await db.putGroup(group());
    await db.putTimecode(timecode({ deletedAt: daysAgo(3), updatedAt: daysAgo(3) }));
    await db.putEntry(entry({ deletedAt: daysAgo(3) }));

    await openApp();

    await waitFor(async () => {
      expect(await db.getGroup('g-1')).toBeUndefined();
    }, { timeout: 10000 });
    // Restoring the timecode later brings it back ungrouped, which is honest:
    // the group was permanently deleted, and the entries are untouched.
    expect(await db.getTimecode('tc-1')).toBeDefined();
    expect(await db.getEntry('e-1')).toBeDefined();
  }, 20000);
});
