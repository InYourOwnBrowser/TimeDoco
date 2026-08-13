import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { TimeTrackerProvider, useTimeTracker } from './TimeTrackerContext';
import { ToastProvider } from './ToastContext';

// Clear DB between tests to ensure a clean state
const DB_NAME = 'time-tracker-db';
const clearDB = () => {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject();
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
    expect(entry!.duration).toBe(2700);

    vi.useRealTimers();
  });
});
