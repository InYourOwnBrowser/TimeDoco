import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { TimeTrackerProvider, useTimeTracker } from './TimeTrackerContext';
import { ToastProvider } from './ToastContext';
import { closeDB } from '../db';

// Helper to reset the db between tests if needed. For now, vitest manages context pretty well, but we can clear it safely if we mock IDB properly.
// In the current setup, we might be hitting a block on IDB deletion because the previous test's DB connection is still open.

const DB_NAME = 'time-tracker-db';
const clearDB = async () => {
  await closeDB();
  return new Promise<void>((resolve, _reject) => {
    // If IDB cannot be deleted because it is open, we resolve instead of blocking.
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
};

const TestConsumer: React.FC<{
  onReady: (context: ReturnType<typeof useTimeTracker>) => void;
}> = ({ onReady }) => {
  const context = useTimeTracker();

  useEffect(() => {
    onReady(context);
  }, [context, onReady]);

  return <div data-testid="ready">Ready</div>;
};

describe('TimeTrackerContext Reducer Logic', () => {
  beforeEach(async () => {
    // Need to close connections before deleting the DB.
    // Actually vitest runs tests in parallel. It is safer to mock IDB entirely or ensure graceful fallback.
    // For this context, we resolve clearDB even on block to prevent timeouts.
    await clearDB();
  });

  it('cascading deletes: deleting a timecode removes associated entries', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    // Wait for context to initialize
    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let createdTimecodeId = '';

    // Create a timecode
    await act(async () => {
      const tc = await ctx!.addTimecode('Test TC');
      createdTimecodeId = tc.id;
    });

    // Verify timecode created
    await waitFor(() => {
      expect(ctx!.timecodes.find(t => t.id === createdTimecodeId)).toBeDefined();
    });

    let createdEntryId = '';

    // Create an entry for this timecode
    await act(async () => {
      await ctx!.startTimer(createdTimecodeId);
    });

    await waitFor(() => {
      const activeEntry = ctx!.entries.find(e => e.isRunning);
      expect(activeEntry).toBeDefined();
      createdEntryId = activeEntry!.id;
    });

    // Ensure it exists
    expect(ctx!.entries.find(e => e.id === createdEntryId)).toBeDefined();

    // Now delete the timecode (mock window.confirm to bypass prompt)
    vi.spyOn(window, 'confirm').mockImplementation(() => true);

    await act(async () => {
      await ctx!.deleteTimecode(createdTimecodeId);
    });

    // Verify both timecode and entry are deleted
    await waitFor(() => {
      expect(ctx!.timecodes.find(t => t.id === createdTimecodeId)).toBeUndefined();
      expect(ctx!.entries.find(e => e.id === createdEntryId)).toBeUndefined();
    });

    vi.restoreAllMocks();
  });

  it('timer state math: starts, pauses, and stops', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let createdTimecodeId = '';

    // 1. Create a timecode
    await act(async () => {
      const tc = await ctx!.addTimecode('Test TC');
      createdTimecodeId = tc.id;
    });

    // Set mock time to 10:00:00 AM
    const startDate = new Date('2024-01-01T10:00:00Z');
    vi.setSystemTime(startDate);

    // 2. Start timer
    await act(async () => {
      await ctx!.startTimer(createdTimecodeId);
    });

    let entry;
    await waitFor(() => {
      entry = ctx!.entries.find(e => e.isRunning);
      expect(entry).toBeDefined();
    });
    // Due to useFakeTimers(shouldAdvanceTime: true), a few ms might have passed
    expect(entry!.startTime.startsWith('2024-01-01T10:00:00.')).toBe(true);
    expect(entry!.pausedSegments || []).toEqual([]);
    expect(entry!.isRunning).toBe(true);
    expect(entry!.isPaused).toBe(false);

    // Advance time by 30 mins (to 10:30:00 AM)
    const pauseTime = new Date('2024-01-01T10:30:00Z');
    vi.setSystemTime(pauseTime);

    // 3. Pause timer
    await act(async () => {
      await ctx!.pauseTimer(entry!.id);
    });

    await waitFor(() => {
      entry = ctx!.entries.find(e => e.id === entry!.id);
      expect(entry!.isPaused).toBe(true);
    });
    expect(entry!.isRunning).toBe(true); // Still "running" (active), just paused
    expect(entry!.pausedSegments.length).toBe(1);
    expect(entry!.pausedSegments[0].pauseStart.startsWith('2024-01-01T10:30:00.')).toBe(true);
    expect(entry!.pausedSegments[0].pauseEnd).toBeUndefined();

    // Advance time by 15 mins (to 10:45:00 AM)
    const resumeTime = new Date('2024-01-01T10:45:00Z');
    vi.setSystemTime(resumeTime);

    // 4. Resume timer
    await act(async () => {
      await ctx!.resumeTimer(entry!.id);
    });

    await waitFor(() => {
      entry = ctx!.entries.find(e => e.id === entry!.id);
      expect(entry!.isPaused).toBe(false);
    });
    expect(entry!.isRunning).toBe(true);
    // Pause starts at ~10:30, ends at ~10:45
    expect(entry!.pausedSegments.length).toBe(1);
    expect(entry!.pausedSegments[0].pauseStart.startsWith('2024-01-01T10:30:00.')).toBe(true);
    expect(entry!.pausedSegments[0].pauseEnd!.startsWith('2024-01-01T10:45:00.')).toBe(true);

    // Advance time by 15 mins (to 11:00:00 AM)
    const stopTime = new Date('2024-01-01T11:00:00Z');
    vi.setSystemTime(stopTime);

    // 5. Stop timer
    await act(async () => {
      await ctx!.stopTimer(entry!.id);
    });

    await waitFor(() => {
      entry = ctx!.entries.find(e => e.id === entry!.id);
      expect(entry!.isRunning).toBe(false);
    });
    expect(entry!.endTime!.startsWith('2024-01-01T11:00:00.')).toBe(true);
    // Duration is 1 hour total minus 15 min pause = 45 mins (2700s)
    expect(entry!.duration).toBeGreaterThanOrEqual(2699);
    expect(entry!.duration).toBeLessThanOrEqual(2701);

    vi.useRealTimers();
  });

  it('mergeTimecodes: consolidates entries and deletes source', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let sourceTcId = '';
    let destTcId = '';

    await act(async () => {
      const source = await ctx!.addTimecode('Source TC');
      const dest = await ctx!.addTimecode('Dest TC');
      sourceTcId = source.id;
      destTcId = dest.id;
    });

    await act(async () => {
      await ctx!.bulkAddManualEntries([
        { startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T11:00:00Z', timecodeId: sourceTcId, note: 'Entry 1' },
        { startTime: '2024-01-01T12:00:00Z', endTime: '2024-01-01T13:00:00Z', timecodeId: destTcId, note: 'Entry 2' }
      ]);
    });

    await waitFor(() => {
      expect(ctx!.entries.length).toBe(2);
    });

    await act(async () => {
      await ctx!.mergeTimecodes(sourceTcId, destTcId);
    });

    await waitFor(() => {
      // Source timecode is soft-deleted, so it should not appear in active timecodes
      expect(ctx!.timecodes.find(t => t.id === sourceTcId)).toBeUndefined();
      expect(ctx!.deletedTimecodes.find(t => t.id === sourceTcId)).toBeDefined();

      // All entries should now belong to destTcId
      const entries = ctx!.entries;
      expect(entries.every(e => e.timecodeId === destTcId)).toBe(true);
    });
  });

  it('splitEntry: splits a completed entry correctly', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let tcId = '';
    await act(async () => {
      const tc = await ctx!.addTimecode('Split TC');
      tcId = tc.id;
    });

    await act(async () => {
      await ctx!.bulkAddManualEntries([
        { startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T12:00:00Z', timecodeId: tcId, note: 'To Split' },
      ]);
    });

    let entryToSplit: any;
    await waitFor(() => {
      entryToSplit = ctx!.entries[0];
      expect(entryToSplit).toBeDefined();
    });

    const splitTime = '2024-01-01T11:00:00Z';

    await act(async () => {
      await ctx!.splitEntry(entryToSplit.id, splitTime);
    });

    await waitFor(() => {
      expect(ctx!.entries.length).toBe(2);

      const e1 = ctx!.entries.find(e => e.id === entryToSplit.id);
      const e2 = ctx!.entries.find(e => e.id !== entryToSplit.id);

      expect(e1!.endTime).toBe(new Date(splitTime).toISOString());
      expect(e1!.duration).toBe(3600); // 1 hour

      expect(e2!.startTime).toBe(new Date(splitTime).toISOString());
      expect(e2!.duration).toBe(3600); // 1 hour
    });
  });

  it('cascade restore: restoring a group restores its timecodes and entries', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let groupId = '';
    let tcId = '';

    await act(async () => {
      const group = await ctx!.addGroup('Restore Group', 'red');
      groupId = group.id;
      const tc = await ctx!.addTimecode('Restore TC', undefined, groupId);
      tcId = tc.id;
    });

    await act(async () => {
      await ctx!.bulkAddManualEntries([
        { startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T11:00:00Z', timecodeId: tcId, note: 'Restore Entry' }
      ]);
    });

    await waitFor(() => expect(ctx!.entries.length).toBe(1));

    // Cascade delete group
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    await act(async () => {
      await ctx!.deleteGroup(groupId);
    });

    await waitFor(() => {
      expect(ctx!.groups.length).toBe(0);
      expect(ctx!.timecodes.length).toBe(0);
      expect(ctx!.entries.length).toBe(0);
      expect(ctx!.deletedGroups.length).toBe(1);
    });

    // Cascade restore group
    await act(async () => {
      await ctx!.restoreGroup(groupId);
    });

    await waitFor(() => {
      expect(ctx!.groups.length).toBe(1);
      expect(ctx!.timecodes.length).toBe(1);
      expect(ctx!.entries.length).toBe(1);
      expect(ctx!.deletedGroups.length).toBe(0);
    });

    vi.restoreAllMocks();
  });

  it('importData: merge resolves conflicts using updatedAt', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    await act(async () => {
      await ctx!.addGroup('Initial Group', 'blue');
    });

    let initialGroup: any;
    await waitFor(() => {
       initialGroup = ctx!.groups[0];
       expect(initialGroup).toBeDefined();
    });

    // Create a backup file representing a newer version of the same group
    const backupData = {
      groups: [{ ...initialGroup, name: 'Newer Group', updatedAt: new Date(new Date(initialGroup.updatedAt).getTime() + 10000).toISOString() }],
      timecodes: [],
      entries: [],
      settings: { id: 'user-settings' },
      schemaVersion: 1, // must match currently supported schema version
      checksumAlgorithm: 'fallback',
      checksum: ''
    };

    // Calculate fallback checksum
    const payloadString = JSON.stringify({
      groups: backupData.groups,
      timecodes: backupData.timecodes,
      entries: backupData.entries,
      settings: backupData.settings,
      schemaVersion: backupData.schemaVersion,
      checksumAlgorithm: backupData.checksumAlgorithm
    });

    let hash = 0;
    for (let i = 0; i < payloadString.length; i++) {
      const char = payloadString.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    backupData.checksum = hash.toString(16);

    const file = new File([JSON.stringify(backupData)], 'backup.json', { type: 'application/json' });

    await act(async () => {
      await ctx!.importData(file, 'merge');
    });

    await waitFor(() => {
      expect(ctx!.groups.length).toBe(1);
      expect(ctx!.groups[0].name).toBe('Newer Group');
    });

    // Create a backup file representing an older version of the same group
    const backupDataOlder = {
      groups: [{ ...initialGroup, name: 'Older Group', updatedAt: new Date(new Date(ctx!.groups[0].updatedAt).getTime() - 10000).toISOString() }],
      timecodes: [],
      entries: [],
      settings: { id: 'user-settings' },
      schemaVersion: 1, // must match currently supported schema version
      checksumAlgorithm: 'fallback',
      checksum: ''
    };

    const payloadStringOlder = JSON.stringify({
      groups: backupDataOlder.groups,
      timecodes: backupDataOlder.timecodes,
      entries: backupDataOlder.entries,
      settings: backupDataOlder.settings,
      schemaVersion: backupDataOlder.schemaVersion,
      checksumAlgorithm: backupDataOlder.checksumAlgorithm
    });

    let hashOlder = 0;
    for (let i = 0; i < payloadStringOlder.length; i++) {
      const char = payloadStringOlder.charCodeAt(i);
      hashOlder = (hashOlder << 5) - hashOlder + char;
      hashOlder = hashOlder & hashOlder;
    }
    backupDataOlder.checksum = hashOlder.toString(16);

    const fileOlder = new File([JSON.stringify(backupDataOlder)], 'backup-older.json', { type: 'application/json' });

    await act(async () => {
      await ctx!.importData(fileOlder, 'merge');
    });

    await waitFor(() => {
      expect(ctx!.groups.length).toBe(1);
      expect(ctx!.groups[0].name).toBe('Newer Group'); // Remains Newer Group
    });
  });

  it('performance benchmark: batch entry deletion speed', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let tcId = '';
    await act(async () => {
      const tc = await ctx!.addTimecode('Benchmark TC');
      tcId = tc.id;
    });

    const numEntries = 50;
    const entriesData = Array.from({ length: numEntries }, (_, i) => ({
      startTime: '2024-01-01T10:00:00Z',
      endTime: '2024-01-01T11:00:00Z',
      timecodeId: tcId,
      note: `Benchmark Entry ${i}`,
    }));

    await act(async () => {
      await ctx!.bulkAddManualEntries(entriesData);
    });

    await waitFor(() => {
      expect(ctx!.entries.length).toBe(numEntries);
    });

    const start = performance.now();
    await act(async () => {
      await ctx!.hardDeleteTimecode(tcId);
    });
    const duration = performance.now() - start;

    console.log(`[BENCHMARK] Deleting ${numEntries} entries baseline duration: ${duration.toFixed(2)} ms`);

    await waitFor(() => {
      expect(ctx!.timecodes.find((t) => t.id === tcId)).toBeUndefined();
      expect(ctx!.entries.length).toBe(0);
    });
  });
});
