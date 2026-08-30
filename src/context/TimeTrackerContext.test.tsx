import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { TimeTrackerProvider, useTimeTracker } from './TimeTrackerContext';
import { ToastProvider } from './ToastContext';
import * as db from '../db';

const DB_NAME = 'time-tracker-db';
const clearDB = async () => {
  try {
    await db.wipeAllData();
  } catch {}
  await db.closeDB();
  return new Promise<void>((resolve, _reject) => {
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
    await clearDB();
  });

  it('initializes default settings with theme set to dark', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());
    expect(ctx!.settings?.theme).toBe('dark');
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
    expect(entry!.expectedDurationMinutes).toBeNull();

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

  it('startTimer: persists expectedDurationMinutes on created entry', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let createdTimecodeId = '';
    await act(async () => {
      const tc = await ctx!.addTimecode('Test Estimate TC');
      createdTimecodeId = tc.id;
    });

    await act(async () => {
      await ctx!.startTimer(createdTimecodeId, 'Estimate note', ['tag1'], 45);
    });

    await waitFor(() => {
      const activeEntry = ctx!.entries.find(e => e.isRunning);
      expect(activeEntry).toBeDefined();
      expect(activeEntry!.expectedDurationMinutes).toBe(45);
    });
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

  it('C1: a soft-deleted group keeps its timecodes\' templates, and the Trash restores them', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let groupId = '';
    let tcId = '';
    await act(async () => {
      const group = await ctx!.addGroup('Template Group', 'red');
      groupId = group.id;
      const tc = await ctx!.addTimecode('Template TC', undefined, groupId);
      tcId = tc.id;
    });

    await act(async () => {
      await ctx!.updateSettings({
        templates: [{ id: 'tmpl-1', title: 'Standup', timecodeId: tcId, durationMinutes: 15, note: '' }],
      });
    });

    await waitFor(() => expect(ctx!.settings?.templates?.length).toBe(1));

    await act(async () => {
      await ctx!.deleteGroup(groupId);
    });

    await waitFor(() => expect(ctx!.deletedGroups.length).toBe(1));
    // The delete is reversible, so the template is still there — not stripped
    // and left to an undo handler to reconstruct.
    expect(ctx!.settings?.templates?.map(t => t.id)).toEqual(['tmpl-1']);

    // Restored from the Trash long after the undo toast has gone.
    await act(async () => {
      await ctx!.restoreGroup(groupId);
    });

    await waitFor(() => expect(ctx!.timecodes.length).toBe(1));
    expect(ctx!.settings?.templates?.map(t => t.id)).toEqual(['tmpl-1']);
    expect(ctx!.settings?.templates?.[0].timecodeId).toBe(tcId);
  });

  it('C1: restoring a timecode from the Trash brings its templates back with it', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      const tc = await ctx!.addTimecode('Solo TC');
      tcId = tc.id;
    });

    await act(async () => {
      await ctx!.updateSettings({
        templates: [{ id: 'tmpl-2', title: 'Admin', timecodeId: tcId, durationMinutes: null, note: '' }],
      });
    });

    await act(async () => {
      await ctx!.deleteTimecode(tcId);
    });

    await waitFor(() => expect(ctx!.deletedTimecodes.length).toBe(1));
    expect(ctx!.settings?.templates?.map(t => t.id)).toEqual(['tmpl-2']);

    await act(async () => {
      await ctx!.restoreTimecode(tcId);
    });

    await waitFor(() => expect(ctx!.timecodes.length).toBe(1));
    expect(ctx!.settings?.templates?.map(t => t.id)).toEqual(['tmpl-2']);
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

  it('importData: rejects oversized file > 20MB', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    // Create a dummy mock file > 20MB
    const oversizedFile = new File(['a'], 'large-backup.json', { type: 'application/json' });
    Object.defineProperty(oversizedFile, 'size', { value: 21 * 1024 * 1024 });

    await expect(ctx!.importData(oversizedFile, 'merge')).rejects.toThrow('20MB limit');
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
    // Staggered by an hour each: bulk import rejects overlapping rows, so
    // identical times would leave only one entry to benchmark against.
    const entriesData = Array.from({ length: numEntries }, (_, i) => ({
      startTime: new Date(Date.UTC(2024, 0, 1, 0, 0) + i * 3600_000).toISOString(),
      endTime: new Date(Date.UTC(2024, 0, 1, 0, 30) + i * 3600_000).toISOString(),
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

  it('performance benchmark: hardDeleteGroup batch timecode updates speed', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let groupId = '';
    await act(async () => {
      const g = await ctx!.addGroup('Bench Group', 'blue');
      groupId = g.id;
    });

    const numTimecodes = 50;
    await act(async () => {
      for (let i = 0; i < numTimecodes; i++) {
        await ctx!.addTimecode(`TC ${i}`, undefined, groupId);
      }
    });

    await waitFor(() => {
      expect(ctx!.timecodes.filter(t => t.groupId === groupId).length).toBe(numTimecodes);
    });

    const start = performance.now();
    await act(async () => {
      await ctx!.hardDeleteGroup(groupId);
    });
    const duration = performance.now() - start;

    console.log(`[BENCHMARK] Hard deleting group with ${numTimecodes} timecodes duration: ${duration.toFixed(2)} ms`);

    await waitFor(() => {
      expect(ctx!.groups.find((g) => g.id === groupId)).toBeUndefined();
      expect(ctx!.timecodes.every(t => t.groupId !== groupId)).toBe(true);
    });
  });

  it('wipeAllData: clears all entries, timecodes, groups, settings, and localStorage keys', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    await act(async () => {
      const group = await ctx!.addGroup('Test Group', '#3b82f6');
      const tc = await ctx!.addTimecode('Test Timecode', undefined, group.id);
      await ctx!.addManualEntry({
        startTime: '2024-01-01T10:00:00Z',
        endTime: '2024-01-01T12:00:00Z',
        timecodeId: tc.id,
        note: 'Test entry to wipe',
      });
    });

    localStorage.setItem('backupReminderDismissed', 'true');
    localStorage.setItem('dismissedForgotToStopIds', JSON.stringify(['dummy-id']));

    await waitFor(() => {
      expect(ctx!.groups.length).toBe(1);
      expect(ctx!.timecodes.length).toBe(1);
      expect(ctx!.entries.length).toBe(1);
    });

    await act(async () => {
      await ctx!.wipeAllData();
    });

    await waitFor(() => {
      expect(ctx!.groups.length).toBe(0);
      expect(ctx!.timecodes.length).toBe(0);
      expect(ctx!.entries.length).toBe(0);
      expect(localStorage.getItem('backupReminderDismissed')).toBeNull();
      expect(localStorage.getItem('dismissedForgotToStopIds')).toBeNull();
    });
  });

  it('addManualEntry and updateEntry support break time and manualAmount override', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let tcId = '';
    await act(async () => {
      const tc = await ctx!.addTimecode('Fixed Fee TC');
      tcId = tc.id;
    });

    // Add manual entry with 15 min break (900s) and $150 fixed fee override
    const startTime = '2024-01-01T10:00:00Z';
    const endTime = '2024-01-01T12:00:00Z'; // 2 hours (7200s)
    const pausedSegments = [{ pauseStart: '2024-01-01T10:00:00Z', pauseEnd: '2024-01-01T10:15:00Z' }];

    await act(async () => {
      await ctx!.addManualEntry({
        startTime,
        endTime,
        timecodeId: tcId,
        note: 'Fixed project fee',
        pausedSegments,
        manualAmount: 150.0,
      });
    });

    let createdEntry: any;
    await waitFor(() => {
      createdEntry = ctx!.entries[0];
      expect(createdEntry).toBeDefined();
    });

    // Duration should be 2 hours - 15 mins break = 6300 seconds (1h 45m)
    expect(createdEntry.duration).toBe(6300);
    expect(createdEntry.manualAmount).toBe(150.0);
    expect(createdEntry.pausedSegments.length).toBe(1);

    // Now update entry to 30 min break and $200 manualAmount
    const updatedPausedSegments = [{ pauseStart: '2024-01-01T10:00:00Z', pauseEnd: '2024-01-01T10:30:00Z' }];
    await act(async () => {
      await ctx!.updateEntry(createdEntry.id, {
        pausedSegments: updatedPausedSegments,
        manualAmount: 200.0,
      });
    });

    await waitFor(() => {
      const updated = ctx!.entries.find(e => e.id === createdEntry.id);
      expect(updated!.duration).toBe(5400); // 2 hours - 30 mins break = 5400 seconds (1h 30m)
      expect(updated!.manualAmount).toBe(200.0);
      expect(updated!.pausedSegments.length).toBe(1);
    });
  });

  it('bulkDeleteEntries: soft-deletes multiple entries at once and supports batch restore', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let tcId = '';
    await act(async () => {
      const tc = await ctx!.addTimecode('Bulk Delete TC');
      tcId = tc.id;
    });

    await act(async () => {
      await ctx!.bulkAddManualEntries([
        { startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T11:00:00Z', timecodeId: tcId, note: 'Entry A' },
        { startTime: '2024-01-01T11:00:00Z', endTime: '2024-01-01T12:00:00Z', timecodeId: tcId, note: 'Entry B' },
        { startTime: '2024-01-01T12:00:00Z', endTime: '2024-01-01T13:00:00Z', timecodeId: tcId, note: 'Entry C' },
      ]);
    });

    let entryIds: string[] = [];
    await waitFor(() => {
      expect(ctx!.entries.length).toBe(3);
      entryIds = ctx!.entries.map(e => e.id);
    });

    // Delete first two entries
    const idsToDelete = entryIds.slice(0, 2);
    await act(async () => {
      await ctx!.bulkDeleteEntries(idsToDelete);
    });

    await waitFor(() => {
      expect(ctx!.entries.length).toBe(1);
      expect(ctx!.deletedEntries.length).toBe(2);
      expect(ctx!.entries[0].id).toBe(entryIds[2]);
    });

    // Restore one of them
    await act(async () => {
      await ctx!.restoreEntry(idsToDelete[0]);
    });

    await waitFor(() => {
      expect(ctx!.entries.length).toBe(2);
      expect(ctx!.deletedEntries.length).toBe(1);
    });
  });

  it('restoreEntry: restores soft-deleted timecode if restored entry timecode is trashed', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let tcId = '';
    await act(async () => {
      const tc = await ctx!.addTimecode('Orphan TC');
      tcId = tc.id;
      await ctx!.bulkAddManualEntries([
        { startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T11:00:00Z', timecodeId: tcId, note: 'Orphan Entry' }
      ]);
    });

    let entryId = '';
    await waitFor(() => {
      expect(ctx!.entries.length).toBe(1);
      entryId = ctx!.entries[0].id;
    });

    // Soft delete the entry and timecode
    await act(async () => {
      await ctx!.deleteEntry(entryId);
    });
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    await act(async () => {
      await ctx!.deleteTimecode(tcId);
    });

    await waitFor(() => {
      expect(ctx!.timecodes.find(t => t.id === tcId)).toBeUndefined();
      expect(ctx!.entries.find(e => e.id === entryId)).toBeUndefined();
      expect(ctx!.deletedTimecodes.find(t => t.id === tcId)).toBeDefined();
      expect(ctx!.deletedEntries.find(e => e.id === entryId)).toBeDefined();
    });

    // Restoring the entry should automatically restore its soft-deleted timecode as well
    await act(async () => {
      await ctx!.restoreEntry(entryId);
    });

    await waitFor(() => {
      expect(ctx!.entries.find(e => e.id === entryId)).toBeDefined();
      expect(ctx!.timecodes.find(t => t.id === tcId)).toBeDefined();
      expect(ctx!.deletedTimecodes.find(t => t.id === tcId)).toBeUndefined();
    });

    vi.restoreAllMocks();
  });

  it('bulkAddManualEntries rejects reversed and unparseable rows instead of storing zero-length entries', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Bulk TC')).id;
    });

    let result: { added: number; skipped: number } | undefined;
    await act(async () => {
      result = await ctx!.bulkAddManualEntries([
        { startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T11:00:00Z', timecodeId: tcId, note: 'good' },
        { startTime: '2024-01-01T13:00:00Z', endTime: '2024-01-01T12:00:00Z', timecodeId: tcId, note: 'reversed' },
        { startTime: 'not-a-date', endTime: '2024-01-01T12:00:00Z', timecodeId: tcId, note: 'unparseable' },
      ]);
    });

    expect(result).toEqual({ added: 1, skipped: 2 });
    await waitFor(() => expect(ctx!.entries.length).toBe(1));
    expect(ctx!.entries[0].duration).toBe(3600);
  });

  it('mergeTimecodes also repoints soft-deleted entries at the destination', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let sourceId = '';
    let destId = '';
    await act(async () => {
      sourceId = (await ctx!.addTimecode('Source')).id;
      destId = (await ctx!.addTimecode('Dest')).id;
      await ctx!.bulkAddManualEntries([
        { startTime: '2024-01-01T10:00:00Z', endTime: '2024-01-01T11:00:00Z', timecodeId: sourceId, note: 'trashed' },
      ]);
    });

    await waitFor(() => expect(ctx!.entries.length).toBe(1));
    const entryId = ctx!.entries[0].id;

    // Send it to the trash, then merge. The trashed entry must come along, or
    // restoring it later leaves it pointing at a deleted timecode.
    await act(async () => { await ctx!.deleteEntry(entryId); });
    await waitFor(() => expect(ctx!.deletedEntries.length).toBe(1));

    await act(async () => { await ctx!.mergeTimecodes(sourceId, destId); });

    await waitFor(() => {
      const trashed = ctx!.deletedEntries.find((e) => e.id === entryId);
      expect(trashed?.timecodeId).toBe(destId);
    });
  });

  it('bulkAddManualEntries rejects rows that overlap existing entries and each other', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Overlap TC')).id;
      await ctx!.bulkAddManualEntries([
        { startTime: '2024-03-01T09:00:00Z', endTime: '2024-03-01T10:00:00Z', timecodeId: tcId, note: 'seed' },
      ]);
    });
    await waitFor(() => expect(ctx!.entries.length).toBe(1));

    let result: { added: number; skipped: number } | undefined;
    await act(async () => {
      result = await ctx!.bulkAddManualEntries([
        // Overlaps the seed entry already in the database.
        { startTime: '2024-03-01T09:30:00Z', endTime: '2024-03-01T10:30:00Z', timecodeId: tcId, note: 'clash-existing' },
        // Clear of everything.
        { startTime: '2024-03-01T11:00:00Z', endTime: '2024-03-01T12:00:00Z', timecodeId: tcId, note: 'ok' },
        // Overlaps the row above, within the same batch.
        { startTime: '2024-03-01T11:30:00Z', endTime: '2024-03-01T12:30:00Z', timecodeId: tcId, note: 'clash-batch' },
      ]);
    });

    expect(result).toEqual({ added: 1, skipped: 2 });
    await waitFor(() => expect(ctx!.entries.length).toBe(2));
    expect(ctx!.entries.map((e) => e.note).sort()).toEqual(['ok', 'seed']);
  });

  it('cascading delete finds entries written outside this tab\'s snapshot', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Cascade TC')).id;
    });

    // Written straight to the database, as another tab would, so it is absent
    // from this provider's React state.
    const unseen = {
      id: 'written-elsewhere',
      timecodeId: tcId,
      startTime: '2024-05-01T09:00:00.000Z',
      endTime: '2024-05-01T10:00:00.000Z',
      duration: 3600,
      note: 'from another tab',
      tags: [],
      isRunning: false,
      isPaused: false,
      pausedSegments: [],
      editHistory: [],
      createdAt: '2024-05-01T09:00:00.000Z',
      updatedAt: '2024-05-01T09:00:00.000Z',
    };
    await act(async () => {
      await db.putEntry(unseen as any);
      expect(ctx!.entries.find((e) => e.id === unseen.id)).toBeUndefined();
      await ctx!.deleteTimecode(tcId);
    });

    // The cascade reads the database, so the unseen entry is trashed too rather
    // than left pointing at a deleted timecode.
    await waitFor(() => {
      const stored = ctx!.deletedEntries.find((e) => e.id === unseen.id);
      expect(stored?.deletedAt).toBeTruthy();
    });
  });

  it('splitEntry moves a flat fee to one half and divides the estimate, never duplicating either', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Fee TC')).id;
      await ctx!.addManualEntry({
        startTime: '2024-02-01T10:00:00Z',
        endTime: '2024-02-01T12:00:00Z',
        timecodeId: tcId,
        note: 'Fixed fee job',
        manualAmount: 500,
      });
    });

    let original: any;
    await waitFor(() => {
      original = ctx!.entries.find((e) => e.note === 'Fixed fee job');
      expect(original).toBeDefined();
    });

    await act(async () => {
      await ctx!.updateEntry(original.id, { expectedDurationMinutes: 90 });
      await ctx!.splitEntry(original.id, '2024-02-01T11:00:00Z');
    });

    await waitFor(() => expect(ctx!.entries.length).toBe(2));

    const first = ctx!.entries.find((e) => e.id === original.id)!;
    const second = ctx!.entries.find((e) => e.id !== original.id)!;

    // Neither value may be duplicated — that would double-bill the fee and
    // double-count the estimate. Nulling both (the previous behaviour) avoided
    // that by destroying billable money and dropping the entry out of the
    // Estimates tab instead. The fee now lands on exactly one half, defaulting
    // to the first, and the estimate is divided in proportion to tracked time.
    expect(first.manualAmount).toBe(500);
    expect(second.manualAmount).toBeNull();

    // 90 minutes across an even 1h/1h split.
    expect(first.expectedDurationMinutes).toBe(45);
    expect(second.expectedDurationMinutes).toBe(45);
    expect((first.expectedDurationMinutes ?? 0) + (second.expectedDurationMinutes ?? 0)).toBe(90);
  });

  it('stamps updatedAt when trashing and restoring, so an older backup cannot undo it', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.groups).toBeDefined());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Stamp TC')).id;
      await ctx!.addManualEntry({
        startTime: '2024-03-01T10:00:00Z',
        endTime: '2024-03-01T11:00:00Z',
        timecodeId: tcId,
        note: 'Stamped',
      });
    });

    let entryId = '';
    await waitFor(() => {
      const e = ctx!.entries.find((x) => x.note === 'Stamped');
      expect(e).toBeDefined();
      entryId = e!.id;
    });

    const createdStamp = (await db.getEntry(entryId))!.updatedAt;
    const tcCreatedStamp = (await db.getTimecode(tcId))!.updatedAt;

    // Merge import resolves conflicts on updatedAt, so a trash that leaves the
    // old stamp in place is silently undone by importing an older backup.
    await act(async () => { await ctx!.deleteTimecode(tcId); });
    const trashedEntry = (await db.getEntry(entryId))!;
    const trashedTc = (await db.getTimecode(tcId))!;
    expect(trashedEntry.deletedAt).toBeTruthy();
    expect(new Date(trashedEntry.updatedAt).getTime())
      .toBeGreaterThan(new Date(createdStamp).getTime());
    expect(new Date(trashedTc.updatedAt).getTime())
      .toBeGreaterThan(new Date(tcCreatedStamp).getTime());

    // Let the clock move on, so "kept the old stamp" and "stamped again in the
    // same millisecond" cannot be confused for each other.
    await new Promise((r) => setTimeout(r, 5));

    await act(async () => { await ctx!.restoreTimecode(tcId); });
    const restoredEntry = (await db.getEntry(entryId))!;
    const restoredTc = (await db.getTimecode(tcId))!;
    expect(restoredEntry.deletedAt).toBeUndefined();
    expect(new Date(restoredEntry.updatedAt).getTime())
      .toBeGreaterThan(new Date(trashedEntry.updatedAt).getTime());
    expect(new Date(restoredTc.updatedAt).getTime())
      .toBeGreaterThan(new Date(trashedTc.updatedAt).getTime());
  });

  it('startTimer stops every running timer even while another stop is in flight', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    // Two timers running, then concurrency turned off — the state a user
    // reaches by flipping the setting, or by starting a timer in a second tab.
    await act(async () => { await ctx!.updateSettings({ allowConcurrentTimers: true }); });
    await waitFor(() => expect(ctx!.settings?.allowConcurrentTimers).toBe(true));

    let tcA = '';
    let tcB = '';
    let tcC = '';
    await act(async () => {
      tcA = (await ctx!.addTimecode('Race A')).id;
      tcB = (await ctx!.addTimecode('Race B')).id;
      tcC = (await ctx!.addTimecode('Race C')).id;
      await ctx!.startTimer(tcA);
      await ctx!.startTimer(tcB);
    });
    await waitFor(() => expect(ctx!.activeEntries.length).toBe(2));
    const runningAId = ctx!.activeEntries.find((e) => e.timecodeId === tcA)!.id;

    await act(async () => { await ctx!.updateSettings({ allowConcurrentTimers: false }); });
    await waitFor(() => expect(ctx!.settings?.allowConcurrentTimers).toBe(false));

    // Hold the write that finishes A's stop, so the stop is provably still in
    // flight when the next start runs.
    let release: (() => void) | undefined;
    let stopReachedWrite = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const realPutEntry = db.putEntry;
    const putSpy = vi.spyOn(db, 'putEntry').mockImplementation(async (entry) => {
      if (entry.id === runningAId && !entry.isRunning) {
        stopReachedWrite = true;
        await held;
      }
      return realPutEntry(entry);
    });

    try {
      await act(async () => {
        const stopping = ctx!.stopTimer(runningAId);
        while (!stopReachedWrite) await new Promise((r) => setTimeout(r, 1));

        const starting = ctx!.startTimer(tcC);
        // Long enough for a startTimer that does not queue to run its stops,
        // give up on them, and write its own entry.
        await new Promise((r) => setTimeout(r, 20));

        release!();
        await Promise.all([stopping, starting]);
      });
    } finally {
      putSpy.mockRestore();
    }

    // A start that sails past an in-flight stop leaves B running alongside C.
    const stillRunning = (await db.getEntries()).filter((e) => e.isRunning && !e.deletedAt);
    expect(stillRunning.map((e) => e.timecodeId)).toEqual([tcC]);
    expect(tcB).not.toBe('');
  });

  it('getBackupBlob does not stamp lastBackupDate until the backup is saved', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());
    expect(ctx!.settings?.lastBackupDate).toBeNull();

    let blob: Blob | undefined;
    await act(async () => { blob = await ctx!.getBackupBlob(); });

    // Serialising is not saving: a download that fails after this point would
    // otherwise suppress the reminder over a file the user never received.
    expect((await db.getSettings())?.lastBackupDate).toBeNull();

    // The file itself records when it was taken, so restoring it does not
    // reinstate the previous backup date.
    const payload = JSON.parse(await blob!.text());
    expect(payload.settings.lastBackupDate).not.toBeNull();
    expect(Number.isNaN(Date.parse(payload.settings.lastBackupDate))).toBe(false);

    await act(async () => { await ctx!.markBackupSaved(); });

    await waitFor(() => expect(ctx!.settings?.lastBackupDate).not.toBeNull());
    expect((await db.getSettings())?.lastBackupDate).not.toBeNull();
  });

  it('a note save already in flight cannot resurrect a stopped timer', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Race Note')).id;
      await ctx!.startTimer(tcId, 'first');
    });
    await waitFor(() => expect(ctx!.activeEntries.length).toBe(1));
    const runningId = ctx!.activeEntries[0].id;

    // Hold the note autosave's write, so the save is provably still in flight
    // when the stop runs — the state ActiveTimer reaches on every stop, since
    // it flushes the note immediately before stopping.
    let release: (() => void) | undefined;
    let noteReachedWrite = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const realPutEntry = db.putEntry;
    const putSpy = vi.spyOn(db, 'putEntry').mockImplementation(async (entry) => {
      if (entry.id === runningId && entry.note === 'still typing') {
        noteReachedWrite = true;
        await held;
      }
      return realPutEntry(entry);
    });

    try {
      await act(async () => {
        const saving = ctx!.updateActiveNote(runningId, 'still typing');
        while (!noteReachedWrite) await new Promise((r) => setTimeout(r, 1));

        const stopping = ctx!.stopTimer(runningId);
        // Long enough for a stop that does not queue to read the still-running
        // entry and write it back as stopped.
        await new Promise((r) => setTimeout(r, 20));

        release!();
        await Promise.all([saving, stopping]);
      });
    } finally {
      putSpy.mockRestore();
    }

    // A note save that sails past the stop writes its pre-stop copy back, and
    // the timer comes back to life with its duration erased.
    const stored = await db.getEntry(runningId);
    expect(stored!.isRunning).toBe(false);
    expect(stored!.endTime).not.toBeNull();
    expect(stored!.duration).toBeGreaterThanOrEqual(0);
    // The stop still has to keep what the user typed.
    expect(stored!.note).toBe('still typing');
  });

  it('a pause already in flight cannot resurrect a stopped timer', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Race Pause')).id;
      await ctx!.startTimer(tcId);
    });
    await waitFor(() => expect(ctx!.activeEntries.length).toBe(1));
    const runningId = ctx!.activeEntries[0].id;

    let release: (() => void) | undefined;
    let pauseReachedWrite = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const realPutEntry = db.putEntry;
    const putSpy = vi.spyOn(db, 'putEntry').mockImplementation(async (entry) => {
      if (entry.id === runningId && entry.isPaused) {
        pauseReachedWrite = true;
        await held;
      }
      return realPutEntry(entry);
    });

    try {
      await act(async () => {
        const pausing = ctx!.pauseTimer(runningId);
        while (!pauseReachedWrite) await new Promise((r) => setTimeout(r, 1));

        const stopping = ctx!.stopTimer(runningId);
        await new Promise((r) => setTimeout(r, 20));

        release!();
        await Promise.all([pausing, stopping]);
      });
    } finally {
      putSpy.mockRestore();
    }

    const stored = await db.getEntry(runningId);
    expect(stored!.isRunning).toBe(false);
    expect(stored!.isPaused).toBe(false);
    expect(stored!.endTime).not.toBeNull();
  });

  it('note autosave updates state without re-reading every entry', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Note TC')).id;
      await ctx!.startTimer(tcId, 'first');
    });
    await waitFor(() => expect(ctx!.activeEntries.length).toBe(1));
    const runningId = ctx!.activeEntries[0].id;

    const getEntriesSpy = vi.spyOn(db, 'getEntries');
    await act(async () => {
      await ctx!.updateActiveNote(runningId, 'typed while running', ['a']);
    });

    // The visible state is current...
    await waitFor(() => {
      expect(ctx!.activeEntries[0].note).toBe('typed while running');
      expect(ctx!.entries.find((e) => e.id === runningId)?.note).toBe('typed while running');
    });
    // ...without a full reload, which this path ran on every keystroke pause.
    expect(getEntriesSpy).not.toHaveBeenCalled();
    getEntriesSpy.mockRestore();
  });

  it('M5: splitEntry ignores trashed entries and sets explicit pauseEnd on crossing pause segments', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Split TC')).id;
      await ctx!.addManualEntry({
        startTime: '2024-02-01T10:00:00Z',
        endTime: '2024-02-01T12:00:00Z',
        timecodeId: tcId,
        note: 'Entry with crossing open pause',
        pausedSegments: [{ pauseStart: '2024-02-01T10:30:00Z' } as any],
      });
    });

    let entry: any;
    await waitFor(() => {
      entry = ctx!.entries.find((e) => e.note === 'Entry with crossing open pause');
      expect(entry).toBeDefined();
    });

    // Splitting at 11:00 (crossing the pause starting at 10:30)
    await act(async () => {
      await ctx!.splitEntry(entry.id, '2024-02-01T11:00:00Z');
    });

    await waitFor(() => expect(ctx!.entries.length).toBe(2));

    const e1 = ctx!.entries.find((e) => e.id === entry.id)!;
    const e2 = ctx!.entries.find((e) => e.id !== entry.id)!;

    // Both halves should have explicit pauseEnd values
    expect(e1.pausedSegments[0].pauseEnd).toBe('2024-02-01T11:00:00.000Z');
    expect(e2.pausedSegments[0].pauseEnd).toBe('2024-02-01T12:00:00.000Z');

    // Attempting to split a soft-deleted entry should do nothing
    await act(async () => {
      await ctx!.deleteEntry(e1.id);
      await ctx!.splitEntry(e1.id, '2024-02-01T10:30:00Z');
    });

    const refreshedE1 = await db.getEntry(e1.id);
    expect(refreshedE1?.deletedAt).toBeDefined();
  });

  it('M6: mergeTimecodes guards against same-ID and throws on overlapping entries / multiple running timers', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tc1 = '';
    let tc2 = '';
    await act(async () => {
      tc1 = (await ctx!.addTimecode('TC 1')).id;
      tc2 = (await ctx!.addTimecode('TC 2')).id;

      await ctx!.addManualEntry({
        startTime: '2024-02-01T10:00:00Z',
        endTime: '2024-02-01T11:00:00Z',
        timecodeId: tc1,
        note: 'Entry 1',
      });
      await ctx!.addManualEntry({
        startTime: '2024-02-01T10:30:00Z',
        endTime: '2024-02-01T11:30:00Z',
        timecodeId: tc2,
        note: 'Entry 2',
      });
    });

    // Guard against same-ID merge
    await act(async () => {
      await ctx!.mergeTimecodes(tc1, tc1);
    });
    expect(await db.getTimecode(tc1)).toBeDefined();

    // Merging overlapping entries throws an error
    await expect(ctx!.mergeTimecodes(tc1, tc2)).rejects.toThrow('resulting entries would overlap');
  });

  it('M7: emptyTrash and hardDeleteGroup read directly from DB ignoring stale state snapshot', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    const now = new Date().toISOString();
    const grpId = await db.putGroup({ id: 'g-stale', name: 'Stale Group', color: '#123456', archived: false, deletedAt: now, updatedAt: now });
    const tcId = await db.putTimecode({ id: 'tc-stale', name: 'Stale TC', groupId: grpId, hourlyRate: null, archived: false, deletedAt: now, updatedAt: now });
    await db.putEntry({
      id: 'e-stale',
      timecodeId: tcId,
      startTime: now,
      endTime: now,
      duration: 0,
      note: 'stale entry',
      tags: [],
      isRunning: false,
      isPaused: false,
      pausedSegments: [],
      editHistory: [],
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    // Empty trash should find items in DB even if not in current React state snapshot
    await act(async () => {
      await ctx!.emptyTrash();
    });

    expect(await db.getGroup('g-stale')).toBeUndefined();
    expect(await db.getTimecode('tc-stale')).toBeUndefined();
    expect(await db.getEntry('e-stale')).toBeUndefined();
  });

  it('C3: emptyTrash accumulates template removals correctly without clobbering', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcAId = '';
    let tcBId = '';
    let tcKeepId = '';
    await act(async () => {
      tcAId = (await ctx!.addTimecode('Trash A')).id;
      tcBId = (await ctx!.addTimecode('Trash B')).id;
      tcKeepId = (await ctx!.addTimecode('Keep')).id;

      await ctx!.updateSettings({
        templates: [
          { id: 'tmpl-1', title: 'Temp A', timecodeId: tcAId, note: '', tags: [], durationMinutes: null },
          { id: 'tmpl-2', title: 'Temp B', timecodeId: tcBId, note: '', tags: [], durationMinutes: null },
          { id: 'tmpl-3', title: 'Temp Keep', timecodeId: tcKeepId, note: '', tags: [], durationMinutes: null },
        ],
      });
    });

    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    await act(async () => {
      await ctx!.deleteTimecode(tcAId);
      await ctx!.deleteTimecode(tcBId);
    });

    await act(async () => {
      await ctx!.emptyTrash();
    });

    await waitFor(() => {
      const remainingTemplates = ctx!.settings?.templates || [];
      expect(remainingTemplates.length).toBe(1);
      expect(remainingTemplates[0].timecodeId).toBe(tcKeepId);
    });

    vi.restoreAllMocks();
  });

  it('C3: emptyTrash skips purging timecodes that have live entries', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Timecode')).id;
      await ctx!.addManualEntry({
        startTime: '2024-02-01T10:00:00Z',
        endTime: '2024-02-01T11:00:00Z',
        timecodeId: tcId,
        note: 'Live Entry',
      });
    });

    let entryId = '';
    await waitFor(() => {
      expect(ctx!.entries.length).toBe(1);
      entryId = ctx!.entries[0].id;
    });

    // Manually soft-delete timecode in DB directly while entry remains live
    const now = new Date().toISOString();
    const tcObj = (await db.getTimecode(tcId))!;
    await db.putTimecode({ ...tcObj, deletedAt: now, updatedAt: now });
    await ctx!.refreshData();

    await waitFor(() => {
      expect(ctx!.entries.some((e) => e.id === entryId)).toBe(true);
      expect(ctx!.deletedTimecodes.some((t) => t.id === tcId)).toBe(true);
    });

    // Empty trash
    await act(async () => {
      await ctx!.emptyTrash();
    });

    await waitFor(async () => {
      // Live entry was NOT destroyed and timecode was NOT purged because of live entry
      expect(ctx!.entries.some((e) => e.id === entryId)).toBe(true);
      const tc = await db.getTimecode(tcId);
      expect(tc).toBeDefined();
    });
  });

  it('C4: deleteEntry and bulkDeleteEntries stop running timers before trashing', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Running TC')).id;
      await ctx!.startTimer(tcId, 'Timer 1');
    });

    let runningEntryId = '';
    await waitFor(() => {
      expect(ctx!.activeEntries.length).toBe(1);
      runningEntryId = ctx!.activeEntries[0].id;
    });

    // Trashing the single running entry
    await act(async () => {
      await ctx!.deleteEntry(runningEntryId);
    });

    await waitFor(() => {
      expect(ctx!.activeEntries.length).toBe(0);
      const trashed = ctx!.deletedEntries.find((e) => e.id === runningEntryId);
      expect(trashed).toBeDefined();
      expect(trashed!.isRunning).toBe(false);
      expect(trashed!.endTime).not.toBeNull();
    });

    // Test bulkDeleteEntries with running timer
    await act(async () => {
      await ctx!.startTimer(tcId, 'Timer 2');
    });

    let bulkRunningId = '';
    await waitFor(() => {
      expect(ctx!.activeEntries.length).toBe(1);
      bulkRunningId = ctx!.activeEntries[0].id;
    });

    await act(async () => {
      await ctx!.bulkDeleteEntries([bulkRunningId]);
    });

    await waitFor(() => {
      expect(ctx!.activeEntries.length).toBe(0);
      const trashedBulk = ctx!.deletedEntries.find((e) => e.id === bulkRunningId);
      expect(trashedBulk).toBeDefined();
      expect(trashedBulk!.isRunning).toBe(false);
      expect(trashedBulk!.endTime).not.toBeNull();
    });
  });

  it('M8: restoreEntryInternal restores parent timecode and all sibling entries deleted with it', async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    let tcId = '';
    await act(async () => {
      tcId = (await ctx!.addTimecode('Parent TC')).id;
      await ctx!.addManualEntry({
        startTime: '2024-02-01T10:00:00Z',
        endTime: '2024-02-01T11:00:00Z',
        timecodeId: tcId,
        note: 'Entry A',
      });
      await ctx!.addManualEntry({
        startTime: '2024-02-01T11:00:00Z',
        endTime: '2024-02-01T12:00:00Z',
        timecodeId: tcId,
        note: 'Entry B',
      });
    });

    // Delete timecode (which cascades delete to Entry A and Entry B)
    await act(async () => {
      await ctx!.deleteTimecode(tcId);
    });

    let entryA: any;
    await waitFor(() => {
      entryA = ctx!.deletedEntries.find((e) => e.note === 'Entry A');
      expect(entryA).toBeDefined();
    });

    // Restoring Entry A should restore Parent TC AND Entry B
    await act(async () => {
      await ctx!.restoreEntry(entryA.id);
    });

    await waitFor(() => {
      expect(ctx!.timecodes.some((t) => t.id === tcId)).toBe(true);
      expect(ctx!.entries.some((e) => e.note === 'Entry A')).toBe(true);
      expect(ctx!.entries.some((e) => e.note === 'Entry B')).toBe(true);
      expect(ctx!.deletedEntries.length).toBe(0);
    });
  });
  // --- H2: autoPurgeTrash ---

  const OLD = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

  const seedTimecode = (id: string, over: Partial<import('../types').Timecode> = {}) => ({
    id, name: id, groupId: null, hourlyRate: null, archived: false,
    updatedAt: OLD, ...over,
  });

  const seedEntry = (id: string, timecodeId: string, over: Partial<import('../types').Entry> = {}) => ({
    id, timecodeId, startTime: OLD, endTime: OLD, duration: 60, note: id,
    isRunning: false, isPaused: false, pausedSegments: [], editHistory: [],
    createdAt: OLD, updatedAt: OLD, ...over,
  });

  it('autoPurgeTrash strips templates for timecodes it hard-deletes', async () => {
    await db.putTimecode(seedTimecode('tc-old', { deletedAt: OLD }));
    await db.putEntry(seedEntry('e-old', 'tc-old', { deletedAt: OLD }));
    await db.putTimecode(seedTimecode('tc-live'));
    await db.putSettings({
      id: 'user-settings',
      lastBackupDate: null,
      reminderIntervalDays: 7,
      roundingRule: 'none',
      roundingScope: 'day',
      idleThresholdMinutes: null,
      weeklyTargetHours: null,
      allowConcurrentTimers: false,
      overrunAudioAlertEnabled: true,
      theme: 'dark',
      templates: [
        { id: 'tpl-old', title: 'Old', timecodeId: 'tc-old', note: '', tags: [], durationMinutes: null },
        { id: 'tpl-live', title: 'Live', timecodeId: 'tc-live', note: '', tags: [], durationMinutes: null },
      ],
    });

    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={() => {}} />
      </TimeTrackerProvider></ToastProvider>
    );

    // The purged timecode is gone, and its template goes with it. Left behind,
    // the template points at a hard-deleted id and validateBackupPayload would
    // reject the user's own backup on re-import.
    await waitFor(async () => {
      expect(await db.getTimecode('tc-old')).toBeUndefined();
      const settings = await db.getSettings();
      expect(settings?.templates?.map((t) => t.id)).toEqual(['tpl-live']);
    });
  });

  it('autoPurgeTrash keeps a trashed timecode that still has live entries', async () => {
    await db.putTimecode(seedTimecode('tc-old', { deletedAt: OLD }));
    // Restored from the trash without restoring its timecode — a reachable
    // state, since restoreEntry and restoreTimecode are separate actions.
    await db.putEntry(seedEntry('e-live', 'tc-old'));

    let ctx: ReturnType<typeof useTimeTracker> | undefined;
    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );

    await waitFor(() => expect(ctx?.settings).not.toBeNull());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect(await db.getEntry('e-live')).toBeDefined();
    expect(await db.getTimecode('tc-old')).toBeDefined();
  });
  // --- H5: splitEntry ---

  const NOW_ISO = new Date().toISOString();
  const liveEntry = (id: string, timecodeId: string, startTime: string, endTime: string, over: Partial<import('../types').Entry> = {}) => ({
    id, timecodeId, startTime, endTime,
    duration: Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000),
    note: id, isRunning: false, isPaused: false, pausedSegments: [], editHistory: [],
    createdAt: NOW_ISO, updatedAt: NOW_ISO, ...over,
  });

  const renderCtx = async () => {
    let ctx: ReturnType<typeof useTimeTracker> | undefined;
    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );
    await waitFor(() => expect(ctx?.settings).not.toBeNull());
    return () => ctx!;
  };

  it('splitEntry divides the estimate between the halves instead of dropping it', async () => {
    await db.putTimecode(seedTimecode('tc-split', { updatedAt: NOW_ISO }));
    // 10:00 -> 14:00 split at 11:00 is a 1h/3h split of a 120-minute estimate.
    await db.putEntry(liveEntry('e-est', 'tc-split', '2024-06-01T10:00:00.000Z', '2024-06-01T14:00:00.000Z', {
      expectedDurationMinutes: 120,
    }));
    const getCtx = await renderCtx();

    let result: import('./TimeTrackerContext').SplitEntryResult | undefined;
    await act(async () => {
      result = await getCtx().splitEntry('e-est', '2024-06-01T11:00:00.000Z');
    });

    expect(result!.ok).toBe(true);
    expect(result!.ok && result!.estimateSplit).toBe(true);

    await waitFor(() => {
      const halves = getCtx().entries.filter((e) => e.timecodeId === 'tc-split');
      expect(halves.length).toBe(2);
      const estimates = halves.map((e) => e.expectedDurationMinutes ?? 0).sort((a, b) => a - b);
      // Proportional to tracked time, and summing back to the original estimate.
      expect(estimates).toEqual([30, 90]);
    });
  });

  it('splitEntry keeps a flat fee on the half the caller names', async () => {
    await db.putTimecode(seedTimecode('tc-fee', { updatedAt: NOW_ISO }));
    await db.putEntry(liveEntry('e-fee', 'tc-fee', '2024-06-01T10:00:00.000Z', '2024-06-01T12:00:00.000Z', {
      manualAmount: 250,
    }));
    const getCtx = await renderCtx();

    await act(async () => {
      await getCtx().splitEntry('e-fee', '2024-06-01T11:00:00.000Z', undefined, { feeAllocation: 'second' });
    });

    await waitFor(() => {
      const halves = getCtx().entries.filter((e) => e.timecodeId === 'tc-fee');
      expect(halves.length).toBe(2);
      // The money survives the split, on exactly one half.
      expect(halves.filter((e) => e.manualAmount === 250).length).toBe(1);
      expect(halves.filter((e) => e.manualAmount == null).length).toBe(1);
      expect(halves.find((e) => e.startTime === '2024-06-01T11:00:00.000Z')!.manualAmount).toBe(250);
    });
  });

  it('splitEntry reports why it declined instead of silently doing nothing', async () => {
    await db.putTimecode(seedTimecode('tc-dec', { updatedAt: NOW_ISO }));
    await db.putEntry(liveEntry('e-dec', 'tc-dec', '2024-06-01T10:00:00.000Z', '2024-06-01T12:00:00.000Z'));
    await db.putEntry(liveEntry('e-run', 'tc-dec', '2024-06-02T10:00:00.000Z', '2024-06-02T12:00:00.000Z', {
      endTime: null, isRunning: true,
    }));
    const getCtx = await renderCtx();

    let missing!: import('./TimeTrackerContext').SplitEntryResult;
    let outOfRange!: import('./TimeTrackerContext').SplitEntryResult;
    let running!: import('./TimeTrackerContext').SplitEntryResult;
    await act(async () => {
      missing = await getCtx().splitEntry('no-such-entry', '2024-06-01T11:00:00.000Z');
      outOfRange = await getCtx().splitEntry('e-dec', '2024-06-01T09:00:00.000Z');
      running = await getCtx().splitEntry('e-run', '2024-06-02T11:00:00.000Z');
    });

    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.reason).toMatch(/no longer exists/i);
    expect(outOfRange.ok).toBe(false);
    expect(!outOfRange.ok && outOfRange.reason).toMatch(/between/i);
    expect(running.ok).toBe(false);
    expect(!running.ok && running.reason).toMatch(/running timer/i);
  });
  // --- H6: merge-mode import ---

  /**
   * Builds a backup File the way an export does, using the fallback checksum
   * (crypto.subtle is not available under jsdom).
   */
  const backupFile = (payload: Record<string, unknown>): File => {
    const body = {
      groups: [], timecodes: [], entries: [], settings: undefined,
      ...payload,
      schemaVersion: 1,
      checksumAlgorithm: 'fallback',
    };
    const payloadString = JSON.stringify(body);
    let hash = 0;
    for (let i = 0; i < payloadString.length; i++) {
      hash = (hash << 5) - hash + payloadString.charCodeAt(i);
      hash = hash & hash;
    }
    return new File(
      [JSON.stringify({ ...body, checksum: hash.toString(16) })],
      'backup.json',
      { type: 'application/json' }
    );
  };

  const settingsFixture = (over: Partial<import('../types').Settings> = {}): import('../types').Settings => ({
    id: 'user-settings',
    lastBackupDate: null,
    reminderIntervalDays: 7,
    roundingRule: 'none',
    roundingScope: 'day',
    idleThresholdMinutes: null,
    weeklyTargetHours: null,
    allowConcurrentTimers: false,
    overrunAudioAlertEnabled: true,
    theme: 'dark',
    ...over,
  });

  it('a merge import does not overwrite newer local settings', async () => {
    await db.putSettings(settingsFixture({ roundingRule: '15min', currencySymbol: 'NZ$' }));
    const localAt = (await db.getSettings())!.updatedAt!;

    // The file is older than what is stored locally.
    await db.importBackup({
      groups: [], timecodes: [], entries: [],
      settings: settingsFixture({
        roundingRule: 'none',
        currencySymbol: 'EUR',
        updatedAt: new Date(new Date(localAt).getTime() - 60_000).toISOString(),
        templates: [{ id: 'tpl-file', title: 'From file', timecodeId: 'tc-x', note: '', tags: [], durationMinutes: null }],
      }),
    }, 'merge');

    const after = await db.getSettings();
    // Single-valued preferences are kept...
    expect(after!.roundingRule).toBe('15min');
    expect(after!.currencySymbol).toBe('NZ$');
    // ...while templates still merge, which is what "merge" should mean.
    expect(after!.templates?.map((t) => t.id)).toEqual(['tpl-file']);
  });

  it('a merge import applies settings from a file that is newer', async () => {
    await db.putSettings(settingsFixture({ roundingRule: '15min' }));
    const localAt = (await db.getSettings())!.updatedAt!;

    await db.importBackup({
      groups: [], timecodes: [], entries: [],
      settings: settingsFixture({
        roundingRule: '5min',
        updatedAt: new Date(new Date(localAt).getTime() + 60_000).toISOString(),
      }),
    }, 'merge');

    expect((await db.getSettings())!.roundingRule).toBe('5min');
  });

  it('putSettings stamps updatedAt so the comparison has something to compare', async () => {
    const before = Date.now();
    await db.putSettings(settingsFixture());
    const stored = await db.getSettings();
    expect(stored!.updatedAt).toBeTruthy();
    expect(new Date(stored!.updatedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('a merge import skips entries that overlap time already recorded', async () => {
    await db.putTimecode(seedTimecode('tc-ov', { updatedAt: NOW_ISO }));
    await db.putEntry(liveEntry('e-local', 'tc-ov', '2024-07-01T09:00:00.000Z', '2024-07-01T11:00:00.000Z'));

    const getCtx = await renderCtx();
    await waitFor(() => expect(getCtx().entries.length).toBe(1));

    // One incoming entry sits inside the local one; the other is clear of it.
    const payload = {
      schemaVersion: 1,
      groups: [],
      timecodes: [seedTimecode('tc-ov', { updatedAt: NOW_ISO })],
      entries: [
        liveEntry('e-clash', 'tc-ov', '2024-07-01T10:00:00.000Z', '2024-07-01T10:30:00.000Z'),
        liveEntry('e-clear', 'tc-ov', '2024-07-01T13:00:00.000Z', '2024-07-01T14:00:00.000Z'),
      ],
    };
    const file = backupFile(payload);

    await act(async () => { await getCtx().importData(file, 'merge'); });

    await waitFor(() => {
      const ids = getCtx().entries.map((e) => e.id).sort();
      expect(ids).toEqual(['e-clear', 'e-local']);
    });
  });
  // --- H8: storage write failures ---

  it('reports a failed write instead of leaving the UI showing unsaved state', async () => {
    await db.putTimecode(seedTimecode('tc-quota', { updatedAt: NOW_ISO }));

    const getCtx = await renderCtx();

    // The connection is healthy; this one write fails, exactly as a
    // QuotaExceededError or a Safari private-mode rejection does.
    const quotaError = Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
    const putSpy = vi.spyOn(db, 'putEntry').mockRejectedValueOnce(quotaError);

    await act(async () => {
      await getCtx().addManualEntry({
        startTime: '2024-08-01T09:00:00.000Z',
        endTime: '2024-08-01T10:00:00.000Z',
        timecodeId: 'tc-quota',
        note: 'never stored',
      });
    });

    expect(putSpy).toHaveBeenCalled();
    // The rejection was caught rather than becoming unhandled...
    expect(await db.getEntries()).toHaveLength(0);
    // ...and the list does not show an entry that was never written.
    expect(getCtx().entries.find((e) => e.note === 'never stored')).toBeUndefined();

    putSpy.mockRestore();
  });

  it('rolls back an optimistic settings change when the write fails', async () => {
    const getCtx = await renderCtx();
    await act(async () => { await getCtx().updateSettings({ roundingRule: '15min' }); });
    await waitFor(() => expect(getCtx().settings?.roundingRule).toBe('15min'));

    const putSpy = vi.spyOn(db, 'putSettings').mockRejectedValueOnce(new Error('QuotaExceededError'));
    await act(async () => { await getCtx().updateSettings({ roundingRule: '5min' }); });

    // The panel must not keep showing a preference that was never stored.
    await waitFor(() => expect(getCtx().settings?.roundingRule).toBe('15min'));
    expect((await db.getSettings())?.roundingRule).toBe('15min');

    putSpy.mockRestore();
  });

  // --- C1: a split is one write or none ---

  it('splitEntry leaves the original whole when the second half cannot be stored', async () => {
    await db.putTimecode(seedTimecode('tc-atomic', { updatedAt: NOW_ISO }));
    await db.putEntry(liveEntry('e-atomic', 'tc-atomic', '2024-06-01T10:00:00.000Z', '2024-06-01T12:00:00.000Z', {
      manualAmount: 500,
    }));
    const getCtx = await renderCtx();
    await waitFor(() => expect(getCtx().entries.length).toBe(1));

    // Written as two sequential puts, a failure here truncated the original to
    // the first half and lost the second half — and the fee on it — outright.
    const quotaError = Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
    const putSpy = vi.spyOn(db, 'putEntries').mockRejectedValueOnce(quotaError);

    let result: import('./TimeTrackerContext').SplitEntryResult | undefined;
    await act(async () => {
      result = await getCtx().splitEntry('e-atomic', '2024-06-01T11:00:00.000Z');
    });

    expect(result!.ok).toBe(false);

    const stored = await db.getEntries();
    expect(stored.length).toBe(1);
    expect(stored[0].id).toBe('e-atomic');
    expect(stored[0].endTime).toBe('2024-06-01T12:00:00.000Z');
    expect(stored[0].manualAmount).toBe(500);

    putSpy.mockRestore();
  });

  it('splitEntry writes both halves in one transaction', async () => {
    await db.putTimecode(seedTimecode('tc-tx', { updatedAt: NOW_ISO }));
    await db.putEntry(liveEntry('e-tx', 'tc-tx', '2024-06-01T10:00:00.000Z', '2024-06-01T12:00:00.000Z'));
    const getCtx = await renderCtx();
    await waitFor(() => expect(getCtx().entries.length).toBe(1));

    const putEntriesSpy = vi.spyOn(db, 'putEntries');
    const putEntrySpy = vi.spyOn(db, 'putEntry');

    await act(async () => {
      await getCtx().splitEntry('e-tx', '2024-06-01T11:00:00.000Z');
    });

    expect(putEntriesSpy).toHaveBeenCalledTimes(1);
    expect(putEntriesSpy.mock.calls[0][0]).toHaveLength(2);
    expect(putEntrySpy).not.toHaveBeenCalled();

    putEntriesSpy.mockRestore();
    putEntrySpy.mockRestore();
  });

  // --- C2: a mutation reports whether it stored anything ---

  it('the write-returning mutations resolve false when the write fails', async () => {
    await db.putTimecode(seedTimecode('tc-bool', { updatedAt: NOW_ISO }));
    await db.putEntry(liveEntry('e-bool', 'tc-bool', '2024-06-02T10:00:00.000Z', '2024-06-02T11:00:00.000Z'));
    const getCtx = await renderCtx();
    await waitFor(() => expect(getCtx().entries.length).toBe(1));

    const quotaError = Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });

    let updated: boolean | undefined;
    const entrySpy = vi.spyOn(db, 'putEntry').mockRejectedValueOnce(quotaError);
    await act(async () => { updated = await getCtx().updateEntry('e-bool', { note: 'edited' }); });
    expect(updated).toBe(false);
    entrySpy.mockRestore();

    let added: boolean | undefined;
    const addSpy = vi.spyOn(db, 'putEntry').mockRejectedValueOnce(quotaError);
    await act(async () => {
      added = await getCtx().addManualEntry({
        startTime: '2024-06-03T09:00:00.000Z',
        endTime: '2024-06-03T10:00:00.000Z',
        timecodeId: 'tc-bool',
        note: 'never stored',
      });
    });
    expect(added).toBe(false);
    addSpy.mockRestore();

    let settingsSaved: boolean | undefined;
    const settingsSpy = vi.spyOn(db, 'putSettings').mockRejectedValueOnce(quotaError);
    await act(async () => { settingsSaved = await getCtx().updateSettings({ roundingRule: '10min' }); });
    expect(settingsSaved).toBe(false);
    settingsSpy.mockRestore();

    let tcSaved: boolean | undefined;
    const tcSpy = vi.spyOn(db, 'putTimecode').mockRejectedValueOnce(quotaError);
    await act(async () => { tcSaved = await getCtx().updateTimecode('tc-bool', { name: 'renamed' }); });
    expect(tcSaved).toBe(false);
    tcSpy.mockRestore();

    let groupId = '';
    await act(async () => { groupId = (await getCtx().addGroup('G', '#fff')).id; });
    let groupSaved: boolean | undefined;
    const groupSpy = vi.spyOn(db, 'putGroup').mockRejectedValueOnce(quotaError);
    await act(async () => { groupSaved = await getCtx().updateGroup(groupId, { name: 'renamed' }); });
    expect(groupSaved).toBe(false);
    groupSpy.mockRestore();
  });

  it('the same mutations resolve true on a write that lands', async () => {
    await db.putTimecode(seedTimecode('tc-ok', { updatedAt: NOW_ISO }));
    await db.putEntry(liveEntry('e-ok', 'tc-ok', '2024-06-04T10:00:00.000Z', '2024-06-04T11:00:00.000Z'));
    const getCtx = await renderCtx();
    await waitFor(() => expect(getCtx().entries.length).toBe(1));

    let updated: boolean | undefined;
    await act(async () => { updated = await getCtx().updateEntry('e-ok', { note: 'edited' }); });
    expect(updated).toBe(true);

    let settingsSaved: boolean | undefined;
    await act(async () => { settingsSaved = await getCtx().updateSettings({ roundingRule: '10min' }); });
    expect(settingsSaved).toBe(true);

    // An entry that is not there was never saved either, however healthy the
    // database is — the caller must not report that as success.
    let missing: boolean | undefined;
    await act(async () => { missing = await getCtx().updateEntry('no-such-entry', { note: 'x' }); });
    expect(missing).toBe(false);
  });

  // --- H2: updateEntry takes the timer queue ---

  it('a stop landing mid-edit is not overwritten by the pre-stop copy', async () => {
    await db.putTimecode(seedTimecode('tc-race', { updatedAt: NOW_ISO }));
    const getCtx = await renderCtx();

    let runningId = '';
    await act(async () => { await getCtx().startTimer('tc-race'); });
    await waitFor(() => {
      expect(getCtx().activeEntries.length).toBe(1);
      runningId = getCtx().activeEntries[0].id;
    });

    // Hold updateEntry's read open, start a stop behind it, then let it finish.
    // Without the queue the edit writes the whole record back from the copy it
    // read before the stop, resurrecting the timer and losing the end time.
    let releaseRead: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const realGetEntry = db.getEntry;
    const getSpy = vi.spyOn(db, 'getEntry').mockImplementationOnce(async (id: string) => {
      const value = await realGetEntry(id);
      await gate;
      return value;
    });

    await act(async () => {
      const editing = getCtx().updateEntry(runningId, { note: 'edited while running' });
      const stopping = getCtx().stopTimer(runningId);

      // Give the stop every chance to land before the edit's write, rather than
      // guessing at a delay. Serialised it never can — the edit holds the queue
      // — so this waits out its ceiling and the stop runs after the edit, and
      // both stick. Unserialised the stop lands here, and the edit then writes
      // the copy it read before it straight over the top.
      for (let waited = 0; waited < 400; waited += 20) {
        // The unspied read: the one-shot mock belongs to updateEntry's own read,
        // and consuming it here would gate this poll instead and deadlock.
        if (!(await realGetEntry(runningId))!.isRunning) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      releaseRead();
      await Promise.all([editing, stopping]);
    });

    const stored = await db.getEntry(runningId);
    expect(stored!.isRunning).toBe(false);
    expect(stored!.endTime).toBeTruthy();
    expect(stored!.note).toBe('edited while running');

    getSpy.mockRestore();
  });

  // --- H6: undoing a stop reports a failed write ---

  it('undoStopTimer surfaces a failed write instead of leaving the timer stopped in silence', async () => {
    await db.putTimecode(seedTimecode('tc-undo', { updatedAt: NOW_ISO }));
    const getCtx = await renderCtx();

    let runningId = '';
    await act(async () => { await getCtx().startTimer('tc-undo'); });
    await waitFor(() => {
      expect(getCtx().activeEntries.length).toBe(1);
      runningId = getCtx().activeEntries[0].id;
    });

    await act(async () => { await getCtx().stopTimer(runningId); });
    await waitFor(() => expect(getCtx().lastStoppedEntry?.id).toBe(runningId));

    const stopped = getCtx().lastStoppedEntry!;
    const quotaError = Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
    const putSpy = vi.spyOn(db, 'putEntry').mockRejectedValueOnce(quotaError);

    // Invoked the way the toast invokes it: nothing awaits the result, so an
    // unwrapped rejection here surfaced as an unhandled one and told the user
    // nothing at all.
    await act(async () => { await getCtx().undoStopTimer(stopped); });

    const stored = await db.getEntry(runningId);
    expect(stored!.isRunning).toBe(false);
    expect(getCtx().lastStoppedEntry).toBeNull();

    putSpy.mockRestore();
  });

  // --- H4: restoring a deleted template merges rather than replays ---

  it('restoreTemplate keeps a template created inside the undo window', async () => {
    const getCtx = await renderCtx();
    await act(async () => {
      await getCtx().updateSettings({
        templates: [
          { id: 't-deleted', title: 'Deleted', timecodeId: 'tc-1', durationMinutes: 15, note: '' },
          { id: 't-kept', title: 'Kept', timecodeId: 'tc-1', durationMinutes: 30, note: '' },
        ],
      });
    });

    const removed = getCtx().settings!.templates!.find((t) => t.id === 't-deleted')!;
    const afterDelete = getCtx().settings!.templates!.filter((t) => t.id !== 't-deleted');
    await act(async () => { await getCtx().updateSettings({ templates: afterDelete }); });

    // A new template arrives before the undo toast expires.
    await act(async () => {
      await getCtx().updateSettings({
        templates: [
          ...getCtx().settings!.templates!,
          { id: 't-new', title: 'New', timecodeId: 'tc-1', durationMinutes: 45, note: '' },
        ],
      });
    });

    await act(async () => { await getCtx().restoreTemplate(removed, 0); });

    const ids = (await db.getSettings())!.templates!.map((t) => t.id);
    // Replaying the pre-delete snapshot would have written 't-new' away.
    expect(ids).toEqual(['t-deleted', 't-kept', 't-new']);
  });
});
