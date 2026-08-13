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
