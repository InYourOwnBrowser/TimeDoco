import { format } from 'date-fns';
import type { Entry, Timecode } from '../types';
import { applyRounding, calculateDuration, roundCurrency, roundHours } from './timeUtils';

export type RoundingRule = 'none' | '5min' | '10min' | '15min';

/**
 * How widely a rounding rule is applied before it takes effect.
 *
 * Rounding each entry on its own compounds: ten separate 7-minute entries at
 * 15-minute rounding each round to zero and bill nothing for 70 minutes of
 * real work, while eight 8-minute entries each round up and bill two hours for
 * 64 minutes. Rounding a wider bucket — a timecode's day, a timecode's whole
 * report, or the report total — keeps the distortion bounded to a single
 * rounding interval instead of scaling with the number of entries.
 */
export type RoundingScope = 'entry' | 'day' | 'timecode' | 'invoice';

export const ROUNDING_SCOPES: RoundingScope[] = ['entry', 'day', 'timecode', 'invoice'];

export const DEFAULT_ROUNDING_SCOPE: RoundingScope = 'day';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface BillableLine {
  /** Actual time worked in the window, before any rounding. */
  workedSeconds: number;
  /** Billable seconds after the rounding rule has been applied at its scope. */
  seconds: number;
  /** Hours as printed on reports — always two decimals. */
  hours: number;
  /** Line amount, allocated from the timecode's total billable time to avoid compounding rounding errors. */
  amount: number;
  /** True when the entry has no end time and was measured up to `now`. */
  isRunning: boolean;
  /** True when the entry extends beyond the reporting window and was clipped. */
  isClipped: boolean;
  /** True when the amount came from a fixed cost rather than rate x hours. */
  isFixedCost: boolean;
}

interface RawLine {
  entryId: string;
  timecodeId: string;
  workedSeconds: number;
  isRunning: boolean;
  isClipped: boolean;
  isFixedCost: boolean;
  manualAmount: number | null;
  hourlyRate: number | null;
  bucketKey: string;
}

/** Time actually worked inside the reporting window, before rounding. */
const computeRaw = (entry: Entry, dateRange: DateRange | null, now: Date) => {
  const entryStart = new Date(entry.startTime);
  const isRunning = !entry.endTime;
  const entryEnd = entry.endTime ? new Date(entry.endTime) : now;

  let effectiveStart = entryStart;
  let effectiveEnd = entryEnd;
  let isClipped = false;

  if (dateRange) {
    if (entryStart < dateRange.start) {
      effectiveStart = dateRange.start;
      isClipped = true;
    }
    if (entryEnd > dateRange.end) {
      effectiveEnd = dateRange.end;
      isClipped = true;
    }
  }

  return {
    entryStart,
    workedSeconds: calculateDuration(effectiveStart, effectiveEnd, entry.pausedSegments || []),
    isRunning,
    isClipped,
  };
};

const bucketKeyFor = (scope: RoundingScope, entry: Entry, entryStart: Date): string => {
  switch (scope) {
    case 'entry':
      return `e:${entry.id}`;
    case 'day':
      // Per timecode per day, so a bucket never spans two summary rows.
      return `d:${entry.timecodeId}:${format(entryStart, 'yyyy-MM-dd')}`;
    case 'timecode':
      return `t:${entry.timecodeId}`;
    case 'invoice':
      return 'i:all';
  }
};

/**
 * Share a bucket's rounded total back across its lines using largest remainder,
 * so the per-entry figures still add up to the rounded bucket total exactly and
 * a report reconciles at every level regardless of the scope in use.
 */
const allocate = (rawSeconds: number[], target: number): number[] => {
  const total = rawSeconds.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || target <= 0) return rawSeconds.map(() => 0);

  const exact = rawSeconds.map((value) => (value * target) / total);
  const allocated = exact.map((value) => Math.floor(value));
  let remaining = target - allocated.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; remaining > 0 && i < order.length; i++, remaining--) {
    allocated[order[i].index]++;
  }
  // A pathological rounding-down can leave a surplus; take it off the largest lines.
  for (let i = order.length - 1; remaining < 0 && i >= 0; i--) {
    if (allocated[order[i].index] > 0) {
      allocated[order[i].index]--;
      remaining++;
    }
  }

  return allocated;
};

export interface BuildOptions {
  dateRange: DateRange | null;
  roundingRule?: RoundingRule;
  roundingScope?: RoundingScope;
  timecodeMap?: Map<string, Timecode>;
  now?: Date;
}

/**
 * The single source of truth for what each entry contributes to a report.
 *
 * The summary table, the detail table, the CSV export and the on-screen totals
 * all consume this, so an invoice cannot show one number in one table and a
 * different number in another. Three rules make a generated document
 * self-consistent:
 *
 *  1. Duration is always recomputed from the entry's start/end clipped to the
 *     reporting window, never read from the stored `duration` field (which is
 *     unclipped, and is 0 while a timer is still running).
 *  2. `amount` is allocated from the timecode's total billable time, so the
 *     sum of the line amounts exactly matches the timecode's total amount.
 *  3. A fixed cost belongs to the period containing the entry's start, so an
 *     entry straddling two invoices is not billed in full on both.
 */
export const buildBillableLines = (entries: Entry[], options: BuildOptions): Map<string, BillableLine> => {
  const { dateRange, roundingRule = 'none', roundingScope = DEFAULT_ROUNDING_SCOPE, timecodeMap, now = new Date() } = options;

  const raws: RawLine[] = entries.map((entry) => {
    const { entryStart, workedSeconds, isRunning, isClipped } = computeRaw(entry, dateRange, now);
    const timecode = timecodeMap?.get(entry.timecodeId);
    return {
      entryId: entry.id,
      timecodeId: entry.timecodeId,
      workedSeconds,
      isRunning,
      isClipped,
      isFixedCost: entry.manualAmount != null,
      manualAmount: entry.manualAmount ?? null,
      hourlyRate: timecode?.hourlyRate ?? null,
      // A fixed cost is billed as a fee, so its time never joins a rounding
      // bucket where it could shift another entry's billable minutes.
      bucketKey: entry.manualAmount != null
        ? `f:${entry.id}`
        : bucketKeyFor(roundingScope, entry, entryStart),
    };
  });

  const buckets = new Map<string, RawLine[]>();
  for (const raw of raws) {
    const existing = buckets.get(raw.bucketKey);
    if (existing) existing.push(raw);
    else buckets.set(raw.bucketKey, [raw]);
  }

  const billableSeconds = new Map<string, number>();
  for (const bucket of buckets.values()) {
    const rawSeconds = bucket.map((line) => line.workedSeconds);
    const bucketTotal = rawSeconds.reduce((sum, value) => sum + value, 0);
    const target = applyRounding(bucketTotal, roundingRule);
    const allocated = allocate(rawSeconds, target);
    bucket.forEach((line, index) => billableSeconds.set(line.entryId, allocated[index]));
  }

  // Amounts are computed per timecode from that timecode's total billable time,
  // then allocated back across its lines in whole cents. Deriving each line's
  // amount from its own two-decimal hours instead would compound: ten lines of
  // 0.125h each print as 0.13h and bill 78.00 where the true total is 75.00.
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const lineAmounts = new Map<string, number>();
  const byTimecode = new Map<string, RawLine[]>();

  for (const raw of raws) {
    if (raw.isFixedCost) {
      // Attributed once, to the period containing the entry's start.
      const entryStart = new Date(entryById.get(raw.entryId)!.startTime);
      const startsInRange = !dateRange || (entryStart >= dateRange.start && entryStart <= dateRange.end);
      lineAmounts.set(raw.entryId, startsInRange ? roundCurrency(raw.manualAmount as number) : 0);
      continue;
    }
    const existing = byTimecode.get(raw.timecodeId);
    if (existing) existing.push(raw);
    else byTimecode.set(raw.timecodeId, [raw]);
  }

  for (const group of byTimecode.values()) {
    const rate = group[0].hourlyRate;
    if (!rate) {
      group.forEach((line) => lineAmounts.set(line.entryId, 0));
      continue;
    }
    const seconds = group.map((line) => billableSeconds.get(line.entryId) ?? 0);
    const totalSeconds = seconds.reduce((sum, value) => sum + value, 0);
    // The figure a client checks: rate x the row's printed hours.
    const rowAmount = roundCurrency(roundHours(totalSeconds / 3600) * rate);
    const cents = allocate(seconds, Math.round(rowAmount * 100));
    group.forEach((line, index) => lineAmounts.set(line.entryId, cents[index] / 100));
  }

  const result = new Map<string, BillableLine>();
  for (const raw of raws) {
    const seconds = billableSeconds.get(raw.entryId) ?? 0;
    const hours = roundHours(seconds / 3600);
    const amount = lineAmounts.get(raw.entryId) ?? 0;

    result.set(raw.entryId, {
      workedSeconds: raw.workedSeconds,
      seconds,
      hours,
      amount,
      isRunning: raw.isRunning,
      isClipped: raw.isClipped,
      isFixedCost: raw.isFixedCost,
    });
  }

  return result;
};

/** Single-entry convenience wrapper; rounding necessarily applies at entry scope. */
export const computeBillableLine = (
  entry: Entry,
  dateRange: DateRange | null,
  roundingRule: RoundingRule = 'none',
  timecode?: Timecode,
  now: Date = new Date(),
): BillableLine => {
  const timecodeMap = new Map<string, Timecode>();
  if (timecode) timecodeMap.set(entry.timecodeId, timecode);
  return buildBillableLines([entry], {
    dateRange,
    roundingRule,
    roundingScope: 'entry',
    timecodeMap,
    now,
  }).get(entry.id)!;
};

/**
 * Sum lines into a report row/total. Hours and amounts are summed from values
 * that are already rounded, so the printed lines add up to the printed total.
 */
export const sumBillableLines = (lines: BillableLine[]): { seconds: number; workedSeconds: number; hours: number; amount: number } => {
  let seconds = 0;
  let workedSeconds = 0;
  let amount = 0;
  for (const line of lines) {
    seconds += line.seconds;
    workedSeconds += line.workedSeconds;
    amount += line.amount;
  }
  // Hours come from the summed seconds rather than the summed per-line hours,
  // which would drift upward across many short entries.
  return { seconds, workedSeconds, hours: roundHours(seconds / 3600), amount: roundCurrency(amount) };
};
