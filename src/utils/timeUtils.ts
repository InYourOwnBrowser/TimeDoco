import type { Entry, PauseSegment } from '../types';

/**
 * Round a monetary amount to whole cents.
 * Amounts are accumulated as floats, so a bare `toFixed(2)` at each display
 * site lets printed line items drift out of step with printed totals. Rounding
 * to cents at the point a value is computed keeps sums exact.
 */
export const roundCurrency = (amount: number): number => {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

/** Round an hours value to the two decimal places used everywhere it is printed. */
export const roundHours = (hours: number): number => {
  if (!Number.isFinite(hours)) return 0;
  return Math.round((hours + Number.EPSILON) * 100) / 100;
};

/**
 * Clamp pause segments to [start, end], discard empty or unparseable ones, and
 * merge any that overlap or touch.
 *
 * Merging matters: the same pause can be recorded twice via the split/edit
 * modals or an imported backup, and summing raw segments would then subtract
 * the overlap more than once — enough to drive an entry's duration to zero.
 * Every duration calculation goes through here so they cannot diverge.
 */
const mergePausedSegments = (
  start: Date,
  end: Date,
  pausedSegments: PauseSegment[] | undefined | null,
): Array<{ start: number; end: number }> => {
  const boundStart = start.getTime();
  const boundEnd = end.getTime();
  if (!Number.isFinite(boundStart) || !Number.isFinite(boundEnd) || boundEnd <= boundStart) return [];
  if (!Array.isArray(pausedSegments) || pausedSegments.length === 0) return [];

  const clamped: Array<{ start: number; end: number }> = [];
  for (const segment of pausedSegments) {
    if (!segment || typeof segment !== 'object') continue;

    const rawStart = new Date(segment.pauseStart).getTime();
    // An open pause segment runs to the end of the window being measured.
    const rawEnd = segment.pauseEnd ? new Date(segment.pauseEnd).getTime() : boundEnd;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;

    const pStart = Math.max(rawStart, boundStart);
    const pEnd = Math.min(rawEnd, boundEnd);
    if (pEnd > pStart) clamped.push({ start: pStart, end: pEnd });
  }

  if (clamped.length === 0) return [];
  clamped.sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [clamped[0]];
  for (let i = 1; i < clamped.length; i++) {
    const last = merged[merged.length - 1];
    const current = clamped[i];
    if (current.start <= last.end) {
      if (current.end > last.end) last.end = current.end;
    } else {
      merged.push(current);
    }
  }
  return merged;
};

const sumPausedMs = (start: Date, end: Date, pausedSegments: PauseSegment[] | undefined | null): number =>
  mergePausedSegments(start, end, pausedSegments).reduce((total, s) => total + (s.end - s.start), 0);

export const calculateTotalPausedSeconds = (start: Date, end: Date, pausedSegments: PauseSegment[]): number => {
  return Math.round(sumPausedMs(start, end, pausedSegments) / 1000);
};

export const formatDurationShort = (totalSeconds: number): string => {
  if (!Number.isFinite(totalSeconds)) return '—';
  if (totalSeconds === 0) return '—';

  const isNegative = totalSeconds < 0;
  const absSeconds = Math.abs(totalSeconds);

  // Round to whole minutes first, then decompose. Rounding the minute part on
  // its own produces impossible readings such as "1h 60m" at 7199 seconds.
  const totalMinutes = Math.round(absSeconds / 60);

  if (totalMinutes === 0) return '—';

  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  let formatted = `${mins}m`;
  if (hrs > 0) {
    formatted = mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }

  return isNegative ? `-${formatted}` : formatted;
};

interface Interval {
  start: number;
  end: number;
  timecodeId: string;
}

/**
 * An entry as a comparable time interval, or null when it cannot block
 * anything. Every overlap check goes through this so the single-candidate and
 * batch paths cannot drift apart on what counts as an overlap.
 */
const toInterval = (e: Entry, now: number): Interval | null => {
  // Trashed entries must never block the creation of a live one.
  if (e.deletedAt) return null;
  const start = new Date(e.startTime).getTime();
  // A running timer effectively ends now.
  const end = e.endTime ? new Date(e.endTime).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, timecodeId: e.timecodeId };
};

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
  a.start < b.end && a.end > b.start;

/**
 * Whether an entry can block a candidate slot, before its times are looked at.
 * `findFreeSlot` and `checkOverlap` share it so they cannot drift apart on what
 * counts as a conflict — a slot found by one and rejected by the other reads to
 * the user as the app refusing its own suggestion.
 */
const isBlocking = (
  entry: Entry,
  excludeId?: string,
  timecodeId?: string,
  allowConcurrentTimers?: boolean,
): boolean => {
  if (excludeId && entry.id === excludeId) return false;
  // Only skip other timecodes when a timecode was actually supplied. Without
  // the explicit check, an omitted `timecodeId` compares `entry.timecodeId`
  // against `undefined`, matches nothing, and disables overlap detection.
  if (allowConcurrentTimers && timecodeId !== undefined && entry.timecodeId !== timecodeId) return false;
  return true;
};

/**
 * The stretches of `day` with nothing in them, in order, clipped to the day.
 *
 * Working from the complement of what is occupied is what makes the whole day
 * reachable. Probing a handful of candidate start times — noon, then the end of
 * each conflicting entry — could only ever find room *after* something, so a
 * morning left free by a 09:00 start was invisible and a day two-thirds empty
 * reported itself full.
 */
const freeIntervalsOn = (
  dayStartMs: number,
  dayEndMs: number,
  entries: Entry[],
  excludeId?: string,
  timecodeId?: string,
  allowConcurrentTimers?: boolean,
): Array<{ start: number; end: number }> => {
  const now = Date.now();
  const occupied: Array<{ start: number; end: number }> = [];

  for (const entry of entries) {
    if (!isBlocking(entry, excludeId, timecodeId, allowConcurrentTimers)) continue;
    const interval = toInterval(entry, now);
    if (!interval) continue;
    const start = Math.max(interval.start, dayStartMs);
    const end = Math.min(interval.end, dayEndMs);
    if (end > start) occupied.push({ start, end });
  }

  occupied.sort((a, b) => a.start - b.start);

  const free: Array<{ start: number; end: number }> = [];
  let cursor = dayStartMs;
  for (const { start, end } of occupied) {
    if (start > cursor) free.push({ start: cursor, end: start });
    if (end > cursor) cursor = end;
  }
  if (cursor < dayEndMs) free.push({ start: cursor, end: dayEndMs });

  return free;
};

/**
 * Somewhere on `day` to put `deltaSeconds` of adjustment without colliding with
 * what is already there, or null when the day has no room for it.
 *
 * Midday is preferred, then anything later, then the earlier part of the day —
 * an adjustment reads most naturally in working hours, but a day whose
 * afternoon is full is not a day that is full. The slot never crosses midnight:
 * it belongs to the day whose cell was edited, and time that spilled onto the
 * next day landed in another rounding bucket and another week's total.
 */
export const findFreeSlot = (
  day: Date,
  deltaSeconds: number,
  entries: Entry[],
  excludeId?: string,
  timecodeId?: string,
  allowConcurrentTimers?: boolean
): { start: Date; end: Date } | null => {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  // The next midnight rather than +24h, so a DST day is 23 or 25 hours long
  // exactly as the calendar has it.
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const lengthMs = deltaSeconds * 1000;
  if (!(lengthMs > 0) || lengthMs > dayEndMs - dayStartMs) return null;

  const free = freeIntervalsOn(dayStartMs, dayEndMs, entries, excludeId, timecodeId, allowConcurrentTimers);

  const noon = new Date(dayStart);
  noon.setHours(12, 0, 0, 0);

  // Midday first, then the whole day from its start; the second pass can only
  // return something the first could not, so the preference is never lost.
  for (const earliest of [noon.getTime(), dayStartMs]) {
    for (const gap of free) {
      const start = Math.max(gap.start, earliest);
      if (start + lengthMs <= gap.end) {
        return { start: new Date(start), end: new Date(start + lengthMs) };
      }
    }
  }

  return null;
};

export const checkOverlap = (start: Date, end: Date, entries: Entry[], excludeId?: string, timecodeId?: string, allowConcurrentTimers?: boolean): boolean => {
  const now = Date.now();
  const candidate = { start: start.getTime(), end: end.getTime() };

  return entries.some(e => {
    if (!isBlocking(e, excludeId, timecodeId, allowConcurrentTimers)) return false;
    const interval = toInterval(e, now);
    return interval ? overlaps(candidate, interval) : false;
  });
};

/**
 * Which of `candidates` overlap an existing entry, or an earlier candidate in
 * the same batch.
 *
 * Checking each candidate against every existing entry is O(n*m), which on a
 * large CSV import against a long history is enough to lock up the tab. This
 * sweeps a start-ordered list instead, keeping only the intervals still open at
 * each point, so the cost is the sort plus a near-linear pass.
 *
 * Candidates are resolved in chronological order, so when two new rows collide
 * the earlier-starting one is kept. That makes the outcome independent of how
 * the source file happened to be ordered — re-sorting a CSV cannot change which
 * of its rows survive. An existing entry always wins over a new row.
 *
 * Returns the indices, into `candidates`, that must be rejected.
 */
export const findOverlappingCandidates = (
  candidates: Entry[],
  existing: Entry[],
  allowConcurrentTimers?: boolean,
): Set<number> => {
  const now = Date.now();
  const rejected = new Set<number>();

  // -1 marks an existing entry; anything else is an index into `candidates`.
  type Marked = Interval & { candidateIndex: number };
  const marked: Marked[] = [];

  existing.forEach((e) => {
    const interval = toInterval(e, now);
    if (interval) marked.push({ ...interval, candidateIndex: -1 });
  });
  candidates.forEach((e, index) => {
    const interval = toInterval(e, now);
    if (interval) marked.push({ ...interval, candidateIndex: index });
  });

  // With concurrent timers allowed, only entries on the same timecode conflict.
  const groups = new Map<string, Marked[]>();
  for (const item of marked) {
    const key = allowConcurrentTimers ? item.timecodeId : '';
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || a.end - b.end);

    // Pass 1: an existing entry always wins, wherever it sits in the ordering.
    // This has to settle before candidates are weighed against each other, or a
    // candidate that is itself doomed could block a valid one first.
    let active: Marked[] = [];
    for (const item of group) {
      active = active.filter((open) => open.end > item.start);

      if (item.candidateIndex >= 0) {
        if (active.some((open) => open.candidateIndex < 0)) rejected.add(item.candidateIndex);
      } else {
        for (const open of active) {
          if (open.candidateIndex >= 0) rejected.add(open.candidateIndex);
        }
      }
      active.push(item);
    }

    // Pass 2: resolve collisions between the candidates that survived, keeping
    // the earlier-starting row exactly as adding them one at a time would.
    active = [];
    for (const item of group) {
      if (item.candidateIndex < 0 || rejected.has(item.candidateIndex)) continue;
      active = active.filter((open) => open.end > item.start);
      if (active.length > 0) {
        rejected.add(item.candidateIndex);
        continue;
      }
      active.push(item);
    }
  }

  return rejected;
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
  const durationMs = end.getTime() - start.getTime() - sumPausedMs(start, end, pausedSegments);
  return Math.max(0, Math.floor(durationMs / 1000));
};

export const getElapsedTimeMs = (startTime: string, pausedSegments: PauseSegment[], endTimeOverride?: string): number => {
  const now = endTimeOverride ? new Date(endTimeOverride).getTime() : Date.now();
  const start = new Date(startTime).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(start)) return 0;

  // Shares the clamped/merged pause maths with calculateDuration so the live
  // ticking display and the duration written on stop cannot disagree.
  const totalPauseMs = sumPausedMs(new Date(start), new Date(now), pausedSegments);
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

export const calculateTaxBreakdown = (amount: number, taxRate: number, inclusive: boolean) => {
  const rate = Number.isFinite(taxRate) ? taxRate : 0;

  if (inclusive) {
    const divisor = 1 + rate / 100;
    // A rate of -100% or lower has no meaningful inclusive split and would
    // otherwise divide by zero and print Infinity onto an invoice.
    if (divisor <= 0) {
      const total = roundCurrency(amount);
      return { subtotal: total, tax: 0, total };
    }
    const total = roundCurrency(amount);
    const subtotal = roundCurrency(amount / divisor);
    return { subtotal, tax: roundCurrency(total - subtotal), total };
  }

  const subtotal = roundCurrency(amount);
  const tax = roundCurrency(subtotal * (rate / 100));
  return { subtotal, tax, total: roundCurrency(subtotal + tax) };
};
