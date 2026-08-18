import { describe, it, expect } from 'vitest';
import type { Entry, Timecode, Group } from '../types';

describe('AnalysisView lookups performance benchmark', () => {
  // Generate mock data
  const NUM_GROUPS = 100;
  const NUM_TIMECODES = 500;
  const NUM_ENTRIES = 10000;

  const groups: Group[] = Array.from({ length: NUM_GROUPS }, (_, i) => ({
    id: `group-${i}`,
    name: `Group ${i}`,
    color: '#123456',
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const timecodes: Timecode[] = Array.from({ length: NUM_TIMECODES }, (_, i) => ({
    id: `tc-${i}`,
    groupId: `group-${i % NUM_GROUPS}`,
    name: `Timecode ${i}`,
    color: '#654321',
    hourlyRate: 50,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const entries: Entry[] = Array.from({ length: NUM_ENTRIES }, (_, i) => ({
    id: `entry-${i}`,
    timecodeId: `tc-${i % NUM_TIMECODES}`,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    duration: 3600,
    note: `Note ${i}`,
    isRunning: false,
    isPaused: false,
    pausedSegments: [],
    editHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  it('measures array.find baseline performance', () => {
    const start = performance.now();

    const rows = entries.map(e => {
      const tc = timecodes.find(t => t.id === e.timecodeId);
      const grp = groups.find(g => g.id === tc?.groupId);
      return [
        e.startTime,
        tc?.name ?? 'Unknown',
        grp?.name ?? 'Ungrouped',
        e.duration,
        e.note,
      ].join(',');
    });

    const end = performance.now();
    const duration = end - start;
    console.log(`Baseline Array.find duration for ${NUM_ENTRIES} entries: ${duration.toFixed(2)} ms`);
    expect(rows.length).toBe(NUM_ENTRIES);
  });

  it('measures Map lookup performance', () => {
    const start = performance.now();

    const timecodeMap = new Map(timecodes.map(t => [t.id, t]));
    const groupMap = new Map(groups.map(g => [g.id, g]));

    const rows = entries.map(e => {
      const tc = timecodeMap.get(e.timecodeId);
      const grp = tc?.groupId ? groupMap.get(tc.groupId) : undefined;
      return [
        e.startTime,
        tc?.name ?? 'Unknown',
        grp?.name ?? 'Ungrouped',
        e.duration,
        e.note,
      ].join(',');
    });

    const end = performance.now();
    const duration = end - start;
    console.log(`Optimized Map.get duration for ${NUM_ENTRIES} entries: ${duration.toFixed(2)} ms`);
    expect(rows.length).toBe(NUM_ENTRIES);
  });
});
