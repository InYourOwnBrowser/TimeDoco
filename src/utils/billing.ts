import type { Entry, Timecode } from '../types';
import { applyRounding, calculateDuration, roundCurrency, roundHours } from './timeUtils';

export type RoundingRule = 'none' | '5min' | '10min' | '15min';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface BillableLine {
  /** Billable seconds, clipped to the reporting window and rounding rule applied. */
  seconds: number;
  /** Hours as printed on reports — always two decimals. */
  hours: number;
  /** Line amount in whole cents, derived from the same `hours` value that is printed. */
  amount: number;
  /** True when the entry has no end time and was measured up to `now`. */
  isRunning: boolean;
  /** True when the entry extends beyond the reporting window and was clipped. */
  isClipped: boolean;
  /** True when the amount came from a fixed cost rather than rate x hours. */
  isFixedCost: boolean;
}

/**
 * The single source of truth for what one entry contributes to a report.
 *
 * The summary table, the detail table, the CSV export and the on-screen totals
 * all consume this, so an invoice cannot show one number in one table and a
 * different number in another. Three rules make a generated document
 * self-consistent:
 *
 *  1. Duration is always recomputed from the entry's start/end clipped to the
 *     reporting window, never read from the stored `duration` field (which is
 *     unclipped, and is 0 while a timer is still running).
 *  2. `amount` is derived from the same two-decimal `hours` value that gets
 *     printed, so a client checking `rate x hours = amount` finds it holds.
 *  3. A fixed cost belongs to the period containing the entry's start, so an
 *     entry straddling two invoices is not billed in full on both.
 */
export const computeBillableLine = (
  entry: Entry,
  dateRange: DateRange | null,
  roundingRule: RoundingRule = 'none',
  timecode?: Timecode,
  now: Date = new Date(),
): BillableLine => {
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

  const rawSeconds = calculateDuration(effectiveStart, effectiveEnd, entry.pausedSegments || []);
  const seconds = applyRounding(rawSeconds, roundingRule);
  const hours = roundHours(seconds / 3600);

  const isFixedCost = entry.manualAmount != null;
  let amount: number;

  if (isFixedCost) {
    // A fixed cost is not divisible by time, so it is attributed once — to the
    // period that contains the entry's start. Reporting on any other period
    // shows the entry's hours but none of the fee.
    const startsInRange = !dateRange || (entryStart >= dateRange.start && entryStart <= dateRange.end);
    amount = startsInRange ? roundCurrency(entry.manualAmount as number) : 0;
  } else {
    amount = timecode?.hourlyRate ? roundCurrency(hours * timecode.hourlyRate) : 0;
  }

  return { seconds, hours, amount, isRunning, isClipped, isFixedCost };
};

/**
 * Sum lines into a report row/total. Hours and amounts are summed from values
 * that are already rounded, so the printed lines add up to the printed total.
 */
export const sumBillableLines = (lines: BillableLine[]): { seconds: number; hours: number; amount: number } => {
  let seconds = 0;
  let hours = 0;
  let amount = 0;
  for (const line of lines) {
    seconds += line.seconds;
    hours += line.hours;
    amount += line.amount;
  }
  return { seconds, hours: roundHours(hours), amount: roundCurrency(amount) };
};
