import { differenceInSeconds } from 'date-fns';
import type { Entry, PauseSegment } from '../types';

export const checkOverlap = (start: Date, end: Date, entries: Entry[], excludeId?: string, timecodeId?: string, allowConcurrentTimers?: boolean): boolean => {
  return entries.some(e => {
    if (excludeId && e.id === excludeId) return false;
    if (!e.endTime) return false;
    if (allowConcurrentTimers && e.timecodeId !== timecodeId) return false;

    const eStart = new Date(e.startTime);
    const eEnd = new Date(e.endTime);

    // Check overlap: newStart < eEnd AND newEnd > eStart
    return start < eEnd && end > eStart;
  });
};

export const applyRounding = (seconds: number, roundingRule: 'none' | '5min' | '10min' | '15min'): number => {
  if (roundingRule === 'none') return seconds;

  let roundingInterval = 1;
  if (roundingRule === '5min') roundingInterval = 5 * 60;
  if (roundingRule === '10min') roundingInterval = 10 * 60;
  if (roundingRule === '15min') roundingInterval = 15 * 60;

  return Math.round(seconds / roundingInterval) * roundingInterval;
};

export const calculateDuration = (start: Date, end: Date, pausedSegments: PauseSegment[]): number => {
  let totalPauseSeconds = 0;
  pausedSegments.forEach(segment => {
    const pStart = new Date(segment.pauseStart);
    const pEnd = segment.pauseEnd ? new Date(segment.pauseEnd) : end;
    totalPauseSeconds += differenceInSeconds(pEnd, pStart);
  });

  let duration = differenceInSeconds(end, start) - totalPauseSeconds;
  return Math.max(0, duration);
};

export const getElapsedTimeMs = (startTime: string, pausedSegments: PauseSegment[], endTimeOverride?: string): number => {
  const now = endTimeOverride ? new Date(endTimeOverride).getTime() : Date.now();
  const start = new Date(startTime).getTime();

  let totalPauseMs = 0;
  pausedSegments.forEach(segment => {
    const pStart = new Date(segment.pauseStart).getTime();
    const pEnd = segment.pauseEnd ? new Date(segment.pauseEnd).getTime() : now;
    totalPauseMs += Math.max(0, pEnd - pStart);
  });

  return Math.max(0, now - start - totalPauseMs);
};

export const formatElapsedSeconds = (totalSeconds: number): string => {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const pad = (num: number) => num.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
};
