import { format } from 'date-fns';
import type { Entry, Settings, Timecode } from '../types';
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

/**
 * A stable key for the window a report covers, so two buckets from different
 * windows can never be confused for one another.
 */
const windowKeyFor = (scopeWindow: DateRange | null | undefined): string | null =>
  scopeWindow ? `${scopeWindow.start.getTime()}-${scopeWindow.end.getTime()}` : null;

/**
 * The scope actually applied, which is not always the one configured.
 *
 * 'timecode' and 'invoice' are defined relative to a reporting period — they
 * mean "this timecode's total on this report" and "this report's total". A
 * surface with no reporting window (the entry list, which shows all time) has
 * no such bucket to offer: taken literally, the bucket becomes the user's
 * entire history, so one entry's billable minutes shift every time an unrelated
 * entry is recorded months later, and the figure never matches the report's.
 * Falling back to 'day' gives that surface a bucket that is well defined,
 * stable, and identical however the list is filtered.
 */
export const effectiveRoundingScope = (
  scope: RoundingScope,
  scopeWindow: DateRange | null | undefined,
): RoundingScope =>
  (scope === 'timecode' || scope === 'invoice') && !scopeWindow ? 'day' : scope;

const bucketKeyFor = (
  scope: RoundingScope,
  entry: Entry,
  entryStart: Date,
  windowKey: string | null,
): string => {
  switch (scope) {
    case 'entry':
      return `e:${entry.id}`;
    case 'day':
      // Per timecode per day, so a bucket never spans two summary rows.
      return `d:${entry.timecodeId}:${format(entryStart, 'yyyy-MM-dd')}`;
    case 'timecode':
      return `t:${entry.timecodeId}:${windowKey}`;
    case 'invoice':
      return `i:${windowKey}`;
  }
};

/**
 * Share a total back across parts in proportion to their raw sizes, using
 * largest remainder so the parts add up to the target exactly.
 *
 * Buckets use it to share a rounded total across their lines; the timeline uses
 * it to share one line's billable seconds across the days it spans. Either way
 * the parts reconcile with the whole, whatever rounding scope is in use.
 */
export const allocateProportionally = (rawSeconds: number[], target: number): number[] => {
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
  /**
   * The reporting window the wider rounding scopes are measured over.
   *
   * At 'timecode' and 'invoice' scope a bucket's total *is* the set of entries
   * handed in, so without this the window was whatever slice the caller
   * happened to be rendering — and the entry list, the timesheet, the weekly
   * summary and the report each rendered a different one, giving four different
   * billable figures for the same entry. Naming the window makes the bucket a
   * property of the report rather than of the caller's slice.
   *
   * The caller must pass every entry in this window, not only the ones it
   * displays, or the bucket total is short. Pass null (or omit) on a surface
   * with no reporting window; see `effectiveRoundingScope`.
   */
  scopeWindow?: DateRange | null;
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
  const {
    dateRange,
    roundingRule = 'none',
    roundingScope = DEFAULT_ROUNDING_SCOPE,
    timecodeMap,
    now = new Date(),
  } = options;

  // A surface that clips to a reporting window is reporting on that window, so
  // it is the scope window too unless one is named explicitly.
  const scopeWindow = options.scopeWindow !== undefined ? options.scopeWindow : dateRange;
  const scope = effectiveRoundingScope(roundingScope, scopeWindow);
  const windowKey = windowKeyFor(scopeWindow);

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
        : bucketKeyFor(scope, entry, entryStart, windowKey),
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
    const allocated = allocateProportionally(rawSeconds, target);
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
    const cents = allocateProportionally(seconds, Math.round(rowAmount * 100));
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

/**
 * Share each entry's billable seconds across a series of time buckets — the
 * days of a timeline — in proportion to how much of its worked time fell in
 * each.
 *
 * Re-rounding every day-slice on its own was the alternative, and it ignored
 * the rounding scope: a chart drawn that way did not add up to the total on the
 * report beside it. Allocating one already-scoped figure keeps the bars and the
 * total reconciled, and keeps an entry that spans midnight from being counted
 * as a whole rounding interval on each side of it.
 *
 * `buckets` are millisecond [start, end] pairs; the returned array matches them
 * index for index.
 */
export const distributeAcrossBuckets = (
  entries: Entry[],
  lines: Map<string, BillableLine>,
  buckets: Array<{ start: number; end: number }>,
  now: Date = new Date(),
): number[] => {
  const totals = new Array<number>(buckets.length).fill(0);

  for (const entry of entries) {
    const line = lines.get(entry.id);
    if (!line || line.seconds <= 0) continue;

    const entryStart = new Date(entry.startTime).getTime();
    const entryEnd = entry.endTime ? new Date(entry.endTime).getTime() : now.getTime();

    const workedPerBucket = buckets.map(({ start, end }) => {
      const effStart = Math.max(entryStart, start);
      const effEnd = Math.min(entryEnd, end);
      if (effEnd <= effStart) return 0;
      return calculateDuration(new Date(effStart), new Date(effEnd), entry.pausedSegments || []);
    });

    const allocated = allocateProportionally(workedPerBucket, line.seconds);
    for (let i = 0; i < totals.length; i++) totals[i] += allocated[i];
  }

  return totals;
};

/** The rounding fields any surface needs to agree with every other surface. */
export type BillingSettings = Pick<Settings, 'roundingRule' | 'roundingScope'> | null | undefined;

/**
 * Build billable lines straight from the user's settings.
 *
 * Every surface that answers "how much time" — the entry list, the timesheet
 * grid and calendar, the weekly target, the report — goes through this, so the
 * rounding rule and its scope are read once, in one place, and the surfaces
 * cannot drift into four different answers for the same week.
 *
 * `dateRange` is the window the answer is about: a report clips to it, while a
 * view that files each entry under the day it started (the grid, the calendar,
 * the list) passes `null` and lets each entry count in full.
 */
export const buildLinesFromSettings = (
  entries: Entry[],
  settings: BillingSettings,
  options: {
    dateRange?: DateRange | null;
    /** See `BuildOptions.scopeWindow`. Defaults to `dateRange`. */
    scopeWindow?: DateRange | null;
    timecodeMap?: Map<string, Timecode>;
    now?: Date;
  } = {},
): Map<string, BillableLine> =>
  buildBillableLines(entries, {
    dateRange: options.dateRange ?? null,
    roundingRule: settings?.roundingRule || 'none',
    roundingScope: settings?.roundingScope || DEFAULT_ROUNDING_SCOPE,
    scopeWindow: options.scopeWindow !== undefined ? options.scopeWindow : (options.dateRange ?? null),
    timecodeMap: options.timecodeMap,
    now: options.now,
  });

/** Billable seconds for one entry, or 0 for an entry outside the built set. */
export const secondsFor = (lines: Map<string, BillableLine>, entryId: string): number =>
  lines.get(entryId)?.seconds ?? 0;

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
