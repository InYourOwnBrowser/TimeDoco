import type { Entry, Settings, Timecode } from '../types';
import { applyRounding, calendarDayBounds, calendarDayKey, calculateDuration, formatDurationShort, roundCurrency, roundHours } from './timeUtils';

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
  /**
   * Billable seconds after the rounding rule has been applied at its scope.
   *
   * Always 0 for a fixed cost: it is billed as a fee instead of by the hour, so
   * it contributes no hours to any row or total. Its time on the clock is still
   * in `workedSeconds` — use `displaySecondsFor` to show one entry's duration.
   */
  seconds: number;
  /** Hours as printed on reports — always two decimals. Always 0 for a fee. */
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
  /** null for a fixed cost, which has no billable time to round. */
  bucketKey: string | null;
}

/**
 * Whether an entry bills as a fee rather than by the hour.
 *
 * A zero amount is *not* a fee, which is what both entry modals already record
 * — they coerce a typed 0 to null before saving. Billing disagreed: it read any
 * non-null `manualAmount` as a fixed cost, and a fixed cost bills zero hours and
 * zero money. An entry with an hour on the clock and `manualAmount: 0` therefore
 * billed nothing and vanished from every total.
 *
 * Not reachable from the UI, but both importers accepted 0 as a valid number, so
 * such records exist in stored data and are not repaired by fixing the importers
 * alone. A negative amount is a credit and is a genuine fee.
 */
const billsAsFee = (manualAmount: number | null | undefined): boolean =>
  manualAmount != null && manualAmount !== 0;

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
 * 'timecode' and 'invoice' are properties of a report, not of a screen: they
 * mean "this timecode's total on this report" and "this report's total". Only a
 * surface that *is* a report — one covering a period the user chose, which is
 * the analysis view — names a `scopeWindow`; every other surface passes null and
 * lands on 'day' here.
 *
 * Letting each surface name its own window instead put the bucket in the hands
 * of whatever happened to be on screen, and the surfaces necessarily disagreed:
 * the same two entries billed as 20 minutes on the month calendar, 22.5 on the
 * week grid beside it and 15 in the entry list. 'day' is a bucket every surface
 * can build identically, whatever slice of time it is showing and however it is
 * filtered.
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
      return `d:${entry.timecodeId}:${calendarDayKey(entryStart)}`;
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
 *
 * A negative target is a credit and allocates with its sign preserved, so the
 * parts still sum to it exactly. Only a zero target, or parts that sum to
 * nothing, allocate all zeros — there is nothing to share out in either case.
 *
 * `keys` breaks a tie between equal remainders. Without it the leftover unit
 * goes to whichever tied part sits earlier in the array — `Array.sort` is
 * stable, so a tie is decided by input order — and two entries of identical
 * length are not an exotic input: reordering or pre-filtering the entry list
 * then moved a cent between two lines of an invoice. Sorting the tie on
 * something intrinsic to the part instead makes the allocation a function of
 * the set, not of the order it arrived in. Parts whose size *and* key both tie
 * are genuinely interchangeable, so index is the honest last resort.
 *
 * Callers whose order is itself intrinsic — the timeline's chronological day
 * buckets — pass no keys and get the index tie-break, which is deterministic
 * for them because position carries meaning.
 */
export const allocateProportionally = (
  rawSeconds: number[],
  target: number,
  keys?: readonly string[],
): number[] => {
  const total = rawSeconds.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || target === 0) return rawSeconds.map(() => 0);

  // A credit is allocated by magnitude and re-signed on the way out. Feeding a
  // negative target through directly would floor toward -Infinity and then hand
  // the largest-remainder units out in the wrong direction, so the parts would
  // no longer sum back to `target`.
  const sign = target < 0 ? -1 : 1;
  const magnitude = Math.abs(target);

  const exact = rawSeconds.map((value) => (value * magnitude) / total);
  const allocated = exact.map((value) => Math.floor(value));
  let remaining = magnitude - allocated.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      if (keys) {
        const keyA = keys[a.index];
        const keyB = keys[b.index];
        if (keyA !== keyB) return keyA < keyB ? -1 : 1;
      }
      return a.index - b.index;
    });

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

  // Re-sign, mapping 0 to 0 rather than -0: the two are numerically equal but
  // print differently and compare unequal under Object.is, which would show up
  // in snapshots and in toEqual assertions.
  return sign === 1 ? allocated : allocated.map((value) => (value === 0 ? 0 : -value));
};

export interface BuildOptions {
  dateRange: DateRange | null;
  roundingRule?: RoundingRule;
  roundingScope?: RoundingScope;
  scopeWindow?: DateRange | null;
  /**
   * The rates amounts are computed from. Omit it only on a surface that shows
   * no hourly money: without it every rate reads as null and every hourly
   * amount comes out 0, silently. Fixed costs are unaffected — a fee carries
   * its own amount and needs no rate — which is why `EntryList`, which sums
   * only fees, can leave this out.
   */
  timecodeMap?: Map<string, Timecode>;
  now?: Date;
}

/**
 * The single source of truth for what each entry contributes to a report.
 *
 * The summary table, the detail table, the CSV export and the on-screen totals
 * all consume this, so an invoice cannot show one number in one table and a
 * different number in another. Four rules make a generated document
 * self-consistent:
 *
 *  1. Duration is always recomputed from the entry's start/end clipped to the
 *     reporting window, never read from the stored `duration` field (which is
 *     unclipped, and is 0 while a timer is still running).
 *  2. `amount` is allocated from the timecode's total billable time, so the
 *     sum of the line amounts exactly matches the timecode's total amount.
 *  3. A fixed cost belongs to the period containing the entry's start, so an
 *     entry straddling two invoices is not billed in full on both.
 *  4. A fixed cost bills as a fee and so contributes no hours. Rate x the row's
 *     printed hours, plus its fees, is exactly the row's printed total.
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
    // A record whose timestamps do not parse has no duration anyone can trust
    // and no day to file it under, so it is quarantined here: it bills nothing,
    // and — the part that matters — it joins no rounding bucket.
    //
    // Both halves of that were live faults. `calculateDuration` returns NaN for
    // an unreadable end time (`Math.max(0, Math.floor(NaN / 1000))` is NaN, so
    // the clamp that reads like a guard is not one); `applyRounding` then turned
    // the whole bucket total into 0 and `allocateProportionally` handed every
    // *other* line in the bucket zero, so one corrupt row silently zeroed a
    // day's billing for the entries beside it and dropped them off the invoice.
    // And an unreadable start time reached `calendarDayKey` below, which throws
    // by design — inside the `useMemo` that `EntryList` and `WeeklySummary`
    // render from, on the one tab with no `ErrorBoundary` of its own, so it
    // replaced the entire app.
    //
    // The three document builders were each hardened against exactly these
    // records. This is the trunk they all read from, so the guard belongs here
    // rather than at each surface that consumes the result.
    const isReadable = Number.isFinite(workedSeconds) && !Number.isNaN(entryStart.getTime());
    return {
      entryId: entry.id,
      timecodeId: entry.timecodeId,
      // Zeroed rather than passed through: `sumBillableLines` accumulates this
      // unguarded, so a NaN here poisons the worked total on every surface that
      // prints one beside the billed figure.
      workedSeconds: isReadable ? workedSeconds : 0,
      isRunning,
      isClipped,
      isFixedCost: billsAsFee(entry.manualAmount),
      manualAmount: entry.manualAmount ?? null,
      hourlyRate: timecode?.hourlyRate ?? null,
      // A fixed cost bills as a fee rather than by the hour, so it has no
      // billable time at all: `bucketKey` is null and its billable seconds stay
      // 0. It joins no rounding bucket either, where its minutes would shift
      // another entry's billable ones. It used to get a bucket of its own,
      // which both billed its hours beside the fee — printing a summary row
      // whose Rate x Hours did not equal its Total — and rounded it at entry
      // scope whatever scope the user had configured.
      bucketKey: billsAsFee(entry.manualAmount) || !isReadable
        ? null
        : bucketKeyFor(scope, entry, entryStart, windowKey),
    };
  });

  const buckets = new Map<string, RawLine[]>();
  for (const raw of raws) {
    if (raw.bucketKey === null) continue;
    const existing = buckets.get(raw.bucketKey);
    if (existing) existing.push(raw);
    else buckets.set(raw.bucketKey, [raw]);
  }

  const billableSeconds = new Map<string, number>();
  for (const bucket of buckets.values()) {
    const rawSeconds = bucket.map((line) => line.workedSeconds);
    const bucketTotal = rawSeconds.reduce((sum, value) => sum + value, 0);
    const target = applyRounding(bucketTotal, roundingRule);
    // Keyed by entry id: which line absorbs the leftover second must not depend
    // on where the entry happened to sit in the caller's list.
    const allocated = allocateProportionally(rawSeconds, target, bucket.map((line) => line.entryId));
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
    const cents = allocateProportionally(
      seconds,
      Math.round(rowAmount * 100),
      group.map((line) => line.entryId),
    );
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

/**
 * An entry left running for this long is not a shift, and walking a day at a
 * time across it is not worth doing. Well past any forgotten timer a person
 * would still want split hour by hour, and short enough that a corrupt end
 * date cannot spin the loop below.
 */
const MAX_SPLIT_DAYS = 400;

/**
 * One entry's billable seconds, broken down by the calendar day they fell on.
 *
 * A shift from 23:00 to 01:00 is two hours of work on two dates, and every
 * screen used to file all of it under the date it started while the report
 * clipped it at the period boundary — so the timesheet said 2.00 h for a week
 * and the invoice built from the same data said 1.00 h. The report was right:
 * time bills to the period it was actually worked in. This is what lets the
 * screens say the same thing, by splitting the entry at midnight instead of
 * choosing a day for the whole of it.
 *
 * The split is proportional to time actually on the clock in each day — pauses
 * come out of the day they happened in — and it is an allocation of
 * `line.seconds` rather than a re-measurement, so the parts add back up to the
 * figure the rest of the app bills, whatever rounding rule produced it. An
 * entry inside one day yields that one day and is unchanged.
 *
 * `lines` must be built over every entry sharing a rounding bucket with these,
 * not over the slice on screen: the bucket total is what is being shared out,
 * and computing it from a week's worth of entries when the day also holds
 * others would hand each surface a different figure again. Callers pass the
 * whole list to `buildScreenLines` and narrow only here.
 */
export const billableSecondsByDay = (
  entries: Entry[],
  lines: Map<string, BillableLine>,
  now: Date = new Date(),
): Map<string, Map<string, number>> => {
  const byEntry = new Map<string, Map<string, number>>();

  for (const entry of entries) {
    const line = lines.get(entry.id);
    if (!line || line.seconds <= 0) continue;

    const start = new Date(entry.startTime);
    const end = entry.endTime ? new Date(entry.endTime) : now;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

    // The days the entry touches, as half-open [midnight, next midnight)
    // intervals — `calendarDayBounds`, so a 23- or 25-hour DST day is exactly
    // as long as the calendar says it is.
    const days: Array<{ key: string; start: number; end: number }> = [];
    let cursor = calendarDayBounds(start).start;
    while (cursor.getTime() < end.getTime() && days.length < MAX_SPLIT_DAYS) {
      const bounds = calendarDayBounds(cursor);
      days.push({ key: calendarDayKey(cursor), start: bounds.start.getTime(), end: bounds.end.getTime() });
      cursor = bounds.end;
    }

    // A zero-length entry touches no day interval, and one running past the cap
    // is not a shift anyone is reconciling hour by hour. Both keep the old
    // behaviour — all of it on the day it started — which is a defensible
    // answer where splitting is not.
    if (days.length === 0 || days.length >= MAX_SPLIT_DAYS) {
      byEntry.set(entry.id, new Map([[calendarDayKey(start), line.seconds]]));
      continue;
    }

    const workedPerDay = days.map(({ start: from, end: to }) => {
      const effStart = Math.max(start.getTime(), from);
      const effEnd = Math.min(end.getTime(), to);
      if (effEnd <= effStart) return 0;
      return calculateDuration(new Date(effStart), new Date(effEnd), entry.pausedSegments || []);
    });

    // Keyed on the date so the leftover second lands on the same day whichever
    // order the caller happened to hold the days in.
    const allocated = allocateProportionally(workedPerDay, line.seconds, days.map((d) => d.key));

    const perDay = new Map<string, number>();
    days.forEach((day, index) => {
      if (allocated[index] !== 0) perDay.set(day.key, allocated[index]);
    });
    // Every day of the entry was pause, so nothing allocated anywhere. Its
    // billable seconds still exist and have to be somewhere findable.
    if (perDay.size === 0) perDay.set(calendarDayKey(start), line.seconds);
    byEntry.set(entry.id, perDay);
  }

  return byEntry;
};

/**
 * `billableSecondsByDay`, summed per timecode per day — the shape the timesheet
 * grid reads a cell out of. Key is `${timecodeId}|${dayKey}`.
 */
export const billableSecondsByTimecodeDay = (
  entries: Entry[],
  lines: Map<string, BillableLine>,
  now?: Date,
): Map<string, number> => {
  const perEntry = billableSecondsByDay(entries, lines, now);
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const days = perEntry.get(entry.id);
    if (!days) continue;
    for (const [day, seconds] of days) {
      const key = `${entry.timecodeId}|${day}`;
      totals.set(key, (totals.get(key) ?? 0) + seconds);
    }
  }
  return totals;
};

/** The rounding fields any surface needs to agree with every other surface. */
export type BillingSettings = Pick<Settings, 'roundingRule' | 'roundingScope'> | null | undefined;

/**
 * Takes the *entire* entry list and a required window.
 * It windows internally so callers cannot accidentally pass a pre-filtered list.
 */
export const buildReportLines = (
  allEntries: Entry[],
  settings: BillingSettings,
  window: DateRange,
  opts: { timecodeMap?: Map<string, Timecode>; now?: Date } = {}
): Map<string, BillableLine> => {
  // One `now` for the whole pass. Evaluated inside the predicate it allocated a
  // Date per running entry and, worse, let the window boundary move down the
  // list, so which entries the report covered depended on where they sat in it.
  const now = opts.now ?? new Date();
  const periodEntries = allEntries.filter(entry => {
    const start = new Date(entry.startTime);
    const end = entry.endTime ? new Date(entry.endTime) : now;
    return start <= window.end && end >= window.start;
  });

  return buildBillableLines(periodEntries, {
    dateRange: window,
    roundingRule: settings?.roundingRule || 'none',
    roundingScope: settings?.roundingScope || DEFAULT_ROUNDING_SCOPE,
    scopeWindow: window,
    timecodeMap: opts.timecodeMap,
    now,
  });
};

/**
 * Takes entries and settings. It hardcodes dateRange: null and scopeWindow: null,
 * degrading to 'day' scope for UI surfaces without a specific reporting period.
 */
export const buildScreenLines = (
  entries: Entry[],
  settings: BillingSettings,
  opts: { timecodeMap?: Map<string, Timecode>; now?: Date } = {}
): Map<string, BillableLine> =>
  buildBillableLines(entries, {
    dateRange: null,
    roundingRule: settings?.roundingRule || 'none',
    roundingScope: settings?.roundingScope || DEFAULT_ROUNDING_SCOPE,
    scopeWindow: null,
    timecodeMap: opts.timecodeMap,
    now: opts.now,
  });

/** Billable seconds for one entry, or 0 for an entry outside the built set. */
export const secondsFor = (lines: Map<string, BillableLine>, entryId: string): number =>
  lines.get(entryId)?.seconds ?? 0;

/**
 * What one entry's own duration reads as on screen.
 *
 * A fixed cost has no billable time — it bills as a fee — but it can still have
 * real times on the clock, and a row that reported those as `0s` would read as
 * lost data. Totals use `secondsFor`, so a fee still adds no hours to any of
 * them; only the entry's own duration falls back to the time it was worked.
 */
export const displaySecondsFor = (lines: Map<string, BillableLine>, entryId: string): number => {
  const line = lines.get(entryId);
  if (!line) return 0;
  return line.isFixedCost ? line.workedSeconds : line.seconds;
};

/** Time on the clock for one entry, whether or not any of it is billable. */
export const workedSecondsFor = (lines: Map<string, BillableLine>, entryId: string): number =>
  lines.get(entryId)?.workedSeconds ?? 0;

/**
 * The one sentence every surface uses to explain a gap between the clock and
 * the hours it bills, so the explanation cannot say one thing on the report and
 * another beside the same numbers on the timesheet.
 *
 * Two causes, and they read differently because they are not the same claim: a
 * rounding rule moved the billable minutes, or a fixed amount bills as a fee
 * and so contributes no hours at all. Naming the whole difference "rounding"
 * when a fee is in play would misattribute the part of it that is fee time.
 *
 * Returns null when the two totals agree and there is nothing to disclose.
 *
 * `hasFixedCost` is the presence of a fee, not its value. Deriving it from the
 * money — the earlier `fees !== 0` — misread the case this note exists to get
 * right: a fixed cost that starts before the window bills 0 into it (rule 3),
 * so `fees` is 0 while the fee's worked time is still in the totals, and two
 * hours of already-invoiced fee work were disclosed as "rounding -2h" on a
 * report with rounding switched off.
 */
export const workedVsBilledNote = (
  workedSeconds: number,
  billedSeconds: number,
  hasFixedCost: boolean,
): string | null => {
  if (workedSeconds === billedSeconds) return null;
  const worked = `worked ${formatDurationShort(workedSeconds)}`;
  if (hasFixedCost) return `${worked} · billed ${formatDurationShort(billedSeconds)} plus fees`;
  const diff = billedSeconds - workedSeconds;
  const sign = diff > 0 ? '+' : '-';
  return `${worked} · rounding ${sign}${formatDurationShort(Math.abs(diff))}`;
};

/**
 * The disclosure for entries a report bills no time for at all.
 *
 * Separate from `workedVsBilledNote` because it answers a different question —
 * that one says how much time moved, this one says a line is missing — and
 * because the two do not appear together. A report where one entry rounds down
 * by as much as another rounds up has no net delta at all, and an entry has
 * still vanished from it.
 */
export const zeroBilledNote = (count: number, roundingRule: RoundingRule): string | null => {
  if (count <= 0) return null;
  const entries = `${count} entr${count === 1 ? 'y' : 'ies'}`;
  // Without a rounding rule an empty line is a zero-length entry rather than a
  // rounded-away one, and calling it "rounded" would misdescribe it.
  return roundingRule === 'none' ? `${entries} with no billable time` : `${entries} rounded to 0.00 h`;
};

/**
 * Everything a surface has to disclose about the gap between the clock and the
 * hours billed: how much time moved, which entries dropped out, or both.
 *
 * One function so the screen, the PDF and the CSV cannot each decide for
 * themselves — and so the zero-line count cannot ride on a note that is null
 * exactly when the count matters most.
 */
export const roundingNote = (
  workedSeconds: number,
  billedSeconds: number,
  hasFixedCost: boolean,
  zeroLinesCount: number,
  roundingRule: RoundingRule,
): string | null => {
  const delta = workedVsBilledNote(workedSeconds, billedSeconds, hasFixedCost);
  const zero = zeroBilledNote(zeroLinesCount, roundingRule);
  if (delta && zero) return `${delta} (${zero})`;
  return delta ?? zero;
};

/**
 * Hours printed without being rounded, for the columns that promise raw values.
 *
 * Every other hours figure in the app goes through `roundHours` because it is a
 * billing figure that has to reconcile with the line beside it. This one is the
 * opposite: it is the measurement the billing figures are checked against, so
 * it keeps enough precision to recover the exact second (six decimals resolve
 * to under two milliseconds) and drops trailing zeros so a whole hour still
 * reads as `1`.
 */
export const formatWorkedHours = (workedSeconds: number): string => {
  if (!Number.isFinite(workedSeconds) || workedSeconds <= 0) return '0';
  const text = (workedSeconds / 3600).toFixed(6);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
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

export interface BillableTotals {
  /** Billable seconds. Fixed costs contribute none — they bill as a fee. */
  seconds: number;
  /** Time on the clock, fixed costs included, for the worked-vs-billed note. */
  workedSeconds: number;
  /** `seconds` as printed. Multiply by the rate and add `fees` for `amount`. */
  hours: number;
  /** Everything billed: rate x hours, plus the fees. */
  amount: number;
  /** The part of `amount` that came from fixed costs rather than from a rate. */
  fees: number;
  /**
   * Whether any line here bills as a fee, whatever that fee came to.
   *
   * Distinct from `fees !== 0` on purpose: a fixed cost starting before the
   * reporting window is attributed to the earlier period and contributes 0,
   * while its worked time is still in `workedSeconds`. Reading the money to
   * decide whether a fee is in play calls that time a rounding adjustment.
   */
  hasFixedCost: boolean;
}

/**
 * Sum lines into a report row/total. Hours and amounts are summed from values
 * that are already rounded, so the printed lines add up to the printed total.
 *
 * `fees` is kept apart from `hours` because a reader checks an invoice by
 * multiplying the two columns beside each other. A fixed cost contributes no
 * hours, so `rate x hours + fees === amount` holds for any row — which is what
 * lets the summary table print a Fees column that reconciles.
 */
export const sumBillableLines = (lines: BillableLine[]): BillableTotals => {
  let seconds = 0;
  let workedSeconds = 0;
  let amount = 0;
  let fees = 0;
  let hasFixedCost = false;
  for (const line of lines) {
    seconds += line.seconds;
    workedSeconds += line.workedSeconds;
    amount += line.amount;
    if (line.isFixedCost) {
      fees += line.amount;
      hasFixedCost = true;
    }
  }
  // Hours come from the summed seconds rather than the summed per-line hours,
  // which would drift upward across many short entries.
  return {
    seconds,
    workedSeconds,
    hours: roundHours(seconds / 3600),
    amount: roundCurrency(amount),
    fees: roundCurrency(fees),
    hasFixedCost,
  };
};

/** One printed row of a report's summary table: a timecode, or a group. */
export interface ReportRow {
  /** Timecode id, or group id — `'ungrouped'` for timecodes with no group. */
  id: string;
  /** Billable seconds behind the row, before they are printed as hours. */
  seconds: number;
  /** Hours as printed on the row. `rate x hours + fees` is exactly `amount`. */
  hours: number;
  /** Everything billed on the row: rate x hours, plus the fees. */
  amount: number;
  /** The part of `amount` that came from fixed costs rather than from a rate. */
  fees: number;
}

export interface ReportSummary {
  /** One row per timecode with something to bill. */
  timecodeRows: ReportRow[];
  /** The same time rolled up by group, so the two tables cannot disagree. */
  groupRows: ReportRow[];
  /**
   * Seconds, worked seconds, amount and fees for the whole report.
   *
   * Its `hours` is the total's own rounding of `seconds` and is *not* what a
   * report prints — use `totalHours`, which is the sum of the printed rows.
   */
  totals: BillableTotals;
  /** Hours on the total line: the sum of the printed rows, by construction. */
  totalHours: number;
  /** Entries inside the window whose billable time rounded away to nothing. */
  zeroLinesCount: number;
}

/** Add two-decimal values without the drift of summing them as floats. */
const sumHundredths = (values: number[]): number =>
  values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;

/**
 * Roll a report's lines up into the rows and totals a document prints.
 *
 * A row is the unit a reader checks, so each one keeps its own arithmetic:
 * `rate x hours + fees` is exactly the row's `amount`. That holds because the
 * only filters a report applies — group and timecode — select whole timecodes,
 * so a row that appears at all carries every one of its lines in the window,
 * which is the set `buildBillableLines` allocated its amount from.
 *
 * The printed total is then the sum of the printed rows, not a figure derived
 * independently from the total seconds. Deriving it separately printed rows
 * that did not add up to their own total; allocating that total back down into
 * the rows fixed the column at the row's expense, giving a row an hours figure
 * that no longer matched its own money. Only summing upward satisfies both. The
 * total may then sit 0.01 h from `roundHours(totalSeconds / 3600)` — correctly,
 * because what a report totals is what it printed.
 */
export const summarizeReport = (
  entries: Entry[],
  lines: Map<string, BillableLine>,
  timecodeMap: Map<string, Timecode>,
): ReportSummary => {
  const byTimecode = new Map<string, BillableLine[]>();
  const includedLines: BillableLine[] = [];
  let zeroLinesCount = 0;

  for (const entry of entries) {
    const line = lines.get(entry.id);
    if (!line) continue;
    // In the totals — the time was worked — but given no row of its own.
    includedLines.push(line);
    if (line.seconds <= 0 && line.amount === 0) {
      zeroLinesCount++;
      continue;
    }
    const existing = byTimecode.get(entry.timecodeId);
    if (existing) existing.push(line);
    else byTimecode.set(entry.timecodeId, [line]);
  }

  const timecodeRows: ReportRow[] = [];
  const groupRowsById = new Map<string, ReportRow>();

  for (const [timecodeId, group] of byTimecode) {
    const rowTotals = sumBillableLines(group);
    const row: ReportRow = {
      id: timecodeId,
      seconds: rowTotals.seconds,
      hours: rowTotals.hours,
      amount: rowTotals.amount,
      fees: rowTotals.fees,
    };
    timecodeRows.push(row);

    // Groups roll up from the printed timecode rows rather than from the raw
    // seconds, so the two tables report the same time for the same work.
    const groupId = timecodeMap.get(timecodeId)?.groupId || 'ungrouped';
    const existing = groupRowsById.get(groupId);
    if (existing) {
      existing.seconds += row.seconds;
      existing.hours = sumHundredths([existing.hours, row.hours]);
      existing.amount = roundCurrency(existing.amount + row.amount);
      existing.fees = roundCurrency(existing.fees + row.fees);
    } else {
      groupRowsById.set(groupId, { ...row, id: groupId });
    }
  }

  return {
    timecodeRows,
    groupRows: Array.from(groupRowsById.values()),
    totals: sumBillableLines(includedLines),
    totalHours: sumHundredths(timecodeRows.map((row) => row.hours)),
    zeroLinesCount,
  };
};
