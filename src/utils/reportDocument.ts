import { format, isValid, parseISO } from 'date-fns';
import type { EventAttributes } from 'ics';
import type { Entry, Group, Settings, Timecode } from '../types';
import {
  formatWorkedHours,
  roundingNote,
  summarizeReport,
  zeroBilledNote,
  type BillableLine,
  type RoundingScope,
} from './billing';
import {
  calendarDayKey,
  calculateTaxBreakdown,
  calculateTotalPausedSeconds,
  formatDurationShort,
  roundHours,
} from './timeUtils';

/**
 * Everything between `summarizeReport` and the artifact a client receives.
 *
 * The invariants the billing module guarantees — a row's `rate x hours + fees`
 * is its amount, the printed total is the sum of the printed rows — can still
 * be broken on the way out of it, in the code that turns rows into a table or a
 * line of CSV. That is where the invoice-row arithmetic bug lived, not in
 * `billing.ts`, and it was invisible to every property guarding the module it
 * came out of. So the assembly lives here, as pure functions over plain data:
 * no jsPDF, no Blob, no React. The PDF handler positions what these return and
 * nothing more, and the two CSV exports are these strings.
 */

export const ROUNDING_RULE_LABELS: Record<string, string> = {
  none: 'None',
  '5min': 'Nearest 5 minutes',
  '10min': 'Nearest 10 minutes',
  '15min': 'Nearest 15 minutes',
};

export const ROUNDING_SCOPE_LABELS: Record<RoundingScope, string> = {
  entry: 'applied to each entry',
  day: 'applied per timecode per day',
  timecode: 'applied per timecode for the period',
  invoice: 'applied once to the report total',
};

export type ReportSettings = Settings | null | undefined;

export const currencySymbolFor = (settings: ReportSettings): string => settings?.currencySymbol || '$';

const taxLabelFor = (settings: ReportSettings): string => settings?.taxLabel || 'Tax';

/**
 * Money as it appears on a report. A zero is a dash; anything else prints,
 * negatives included — a credit, a discount or a negative-rate adjustment
 * counts toward the total, so hiding it makes the total unreconcilable.
 */
/**
 * Money, grouped.
 *
 * `toFixed(2)` alone prints $4800.00, which on a document a client reads as an
 * invoice is a figure they have to count digits on. The locale is pinned rather
 * than taken from the browser: the decimal separator has to stay a point, since
 * every other number in the report and both CSV exports use one, and a report
 * whose PDF says 4.800,00 where its spreadsheet says 4800.00 is worse than one
 * that groups by a convention the reader may not share.
 */
const GROUPED = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatMoney = (amount: number, currencySymbol: string): string => {
  // The minus belongs in front of the symbol. Formatting the signed number puts
  // it inside — "$-50.00" — which on a document a client reads scans as a typo,
  // where "-$50.00" reads as the credit it is.
  const sign = amount < 0 ? '-' : '';
  return `${sign}${currencySymbol}${GROUPED.format(Math.abs(amount))}`;
};

/** As `formatMoney`, but nothing at all reads as a dash rather than a zero. */
export const formatAmount = (amount: number, currencySymbol: string): string =>
  amount === 0 ? '-' : formatMoney(amount, currencySymbol);

/**
 * A CSV cell, quoted, with a leading apostrophe on anything a spreadsheet would
 * otherwise evaluate.
 *
 * The apostrophe is a deliberate trade-off, not an oversight. Excel and Sheets
 * read a leading `=`, `+`, `-`, `@`, tab or CR as the start of a formula, so a
 * note beginning `=cmd|...` becomes an executable cell in whatever the recipient
 * opens the export in. Prefixing it makes the cell inert. The cost is that some
 * importers show the apostrophe as literal text rather than consuming it, so a
 * note that began with one of those characters reads with a stray quote in
 * front. A visible apostrophe is the better failure.
 *
 * Numeric columns deliberately do not come through here: they are generated
 * from numbers, never from user input, and quoting them would stop a
 * spreadsheet reading them as numbers at all.
 */
export const escapeCSV = (str: string): string => {
  let escaped = String(str ?? '').replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(escaped)) {
    escaped = "'" + escaped;
  }
  return `"${escaped}"`;
};

export const safeFormatDate = (d: Date, fmt: string, fallback = ''): string =>
  isValid(d) ? format(d, fmt) : fallback;

/** One timecode's line on the summary table, with everything a row prints. */
export interface ReportTimecodeRow {
  id: string;
  name: string;
  groupName: string;
  /** null when the timecode carries no rate, which prints as a dash. */
  hourlyRate: number | null;
  durationHours: number;
  earnings: number;
  /** Kept apart from `earnings` so a row prints arithmetic a client can check. */
  fees: number;
  color: string;
}

export interface ReportGroupRow {
  id: string;
  name: string;
  durationHours: number;
  color: string;
}

export interface TaxBreakdown {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * The one roll-up the screen, the PDF and both CSVs read from.
 *
 * Deriving it separately per surface is what let the same report show one
 * number in one place and another elsewhere, so there is exactly one of these
 * per rendered report and every document is a formatting of it.
 */
export interface ReportModel {
  timecodeData: ReportTimecodeRow[];
  groupData: ReportGroupRow[];
  totalSeconds: number;
  /** The sum of the printed rows, so the Total line reconciles with them. */
  totalHours: number;
  totalWorkedSeconds: number;
  totalEarnings: number;
  totalFees: number;
  taxBreakdown: TaxBreakdown | null;
  zeroLinesCount: number;
  /** Which entries dropped out, worded once for the screen, the PDF and the CSV. */
  zeroLinesNote: string | null;
  /** The gap between the clock and the hours billed, worded once. */
  roundingDelta: string | null;
  showFeesColumn: boolean;
  showEarningsColumn: boolean;
}

export interface ReportModelInput {
  /** The entries the report shows: the window, narrowed by the filters. */
  entries: Entry[];
  /** Lines built over the whole window, so a filter cannot move a bucket. */
  lines: Map<string, BillableLine>;
  timecodeMap: Map<string, Timecode>;
  groupMap: Map<string, Group>;
  settings: ReportSettings;
}

export const buildReportModel = ({
  entries,
  lines,
  timecodeMap,
  groupMap,
  settings,
}: ReportModelInput): ReportModel => {
  // Rows, groups and totals all come from one roll-up so a generated document
  // cannot print a row whose own arithmetic disagrees with its column.
  const summary = summarizeReport(entries, lines, timecodeMap);
  const { totals } = summary;

  const timecodeData: ReportTimecodeRow[] = summary.timecodeRows
    .map((row) => {
      const tc = timecodeMap.get(row.id);
      return {
        id: row.id,
        name: tc?.name || 'Unknown',
        groupName: tc?.groupId ? groupMap.get(tc.groupId)?.name || 'Unknown' : 'Ungrouped',
        hourlyRate: tc?.hourlyRate ?? null,
        durationHours: row.hours,
        earnings: row.amount,
        fees: row.fees,
        color: tc?.color || (tc?.groupId ? groupMap.get(tc.groupId)?.color : undefined) || '#cbd5e1',
      };
    })
    .sort((a, b) => b.durationHours - a.durationHours);

  const groupData: ReportGroupRow[] = summary.groupRows
    .map((row) => {
      const grp = groupMap.get(row.id);
      return {
        id: row.id,
        name: row.id === 'ungrouped' ? 'Ungrouped' : grp?.name || 'Unknown',
        durationHours: row.hours,
        color: grp?.color || '#cbd5e1',
      };
    })
    .sort((a, b) => b.durationHours - a.durationHours);

  const taxBreakdown = settings?.taxEnabled && settings?.taxRate
    ? calculateTaxBreakdown(totals.amount, settings.taxRate, !!settings.taxInclusive)
    : null;

  const roundingRule = settings?.roundingRule ?? 'none';

  return {
    timecodeData,
    groupData,
    totalSeconds: totals.seconds,
    totalHours: summary.totalHours,
    totalWorkedSeconds: totals.workedSeconds,
    totalEarnings: totals.amount,
    totalFees: totals.fees,
    taxBreakdown,
    zeroLinesCount: summary.zeroLinesCount,
    zeroLinesNote: zeroBilledNote(summary.zeroLinesCount, roundingRule),
    roundingDelta: roundingNote(
      totals.workedSeconds,
      totals.seconds,
      totals.hasFixedCost,
      summary.zeroLinesCount,
      roundingRule,
    ),
    // A fixed cost bills as a fee instead of by the hour, so it adds no hours to
    // its row. Without the fee broken out, a row carrying one printed a Total
    // that Rate x Hours did not reach and the reader had no way to see why.
    showFeesColumn: totals.fees !== 0 || summary.timecodeRows.some((row) => row.fees !== 0),
    showEarningsColumn: totals.amount !== 0 || summary.timecodeRows.some((row) => row.amount !== 0),
  };
};

/** The money column's heading, shared by the PDF and the summary CSV. */
export const earningsColumnLabel = (model: ReportModel, settings: ReportSettings, plainLabel: string): string =>
  settings?.taxInclusive && model.taxBreakdown
    ? `Total (incl. ${taxLabelFor(settings)})`
    : plainLabel;

const subtotalLabelFor = (settings: ReportSettings): string =>
  settings?.taxInclusive ? `Subtotal (excl. ${taxLabelFor(settings)})` : 'Subtotal';

const taxRowLabelFor = (settings: ReportSettings): string =>
  `${taxLabelFor(settings)} (${settings?.taxRate}%)`;

export interface SummaryTable {
  head: string[][];
  body: string[][];
  foot: string[][];
}

/**
 * The summary table's three sections, as arrays of cells.
 *
 * Split out of the PDF handler so the numbers a client reads can be asserted
 * without a PDF renderer: that the Hours column sums to the foot's hours, that
 * the money column sums to the foot's money, and that every row satisfies
 * `rate x hours + fees = amount`.
 */
export const buildSummaryTable = (model: ReportModel, settings: ReportSettings): SummaryTable => {
  const currencySymbol = currencySymbolFor(settings);
  const { showFeesColumn, taxBreakdown, totalHours, totalFees, totalEarnings } = model;

  const head = [[
    'Timecode',
    'Group',
    'Rate',
    'Hours',
    ...(showFeesColumn ? ['Fees'] : []),
    earningsColumnLabel(model, settings, 'Total'),
  ]];

  // With a Fees column the row reads as arithmetic the client can check:
  // Rate x Hours + Fees = Total. It only appears when there is a fee to show,
  // so an ordinary hourly report keeps the four columns it had.
  const body = model.timecodeData.map((tc) => {
    const rate = tc.hourlyRate ? `${formatMoney(tc.hourlyRate, currencySymbol)}/hr` : '-';
    const row = [tc.name, tc.groupName, rate, tc.durationHours.toFixed(2)];
    if (showFeesColumn) row.push(formatAmount(tc.fees, currencySymbol));
    row.push(formatAmount(tc.earnings, currencySymbol));
    return row;
  });

  // A tax line labels itself in the column immediately before the money, so the
  // leading blanks grow with the table rather than being counted out.
  const feeCell = showFeesColumn ? [formatAmount(totalFees, currencySymbol)] : [];
  const labelledFootRow = (label: string, value: string) => {
    const width = showFeesColumn ? 6 : 5;
    return [...Array(width - 2).fill(''), label, value];
  };

  const foot = taxBreakdown
    ? [
        labelledFootRow(subtotalLabelFor(settings), formatMoney(taxBreakdown.subtotal, currencySymbol)),
        labelledFootRow(taxRowLabelFor(settings), formatMoney(taxBreakdown.tax, currencySymbol)),
        ['', 'Total', '', totalHours.toFixed(2), ...feeCell, formatMoney(taxBreakdown.total, currencySymbol)],
      ]
    : [['', 'Total', '', totalHours.toFixed(2), ...feeCell, formatAmount(totalEarnings, currencySymbol)]];

  return { head, body, foot };
};

/**
 * The summary export, in the same shape as the PDF summary table.
 *
 * A spreadsheet handed to a client is the document they reconcile against, so
 * it carries the same disclosure the PDF does: it cannot be the one copy of the
 * report that does not say the hours were rounded, or that entries are missing
 * from it. The notes are appended as labelled rows, like the totals, so the
 * column layout still parses.
 */
export const buildSummaryCSV = (model: ReportModel, settings: ReportSettings): string => {
  const { showFeesColumn, taxBreakdown, totalHours, totalFees, totalEarnings } = model;
  const feeCol = (value: string) => (showFeesColumn ? [value] : []);

  const headers = [
    'Timecode',
    'Group',
    'Duration (Hours)',
    ...feeCol('Fees'),
    earningsColumnLabel(model, settings, 'Earnings'),
  ];

  const rows = model.timecodeData.map((tc) =>
    [
      escapeCSV(tc.name),
      escapeCSV(tc.groupName),
      // Two decimals, like the total row beneath it and like the PDF beside it.
      // A column that prints 1.5 on the rows and 1.50 on its own total invites
      // exactly the reconciliation question the export exists to answer.
      tc.durationHours.toFixed(2),
      ...feeCol(tc.fees.toFixed(2)),
      tc.earnings.toFixed(2),
    ].join(','),
  );

  if (taxBreakdown) {
    rows.push([
      escapeCSV(subtotalLabelFor(settings)),
      '',
      totalHours.toFixed(2),
      ...feeCol(totalFees.toFixed(2)),
      taxBreakdown.subtotal.toFixed(2),
    ].join(','));
    rows.push([
      escapeCSV(taxRowLabelFor(settings)),
      '',
      '',
      ...feeCol(''),
      taxBreakdown.tax.toFixed(2),
    ].join(','));
    rows.push([
      escapeCSV('Total'),
      '',
      totalHours.toFixed(2),
      ...feeCol(totalFees.toFixed(2)),
      taxBreakdown.total.toFixed(2),
    ].join(','));
  } else {
    rows.push([
      escapeCSV('Total'),
      '',
      totalHours.toFixed(2),
      ...feeCol(totalFees.toFixed(2)),
      totalEarnings.toFixed(2),
    ].join(','));
  }

  const roundingRule = settings?.roundingRule ?? 'none';
  if (roundingRule !== 'none') {
    rows.push([
      escapeCSV('Rounding'),
      escapeCSV(
        `${ROUNDING_RULE_LABELS[roundingRule]}, ${ROUNDING_SCOPE_LABELS[settings?.roundingScope || 'day']} — ` +
        `worked ${roundHours(model.totalWorkedSeconds / 3600).toFixed(2)} h, billed ${totalHours.toFixed(2)} h`,
      ),
      '',
      ...feeCol(''),
      '',
    ].join(','));
  }
  if (model.zeroLinesNote) {
    rows.push([escapeCSV('Not billed'), escapeCSV(model.zeroLinesNote), '', ...feeCol(''), ''].join(','));
  }

  return [headers.join(','), ...rows].join('\n');
};

/** Entries in the order every document prints them: earliest first. */
export const sortEntriesForDocument = (entries: Entry[]): Entry[] =>
  [...entries].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

/**
 * The PDF's itemised table.
 *
 * Same row set and same order as the detailed CSV, so the document and the
 * spreadsheet a client checks it against cannot list different work.
 */
export const buildDetailTable = (
  entries: Entry[],
  lines: Map<string, BillableLine>,
  timecodeMap: Map<string, Timecode>,
  settings: ReportSettings,
): { head: string[][]; body: string[][] } => {
  const currencySymbol = currencySymbolFor(settings);

  const body = sortEntriesForDocument(entries).map((e) => {
    const tc = timecodeMap.get(e.timecodeId);
    const line = lines.get(e.id);
    // A fee bills no hours, so the Hours cell is a dash rather than a 0.00 that
    // reads as a missing figure.
    const hrs = line?.isFixedCost ? '—' : (line?.hours ?? 0).toFixed(2);
    // Parsed once and checked once. `format` throws on an unparseable timestamp,
    // and one such row in a restored backup used to take the entire report with
    // it. A dash marks the cell that could not be read; the rest of the row —
    // timecode, hours, amount, note — still prints what it has.
    const start = parseISO(e.startTime);
    const end = e.endTime ? parseISO(e.endTime) : null;
    const paused =
      end && isValid(start) && isValid(end)
        ? formatDurationShort(calculateTotalPausedSeconds(start, end, e.pausedSegments))
        : '—';
    return [
      safeFormatDate(start, 'MMM d', '—'),
      tc?.name ?? 'Unknown',
      safeFormatDate(start, 'HH:mm', '—'),
      end ? safeFormatDate(end, 'HH:mm', '—') : 'Running',
      paused,
      hrs,
      formatAmount(line?.amount ?? 0, currencySymbol),
      e.note || '—',
    ];
  });

  return {
    head: [['Date', 'Timecode', 'Start', 'End', 'Paused', 'Hours', 'Amount', 'Note']],
    body,
  };
};

/**
 * The detailed raw export.
 *
 * Two duration columns, because this export is the one a user is told to keep
 * to check an invoice against, and a single column could only be one of the two
 * things it needs to be. `worked` is the measurement: time on the clock inside
 * the reporting window, unrounded, and present even for a fee entry whose hours
 * are not billed. `billed` is what the invoice charged for, after the rounding
 * rule has been applied at its scope and shared back across the bucket.
 * Printing only `billed` under a header reading "raw" meant the ground-truth
 * record silently agreed with the invoice it was meant to corroborate: a
 * 50-minute entry at 15min/day rounding read 0.75.
 */
export const buildDetailedRawCSV = (
  entries: Entry[],
  lines: Map<string, BillableLine>,
  timecodeMap: Map<string, Timecode>,
  groupMap: Map<string, Group>,
): string => {
  // Quoted like any other field: two of these names contain a comma, and an
  // unquoted header would split into two columns and shift every heading after
  // it out of line with the data beneath.
  const headers = [
    'Date', 'Timecode', 'Group', 'Start', 'End',
    'Duration (h, worked)', 'Duration (h, billed)', 'Amount', 'Note',
  ].map(escapeCSV);

  const rows = sortEntriesForDocument(entries).map((e) => {
    const tc = timecodeMap.get(e.timecodeId);
    const grp = tc?.groupId ? groupMap.get(tc.groupId) : undefined;
    const line = lines.get(e.id);
    const amount = line?.amount ?? 0;
    // As in `buildDetailTable`: `calendarDayKey` throws its own RangeError on an
    // invalid date and `format` throws another, so a single unreadable timestamp
    // used to mean no CSV at all — and no clue which entry was at fault. An
    // empty cell leaves the row visible and the file importable.
    const start = parseISO(e.startTime);
    const end = e.endTime ? parseISO(e.endTime) : null;
    return [
      escapeCSV(isValid(start) ? calendarDayKey(start) : ''),
      escapeCSV(tc?.name ?? 'Unknown'),
      escapeCSV(grp?.name ?? 'Ungrouped'),
      escapeCSV(safeFormatDate(start, 'HH:mm:ss')),
      escapeCSV(end ? safeFormatDate(end, 'HH:mm:ss') : ''),
      formatWorkedHours(line?.workedSeconds ?? 0),
      // A fee bills no hours; an empty cell says so, where 0.00 would read as a
      // duration that was measured and came out at zero. The worked column
      // beside it still carries its time on the clock.
      line?.isFixedCost ? '' : (line?.hours ?? 0).toFixed(2),
      amount !== 0 ? amount.toFixed(2) : '',
      escapeCSV(e.note),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
};

export interface CalendarExport {
  events: EventAttributes[];
  /**
   * Entries left out because their timestamps could not be read. The caller is
   * expected to say so: an entry quietly missing from a calendar is not
   * something the user would otherwise notice.
   */
  skipped: Entry[];
}

export const buildCalendarEvents = (
  entries: Entry[],
  timecodeMap: Map<string, Timecode>,
  now: Date = new Date(),
): CalendarExport => {
  const events: EventAttributes[] = [];
  const skipped: Entry[] = [];

  for (const e of sortEntriesForDocument(entries)) {
    const tc = timecodeMap.get(e.timecodeId);
    const start = parseISO(e.startTime);
    const end = e.endTime ? parseISO(e.endTime) : now;

    // This one does not throw — it writes NaN into every component and produces
    // an event no calendar can read, which can cost the whole file rather than
    // the one entry. There is no blank to fall back to as there is in the CSV,
    // so an entry whose dates cannot be read is left out and reported instead.
    if (!isValid(start) || !isValid(end)) {
      skipped.push(e);
      continue;
    }

    events.push({
      uid: e.id,
      start: [
        start.getUTCFullYear(),
        start.getUTCMonth() + 1,
        start.getUTCDate(),
        start.getUTCHours(),
        start.getUTCMinutes(),
      ],
      end: [
        end.getUTCFullYear(),
        end.getUTCMonth() + 1,
        end.getUTCDate(),
        end.getUTCHours(),
        end.getUTCMinutes(),
      ],
      startInputType: 'utc',
      startOutputType: 'utc',
      endInputType: 'utc',
      endOutputType: 'utc',
      title: tc?.name ?? 'Unknown',
      description: e.note ?? '',
    } as EventAttributes);
  }

  return { events, skipped };
};

export interface ReportMetaInput {
  preparedFor: string;
  preparedBy: string;
  periodText: string;
  generatedText: string;
  customFields: { label: string; value: string }[];
  settings: ReportSettings;
}

/**
 * The labelled lines above the summary table.
 *
 * Text, but text that makes a claim about the numbers underneath it — that the
 * hours were rounded, that entries are missing, that part of the money is a fee
 * rather than an hourly charge. It is assembled here so those claims can be
 * asserted against the same model the table is built from.
 */
export const buildReportMeta = (
  model: ReportModel,
  { preparedFor, preparedBy, periodText, generatedText, customFields, settings }: ReportMetaInput,
): { label: string; value: string }[] => {
  const currencySymbol = currencySymbolFor(settings);
  const lines: { label: string; value: string }[] = [];
  const addMeta = (label: string, value: string) => {
    if (value) lines.push({ label, value });
  };

  addMeta('Prepared for:', preparedFor);
  addMeta('Prepared by:', preparedBy);
  addMeta('Period:', periodText);
  addMeta('Generated:', generatedText);

  // Disclose rounding on the document itself. Without this the client sees a
  // billed figure that does not match the itemised times and has no way to tell
  // why.
  const workedHours = roundHours(model.totalWorkedSeconds / 3600);
  const roundingRule = settings?.roundingRule ?? 'none';
  if (roundingRule !== 'none') {
    addMeta(
      'Rounding:',
      `${ROUNDING_RULE_LABELS[roundingRule]}, ${ROUNDING_SCOPE_LABELS[settings?.roundingScope || 'day']} — ` +
      `worked ${workedHours.toFixed(2)} h, billed ${model.totalHours.toFixed(2)} h` +
      // Which entries went missing, not just how much time did. The billed
      // figure alone cannot tell a reader that a line is absent entirely.
      (model.zeroLinesNote ? ` (${model.zeroLinesNote})` : ''),
    );
  } else if (model.zeroLinesNote) {
    addMeta('Not billed:', `${model.zeroLinesNote}.`);
  }
  // The other reason the Hours column can be short of the time on the clock: a
  // fixed amount bills as a fee, so its entry shows a dash for Hours and its
  // minutes are in neither the row nor the total.
  if (model.totalFees !== 0) {
    addMeta(
      'Fees:',
      `${formatMoney(model.totalFees, currencySymbol)} billed as fixed amounts rather than by the hour — ` +
      `worked ${workedHours.toFixed(2)} h in total, of which ${model.totalHours.toFixed(2)} h is billed at a rate.`,
    );
  }
  if (settings?.taxEnabled && settings?.taxRate) {
    const modeStr = settings.taxInclusive ? 'inclusive — line totals include tax' : 'exclusive';
    addMeta('Tax:', `${settings.taxRate}% ${taxLabelFor(settings)}, ${modeStr}`);
  }

  customFields
    .filter((f) => f.label.trim() && f.value.trim())
    .forEach((f) => addMeta(`${f.label}:`, f.value));

  return lines;
};
