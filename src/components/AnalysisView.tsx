import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, subWeeks, parseISO, format,
  eachDayOfInterval, addDays, isValid
} from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line, CartesianGrid, Legend
} from 'recharts';
import {
  Download, Printer, AlertTriangle, Calendar, Loader2, X, TrendingUp, TrendingDown,
  CheckCircle2, Info, Plus, BarChart2, PieChart as PieIcon, ExternalLink
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { calculateDuration, calendarDayBounds, calendarDayKey, formatDurationShort, roundCurrency, workedIntervals } from '../utils/timeUtils';
import { buildReportLines, distributeAcrossBuckets, workedSecondsFor } from '../utils/billing';
import {
  buildCalendarEvents, buildDetailedRawCSV, buildReportMeta, buildReportModel,
  buildSummaryCSV, formatAmount as formatAmountCell, formatMoney as formatCurrency, safeFormatDate,
} from '../utils/reportDocument';
import { renderReportPdf } from '../utils/reportPdf';
import { createEvents } from 'ics';
import { EntryEditModal } from './EntryEditModal';
import { useNamedDownload } from '../hooks/useNamedDownload';
import type { Entry } from '../types';

type DatePreset = 'week' | 'last4Weeks' | 'custom';
type TabType = 'overview' | 'estimates' | 'timeline' | 'export';
type BreakdownType = 'timecode' | 'group';
type ChartType = 'bar' | 'pie';
type SortField = 'bias' | 'typicalMiss' | 'hitRate' | 'count' | 'name';

export const AnalysisView: React.FC = () => {
  const { entries, timecodes, groups, settings, updateSettings } = useTimeTracker();
  const currencySymbol = settings?.currencySymbol || '$';
  const { addToast } = useToast();
  const { triggerDownload, SaveAsDialog } = useNamedDownload();

  // Active Tab
  const [activeTab, setActiveTab] = useState<TabType>('export');

  // Filters State
  const [preset, setPreset] = useState<DatePreset>('week');
  const [customStart, setCustomStart] = useState<string>(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState<string>(format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [selectedTimecodeId, setSelectedTimecodeId] = useState<string>('all');
  const [comparePrevious, setComparePrevious] = useState<boolean>(false);
  const [tick, setTick] = useState(0);

  // Export Metadata State
  const [preparedForOverride, setPreparedForOverride] = useState('');
  const [preparedByOverride, setPreparedByOverride] = useState('');
  const [footerTextOverride, setFooterTextOverride] = useState('');
  const [reportFields, setReportFields] = useState<{ id: string; label: string; value: string }[]>([]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Overview Interaction State
  const [breakdownType, setBreakdownType] = useState<BreakdownType>('timecode');
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedChip, setExpandedChip] = useState<'gaps' | 'overlaps' | 'tax' | null>(null);

  // Estimates State
  const [tcSortField, setTcSortField] = useState<SortField>('bias');
  const [tcSortAsc, setTcSortAsc] = useState<boolean>(false);
  const [worstOffenderSort, setWorstOffenderSort] = useState<'pct' | 'mins'>('pct');
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);

  // Fast maps
  const timecodeMap = useMemo(() => new Map(timecodes.map(t => [t.id, t])), [timecodes]);
  const groupMap = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);

  useEffect(() => {
    setReportFields((settings?.customFields || []).map(f => ({ ...f })));
  }, [settings?.customFields]);

  const updateReportField = (i: number, patch: Partial<{ label: string; value: string }>) =>
    setReportFields(prev => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const timecodeOptions = useMemo(() => {
    return timecodes.filter(t => !t.archived && (selectedGroupId === 'all' || t.groupId === selectedGroupId));
  }, [timecodes, selectedGroupId]);

  useEffect(() => {
    if (selectedTimecodeId !== 'all' && !timecodeOptions.some(t => t.id === selectedTimecodeId)) {
      setSelectedTimecodeId('all');
    }
  }, [timecodeOptions, selectedTimecodeId]);

  const scopeLabel = useMemo(() => {
    if (selectedTimecodeId !== 'all') return timecodeMap.get(selectedTimecodeId)?.name ?? 'All';
    if (selectedGroupId !== 'all') return groupMap.get(selectedGroupId)?.name ?? 'All';
    return 'All';
  }, [selectedGroupId, selectedTimecodeId, groupMap, timecodeMap]);

  const scopeSlug = scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const isCustomInvalid = useMemo(() => {
    if (preset !== 'custom') return false;
    if (!customStart || !customEnd) return true;
    const s = new Date(customStart + 'T00:00:00');
    const e = new Date(customEnd + 'T00:00:00');
    return !isValid(s) || !isValid(e) || e < s;
  }, [preset, customStart, customEnd]);

  // Main Date Range
  const dateRange = useMemo(() => {
    const now = new Date();
    if (preset === 'custom' && isCustomInvalid) {
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    }
    switch (preset) {
      case 'week':
        return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'last4Weeks': {
        const start = startOfWeek(subWeeks(now, 3), { weekStartsOn: 1 });
        return { start, end: endOfWeek(now, { weekStartsOn: 1 }) };
      }
      case 'custom':
      default: {
        const s = startOfDay(new Date(customStart + 'T00:00:00'));
        const e = endOfDay(new Date(customEnd + 'T00:00:00'));
        if (!isValid(s) || !isValid(e)) {
          return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
        }
        return { start: s, end: e };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customStart, customEnd, isCustomInvalid, tick]);

  // Previous Date Range for comparison
  const prevDateRange = useMemo(() => {
    const rangeMs = dateRange.end.getTime() - dateRange.start.getTime() + 1;
    const prevEnd = new Date(dateRange.start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - rangeMs + 1);
    return { start: prevStart, end: prevEnd };
  }, [dateRange]);

  // Every entry in the reporting window, before the group and timecode
  // dropdowns are applied. This is what the rounding buckets are built from:
  // at 'timecode' and 'invoice' scope a bucket's total is the set of entries
  // handed to `buildLinesFromSettings`, so passing only the displayed subset
  // made an entry's billable minutes move whenever the dropdowns changed.
  const periodEntries = useMemo(() => {
    return entries.filter(entry => {
      const entryStart = parseISO(entry.startTime);
      const entryEnd = entry.endTime ? parseISO(entry.endTime) : new Date();
      return entryStart <= dateRange.end && entryEnd >= dateRange.start;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, dateRange, tick]);

  const matchesFilters = useCallback((entry: Entry) => {
    const tc = timecodeMap.get(entry.timecodeId);
    const matchesGroup = selectedGroupId === 'all' || tc?.groupId === selectedGroupId;
    const matchesTimecode = selectedTimecodeId === 'all' || entry.timecodeId === selectedTimecodeId;
    return matchesGroup && matchesTimecode;
  }, [timecodeMap, selectedGroupId, selectedTimecodeId]);

  // What the report actually shows: the window narrowed by the dropdowns.
  const filteredEntries = useMemo(
    () => periodEntries.filter(matchesFilters),
    [periodEntries, matchesFilters]
  );

  // Previous Period, same split: the whole window for the buckets, the filtered
  // subset for what is compared.
  const prevPeriodEntries = useMemo(() => {
    if (!comparePrevious) return [];
    return entries.filter(entry => {
      const entryStart = parseISO(entry.startTime);
      const entryEnd = entry.endTime ? parseISO(entry.endTime) : new Date();
      return entryStart <= prevDateRange.end && entryEnd >= prevDateRange.start;
    });
  }, [entries, prevDateRange, comparePrevious]);

  const prevFilteredEntries = useMemo(
    () => prevPeriodEntries.filter(matchesFilters),
    [prevPeriodEntries, matchesFilters]
  );

  // One billable line per entry, shared by the on-screen totals, the PDF summary
  // and detail tables, and the CSV export. Computing it once is what stops the
  // same entry being billed differently on different surfaces of one invoice.
  // Built over the whole window — see `periodEntries` — and looked up per
  // displayed entry, which is what the scope window contract requires.
  const billableLines = useMemo(() => {
    return buildReportLines(entries, settings, dateRange, { timecodeMap, now: new Date() });
  }, [entries, dateRange, timecodeMap, settings]);

  // Calculations for Current Period
  //
  // One roll-up, in one place, consumed by the screen and by every document
  // built from it. `reportDocument` owns everything downstream of
  // `summarizeReport` so the assembly can be asserted without a PDF renderer.
  const {
    timecodeData, groupData, totalSeconds, totalHours, totalWorkedSeconds, totalEarnings,
    totalFees, taxBreakdown, zeroLinesCount, zeroLinesNote, roundingDelta,
    showFeesColumn, showEarningsColumn,
  } = useMemo(
    () => buildReportModel({ entries: filteredEntries, lines: billableLines, timecodeMap, groupMap, settings }),
    [filteredEntries, billableLines, timecodeMap, groupMap, settings],
  );

  const reportModel = useMemo(
    () => ({
      timecodeData, groupData, totalSeconds, totalHours, totalWorkedSeconds, totalEarnings,
      totalFees, taxBreakdown, zeroLinesCount, zeroLinesNote, roundingDelta,
      showFeesColumn, showEarningsColumn,
    }),
    [timecodeData, groupData, totalSeconds, totalHours, totalWorkedSeconds, totalEarnings,
      totalFees, taxBreakdown, zeroLinesCount, zeroLinesNote, roundingDelta,
      showFeesColumn, showEarningsColumn],
  );

  // Calculations for Previous Period (for comparisons)
  const prevStats = useMemo(() => {
    if (!comparePrevious) return null;
    let pSec = 0;
    let pEarn = 0;

    const prevLines = buildReportLines(entries, settings, prevDateRange, {
      timecodeMap,
      now: new Date(),
    });
    // Sum only the displayed subset, from lines bucketed over the whole window.
    prevFilteredEntries.forEach(entry => {
      const line = prevLines.get(entry.id);
      if (!line) return;
      if (line.seconds <= 0 && line.amount === 0) return;
      pSec += line.seconds;
      pEarn += line.amount;
    });
    pEarn = roundCurrency(pEarn);

    const diffSec = totalSeconds - pSec;
    const diffEarnings = totalEarnings - pEarn;
    const pctEarnings = pEarn > 0 ? Math.round(((totalEarnings - pEarn) / pEarn) * 100) : 0;

    return {
      prevSeconds: pSec,
      prevEarnings: pEarn,
      diffSec,
      diffEarnings,
      pctEarnings
    };
  }, [prevPeriodEntries, prevFilteredEntries, prevDateRange, comparePrevious, totalSeconds, totalEarnings, timecodeMap, settings]);

  // Detect overlaps
  const overlaps = useMemo(() => {
    const overlappingPairs: { e1: Entry, e2: Entry }[] = [];
    const sorted = [...filteredEntries].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const allowConcurrent = settings?.allowConcurrentTimers ?? false;

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const e1 = sorted[i];
        const e2 = sorted[j];

        const start1 = new Date(e1.startTime).getTime();
        const end1 = e1.endTime ? new Date(e1.endTime).getTime() : Date.now();
        const start2 = new Date(e2.startTime).getTime();
        const end2 = e2.endTime ? new Date(e2.endTime).getTime() : Date.now();

        if (start2 >= end1) {
          break;
        }

        if (allowConcurrent && e1.timecodeId !== e2.timecodeId) {
          continue;
        }

        if (start1 < end2 && start2 < end1) {
          overlappingPairs.push({ e1, e2 });
        }
      }
    }
    return overlappingPairs;
  }, [filteredEntries, settings?.allowConcurrentTimers]);

  // Detect gaps > 15 minutes
  const gaps = useMemo(() => {
    const detectedGaps: { start: Date, end: Date, durationMins: number }[] = [];
    const GAP_THRESHOLD_MINS = 15;
    const entriesByDay = new Map<string, Entry[]>();

    filteredEntries.forEach(entry => {
      if (!entry.endTime) return;
      const start = new Date(entry.startTime);
      const dateStr = calendarDayKey(start);
      if (!entriesByDay.has(dateStr)) {
        entriesByDay.set(dateStr, []);
      }
      entriesByDay.get(dateStr)!.push(entry);
    });

    entriesByDay.forEach((dayEntries) => {
      const sorted = [...dayEntries].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      if (sorted.length < 2) return;

      let currentEnd = new Date(sorted[0].endTime!);

      for (let i = 1; i < sorted.length; i++) {
        const nextStart = new Date(sorted[i].startTime);
        const nextEnd = new Date(sorted[i].endTime!);

        if (nextStart > currentEnd) {
          const gapMs = nextStart.getTime() - currentEnd.getTime();
          const gapMins = gapMs / (1000 * 60);

          if (gapMins >= GAP_THRESHOLD_MINS) {
            detectedGaps.push({ start: currentEnd, end: nextStart, durationMins: Math.round(gapMins) });
          }
        }

        if (nextEnd > currentEnd) {
          currentEnd = nextEnd;
        }
      }
    });

    return detectedGaps;
  }, [filteredEntries]);

  // Deep Estimates Analysis
  const estimateDeepData = useMemo(() => {
    const withEstimates = filteredEntries.filter(
      (e) => e.expectedDurationMinutes != null && e.expectedDurationMinutes > 0 && e.endTime
    );

    if (withEstimates.length === 0) return null;

    let totalExpectedSec = 0;
    let totalActualSec = 0;
    let onTimeCount = 0;
    let clippedCount = 0;

    const variances: { entry: Entry; variancePct: number; absVariancePct: number; diffSec: number }[] = [];

    withEstimates.forEach((e) => {
      const expectedSec = e.expectedDurationMinutes! * 60;
      // The whole entry, not the part of it inside the report's window.
      //
      // An estimate is made for a task, so the only actual it can be compared
      // against is that task's. `workedSecondsFor` returns the billable line's
      // clipped time, which is right for an invoice and wrong here: an entry
      // that started before the range began contributed only its tail, so a
      // task that ran exactly to estimate was reported as finishing far under
      // it — and the further the range cut into it, the better it looked.
      const actualSec = calculateDuration(parseISO(e.startTime), parseISO(e.endTime!), e.pausedSegments);
      if (billableLines.get(e.id)?.isClipped) clippedCount++;
      totalExpectedSec += expectedSec;
      totalActualSec += actualSec;
      if (actualSec <= expectedSec) onTimeCount++;

      const varPct = ((actualSec - expectedSec) / expectedSec) * 100;
      variances.push({
        entry: e,
        variancePct: varPct,
        absVariancePct: Math.abs(varPct),
        diffSec: actualSec - expectedSec,
      });
    });

    const biasPct = Math.round(
      variances.reduce((acc, v) => acc + v.variancePct, 0) / variances.length
    );

    const sortedAbs = [...variances].map(v => v.absVariancePct).sort((a, b) => a - b);
    const mid = Math.floor(sortedAbs.length / 2);
    const typicalMissPct = Math.round(
      sortedAbs.length % 2 !== 0
        ? sortedAbs[mid]
        : (sortedAbs[mid - 1] + sortedAbs[mid]) / 2
    );

    const bucketCounts = {
      under50: 0,
      under50to20: 0,
      under20to5: 0,
      onTarget: 0,
      over5to20: 0,
      over20to50: 0,
      over50: 0,
    };

    variances.forEach(v => {
      if (v.variancePct < -50) bucketCounts.under50++;
      else if (v.variancePct < -20) bucketCounts.under50to20++;
      else if (v.variancePct < -5) bucketCounts.under20to5++;
      else if (v.variancePct <= 5) bucketCounts.onTarget++;
      else if (v.variancePct <= 20) bucketCounts.over5to20++;
      else if (v.variancePct <= 50) bucketCounts.over20to50++;
      else bucketCounts.over50++;
    });

    const histogram = [
      { label: '< -50%', count: bucketCounts.under50, fill: '#3E7368' },
      { label: '-50 to -20%', count: bucketCounts.under50to20, fill: '#4d8a7d' },
      { label: '-20 to -5%', count: bucketCounts.under20to5, fill: '#64a193' },
      { label: '±5% (target)', count: bucketCounts.onTarget, fill: '#10161C' },
      { label: '5 to 20%', count: bucketCounts.over5to20, fill: '#d97d62' },
      { label: '20 to 50%', count: bucketCounts.over20to50, fill: '#c96a4c' },
      { label: '> 50%', count: bucketCounts.over50, fill: '#B85C3E' },
    ];

    const tcGroups = new Map<string, typeof variances>();
    variances.forEach(v => {
      const tcId = v.entry.timecodeId;
      if (!tcGroups.has(tcId)) tcGroups.set(tcId, []);
      tcGroups.get(tcId)!.push(v);
    });

    const perTimecodeTable = Array.from(tcGroups.entries()).map(([tcId, itemVars]) => {
      const tcName = timecodeMap.get(tcId)?.name ?? 'Unknown';
      const tcCount = itemVars.length;
      let sumExp = 0;
      let sumAct = 0;
      let tcOnTime = 0;

      itemVars.forEach(v => {
        sumExp += v.entry.expectedDurationMinutes! * 60;
        const actualSec = workedSecondsFor(billableLines, v.entry.id);
        sumAct += actualSec;
        if (actualSec <= v.entry.expectedDurationMinutes! * 60) tcOnTime++;
      });

      const avgExpMins = Math.round(sumExp / tcCount / 60);
      const avgActMins = Math.round(sumAct / tcCount / 60);

      const tcBias = Math.round(
        itemVars.reduce((acc, v) => acc + v.variancePct, 0) / tcCount
      );

      const sortedTcAbs = itemVars.map(v => v.absVariancePct).sort((a, b) => a - b);
      const tcMid = Math.floor(sortedTcAbs.length / 2);
      const tcTypicalMiss = Math.round(
        sortedTcAbs.length % 2 !== 0
          ? sortedTcAbs[tcMid]
          : (sortedTcAbs[tcMid - 1] + sortedTcAbs[tcMid]) / 2
      );

      const tcHitRate = Math.round((tcOnTime / tcCount) * 100);

      return {
        id: tcId,
        name: tcName,
        count: tcCount,
        avgExpMins,
        avgActMins,
        bias: tcBias,
        typicalMiss: tcTypicalMiss,
        hitRate: tcHitRate,
      };
    });

    const overruns = variances.filter(v => v.diffSec > 0);
    const sortedWorst = [...overruns].sort((a, b) => {
      if (worstOffenderSort === 'pct') return b.variancePct - a.variancePct;
      return b.diffSec - a.diffSec;
    }).slice(0, 5);

    return {
      count: withEstimates.length,
      hitRatePct: Math.round((onTimeCount / withEstimates.length) * 100),
      biasPct,
      typicalMissPct,
      histogram,
      perTimecodeTable,
      worstOffenders: sortedWorst,
      // Entries this range only partly covers. Their actuals are whole, which
      // is the comparison the estimate deserves, but it makes these figures
      // wider than the hours the report bills — worth saying rather than
      // leaving as a total that quietly does not reconcile.
      clippedCount,
    };
  }, [filteredEntries, billableLines, timecodeMap, worstOffenderSort]);

  // Estimates Trend Chart over time (Trailing periods)
  const estimatesTrend = useMemo(() => {
    const withEstimates = entries.filter(
      (e) => e.expectedDurationMinutes != null && e.expectedDurationMinutes > 0 && e.endTime && !e.deletedAt
    );
    if (withEstimates.length === 0) return [];

    const weeks: { label: string; start: Date; end: Date; entries: Entry[] }[] = [];
    const now = new Date();

    for (let i = 7; i >= 0; i--) {
      const wStart = startOfWeek(now, { weekStartsOn: 1 });
      const currentStart = addDays(wStart, -i * 7);
      const currentEnd = endOfWeek(currentStart, { weekStartsOn: 1 });
      weeks.push({
        label: format(currentStart, 'MMM d'),
        start: currentStart,
        end: currentEnd,
        entries: [],
      });
    }

    withEstimates.forEach(e => {
      const eStart = parseISO(e.startTime);
      const targetWeek = weeks.find(w => eStart >= w.start && eStart <= w.end);
      if (targetWeek) targetWeek.entries.push(e);
    });

    return weeks.map(w => {
      if (w.entries.length === 0) {
        return { label: w.label, bias: 0, hitRate: null, count: 0 };
      }
      let onTime = 0;
      let totalBias = 0;

      w.entries.forEach(e => {
        const expSec = e.expectedDurationMinutes! * 60;
        const actualSec = calculateDuration(parseISO(e.startTime), parseISO(e.endTime!), e.pausedSegments || []);
        if (actualSec <= expSec) onTime++;
        totalBias += ((actualSec - expSec) / expSec) * 100;
      });

      return {
        label: w.label,
        bias: Math.round(totalBias / w.entries.length),
        hitRate: Math.round((onTime / w.entries.length) * 100),
        count: w.entries.length,
      };
    });
  }, [entries]);

  // Sorted per-timecode estimates table
  const sortedPerTimecodeTable = useMemo(() => {
    if (!estimateDeepData?.perTimecodeTable) return [];
    return [...estimateDeepData.perTimecodeTable].sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      switch (tcSortField) {
        case 'bias':
          valA = Math.abs(a.bias);
          valB = Math.abs(b.bias);
          break;
        case 'typicalMiss':
          valA = a.typicalMiss;
          valB = b.typicalMiss;
          break;
        case 'hitRate':
          valA = a.hitRate;
          valB = b.hitRate;
          break;
        case 'count':
          valA = a.count;
          valB = b.count;
          break;
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          break;
      }

      if (valA < valB) return tcSortAsc ? -1 : 1;
      if (valA > valB) return tcSortAsc ? 1 : -1;
      return 0;
    });
  }, [estimateDeepData?.perTimecodeTable, tcSortField, tcSortAsc]);

  // Timeline Data
  //
  // Built from the same billable lines as the summary, not by re-rounding each
  // day-slice on its own: rounding per slice ignored `roundingScope` entirely,
  // so the bars could add up to a different total than the report they sit in.
  // Each line's billable seconds are shared across the days its worked time
  // covers, in proportion to how much fell on each, so the chart reconciles
  // with the total whatever scope is in use.
  const timelineDays = useMemo(() => {
    const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
    // Half-open days: each ends where the next begins, so an entry crossing
    // midnight loses no second to `endOfDay`'s .999 and is not counted twice at
    // the boundary either.
    const dayBounds = days.map(d => {
      const { start, end } = calendarDayBounds(d);
      return {
        start: Math.max(start.getTime(), dateRange.start.getTime()),
        end: Math.min(end.getTime(), dateRange.end.getTime()),
      };
    });
    const daySeconds = distributeAcrossBuckets(filteredEntries, billableLines, dayBounds);

    return days.map((d, i) => ({
      date: d,
      dateStr: format(d, 'MMM d, yyyy'),
      hours: Number((daySeconds[i] / 3600).toFixed(1)),
      seconds: daySeconds[i],
      // The window actually charted, which is a calendar day only when the
      // report covers a whole one — and 23 or 25 hours long twice a year.
      bounds: dayBounds[i],
    }));
  }, [dateRange, filteredEntries, billableLines]);

  /**
   * The single-day bar.
   *
   * Two things were wrong with drawing each entry's raw span here. It included
   * paused time, so the blocks showed more work than any other surface did —
   * and the moment the range grew to two days the same data was presented as
   * billable time by the heatmap, with nothing to say the question had changed.
   * And the axis assumed a 24-hour day, which puts every block in the wrong
   * place on the two days a year that are not one.
   *
   * So: on-the-clock spans, positioned against the day's real length, with the
   * billed figure named underneath.
   */
  const { blocks: singleDayBlocks, workedSeconds: singleDayWorkedSeconds } = useMemo(() => {
    const day = timelineDays.length === 1 ? timelineDays[0] : null;
    const span = day ? day.bounds.end - day.bounds.start : 0;
    if (!day || span <= 0) return { blocks: [], workedSeconds: 0 };

    const windowStart = day.bounds.start;
    const blocks: { key: string; leftPercent: number; widthPercent: number; color: string; title: string }[] = [];
    let workedMs = 0;

    for (const entry of filteredEntries) {
      const from = new Date(Math.max(parseISO(entry.startTime).getTime(), windowStart));
      const to = new Date(Math.min(
        (entry.endTime ? parseISO(entry.endTime) : new Date()).getTime(),
        day.bounds.end,
      ));
      if (to <= from) continue;

      const tc = timecodeMap.get(entry.timecodeId);
      const color = tc?.color || (tc?.groupId ? groupMap.get(tc.groupId)?.color : undefined) || '#cbd5e1';

      workedIntervals(from, to, entry.pausedSegments).forEach((interval, i) => {
        workedMs += interval.end - interval.start;
        blocks.push({
          key: `${entry.id}-${i}`,
          leftPercent: ((interval.start - windowStart) / span) * 100,
          widthPercent: ((interval.end - interval.start) / span) * 100,
          color,
          title: `${tc?.name || 'Unknown'} (${format(interval.start, 'h:mm a')} – ${format(interval.end, 'h:mm a')})`,
        });
      });
    }

    return { blocks, workedSeconds: Math.round(workedMs / 1000) };
  }, [timelineDays, filteredEntries, timecodeMap, groupMap]);

  /** Hour gridlines at the day's own hour boundaries, however long it is. */
  const singleDayTicks = useMemo(() => {
    const day = timelineDays.length === 1 ? timelineDays[0] : null;
    const span = day ? day.bounds.end - day.bounds.start : 0;
    if (!day || span <= 0) return [];

    const ticks: { at: number; leftPercent: number; label: string }[] = [];
    for (let at = day.bounds.start; at <= day.bounds.end; at += 3_600_000) {
      const hour = new Date(at).getHours();
      ticks.push({
        at,
        leftPercent: ((at - day.bounds.start) / span) * 100,
        label: hour % 4 !== 0 ? '' : hour === 0 ? '12A' : hour === 12 ? '12P' : hour > 12 ? `${hour - 12}P` : `${hour}A`,
      });
    }
    return ticks;
  }, [timelineDays]);

  const formatAmount = (amount: number) => formatAmountCell(amount, currencySymbol);
  // The headline figures, where a zero is a zero rather than a dash — and
  // grouped the same way the PDF and the summary table group it.
  const formatTotal = (amount: number) => formatCurrency(amount, currencySymbol);

  // Export CSV
  const handleExportCSV = () => {
    const defaultFilename = `time-report-${scopeSlug}-${safeFormatDate(dateRange.start, 'yyyy-MM-dd', 'custom-period')}`;
    triggerDownload(
      () => new Blob([buildSummaryCSV(reportModel, settings)], { type: 'text/csv;charset=utf-8;' }),
      defaultFilename,
      'csv'
    );
  };

  // Export ICS
  const handleExportICS = () => {
    const events = buildCalendarEvents(filteredEntries, timecodeMap);
    if (events.length === 0) return;

    const defaultFilename = `time-entries-${scopeSlug}-${safeFormatDate(dateRange.start, 'yyyy-MM-dd', 'custom-period')}`;
    triggerDownload(
      () => new Promise<Blob>((resolve, reject) => {
        createEvents(events, (error, value) => {
          if (error) {
            console.error('Error generating ICS file', error);
            reject(error);
            return;
          }
          resolve(new Blob([value], { type: 'text/calendar;charset=utf-8;' }));
        });
      }),
      defaultFilename,
      'ics'
    );
  };

  // Export Detailed Raw CSV. Assembled in `reportDocument` alongside the PDF's
  // itemised table, from the same rows in the same order, so the spreadsheet a
  // client reconciles the invoice against cannot list different work.
  const downloadDetailedRawCSV = () => {
    const defaultFilename = `time-entries-${scopeSlug}-${safeFormatDate(dateRange.start, 'yyyy-MM-dd', 'custom-period')}`;
    triggerDownload(
      () => new Blob(
        [buildDetailedRawCSV(filteredEntries, billableLines, timecodeMap, groupMap)],
        { type: 'text/csv;charset=utf-8;' },
      ),
      defaultFilename,
      'csv'
    );
  };

  // Generate PDF Report
  const generatePdfBlob = async (): Promise<Blob> => {
    setIsGeneratingPdf(true);
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      const preparedFor = preparedForOverride || scopeLabel;
      const defaultPreparedBy = [settings?.preparerName, settings?.preparerCompany].filter(Boolean).join(' — ');

      // Layout lives in `reportPdf`, which needs no component tree — so every
      // fixture in the document matrix can be rendered and looked at, through
      // the same function that produces the file a client receives.
      return await renderReportPdf({
        model: reportModel,
        entries: filteredEntries,
        lines: billableLines,
        timecodeMap,
        settings,
        meta: buildReportMeta(reportModel, {
          preparedFor,
          preparedBy: preparedByOverride || defaultPreparedBy,
          periodText: `${safeFormatDate(dateRange.start, 'MMM d, yyyy')} – ${safeFormatDate(dateRange.end, 'MMM d, yyyy')}`,
          generatedText: format(new Date(), "MMM d, yyyy 'at' HH:mm"),
          customFields: reportFields,
          settings,
        }),
        footerTextOverride,
      });
    } catch (err) {
      console.error('PDF generation failed:', err);
      addToast('Failed to generate PDF. Please try again.', 'error');
      throw err;
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePrint = () => {
    const defaultFilename = `time-report-${scopeSlug}-${safeFormatDate(dateRange.start, 'yyyy-MM-dd', 'custom-period')}`;
    triggerDownload(
      generatePdfBlob,
      defaultFilename,
      'pdf'
    );
  };

  const formatDuration = formatDurationShort;

  const handleSortClick = (field: SortField) => {
    if (tcSortField === field) {
      setTcSortAsc(!tcSortAsc);
    } else {
      setTcSortField(field);
      setTcSortAsc(false);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-graphite rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 overflow-hidden print:shadow-none print:border-none">
      {/* Global Filter & Header Bar */}
      <div className="p-6 border-b border-graphite/20 dark:border-white/20 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <h2 className="text-xl font-bold text-graphite dark:text-stone">Analysis & Reports</h2>
          {scopeLabel !== 'All' && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-stone dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-graphite/10 dark:border-white/10">
              Scope: {scopeLabel}
            </span>
          )}
        </div>

        {/* Date Presets */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(['week', 'last4Weeks', 'custom'] as DatePreset[]).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
                preset === p ? 'bg-graphite text-stone dark:bg-stone dark:text-ink' : 'bg-stone text-graphite hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {p === 'week' ? 'This Week' : p === 'last4Weeks' ? 'Last 4 Weeks' : 'Custom'}
            </button>
          ))}
        </div>

        {/* Custom Date Inputs */}
        {preset === 'custom' && (
          <div className="flex flex-col gap-1 mb-4">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone"
              />
              <span className="text-gray-600 dark:text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone"
              />
            </div>
            {isCustomInvalid && (
              <p className="text-xs text-rust dark:text-orange-300">
                Invalid custom date range. Showing current week as fallback.
              </p>
            )}
          </div>
        )}

        {/* Scope Dropdowns & Compare Checkbox */}
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            <option value="all">All Clients / Groups</option>
            {groups.filter(g => !g.archived).map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          <select
            value={selectedTimecodeId}
            onChange={(e) => setSelectedTimecodeId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            <option value="all">All Timecodes</option>
            {timecodeOptions.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          {(selectedGroupId !== 'all' || selectedTimecodeId !== 'all') && (
            <button
              onClick={() => { setSelectedGroupId('all'); setSelectedTimecodeId('all'); }}
              className="text-sm text-gray-600 hover:text-signal-dim dark:hover:text-signal dark:text-gray-400 transition-colors"
            >
              Clear filter
            </button>
          )}

          <label className="flex items-center gap-2 text-sm text-graphite dark:text-stone ml-auto cursor-pointer select-none">
            <input
              type="checkbox"
              checked={comparePrevious}
              onChange={(e) => setComparePrevious(e.target.checked)}
              className="rounded border-graphite/20 dark:border-white/20 text-signal focus:ring-signal"
            />
            <span>Compare to previous period</span>
          </label>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-graphite/20 dark:border-white/20 mt-6 -mb-6 overflow-x-auto" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'export'}
            onClick={() => setActiveTab('export')}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'export'
                ? 'border-signal text-graphite dark:text-stone'
                : 'border-transparent text-gray-500 hover:text-graphite dark:text-gray-400 dark:hover:text-stone'
            }`}
          >
            Export
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-signal text-graphite dark:text-stone'
                : 'border-transparent text-gray-500 hover:text-graphite dark:text-gray-400 dark:hover:text-stone'
            }`}
          >
            Overview
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'estimates'}
            onClick={() => setActiveTab('estimates')}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'estimates'
                ? 'border-signal text-graphite dark:text-stone'
                : 'border-transparent text-gray-500 hover:text-graphite dark:text-gray-400 dark:hover:text-stone'
            }`}
          >
            <span>Estimates</span>
            {estimateDeepData && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-stone dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                {estimateDeepData.count}
              </span>
            )}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'timeline'}
            onClick={() => setActiveTab('timeline')}
            className={`px-5 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'timeline'
                ? 'border-signal text-graphite dark:text-stone'
                : 'border-transparent text-gray-500 hover:text-graphite dark:text-gray-400 dark:hover:text-stone'
            }`}
          >
            Timeline
          </button>
        </div>
      </div>

      {/* Main Tab Contents */}
      <div className="p-6">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Headline Stats Tier */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Total Tracked Time */}
              <div className="bg-stone/50 dark:bg-graphite rounded-panel p-6 border border-graphite/20 dark:border-white/20 shadow-sm flex flex-col justify-between transition-colors relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-signal-dim dark:text-signal text-xs font-sans font-semibold uppercase tracking-wider">
                    TOTAL TRACKED TIME
                  </span>
                  {comparePrevious && prevStats && (
                    <span className={`flex items-center text-xs font-semibold font-mono tabular ${prevStats.diffSec >= 0 ? 'text-verdigris dark:text-emerald-400' : 'text-rust dark:text-orange-300'}`}>
                      {prevStats.diffSec >= 0 ? <TrendingUp size={14} className="mr-1" /> : <TrendingDown size={14} className="mr-1" />}
                      {prevStats.diffSec >= 0 ? '+' : ''}{formatDuration(prevStats.diffSec)} vs last period
                    </span>
                  )}
                </div>
                <div className="text-4xl font-mono tabular font-medium text-graphite dark:text-stone">
                  {formatDuration(totalSeconds)}
                </div>
                {roundingDelta && (
                  <div className="mt-2 text-xs font-mono tabular text-signal-dim dark:text-signal">
                    {roundingDelta}
                  </div>
                )}
              </div>

              {/* Earnings */}
              <div className="bg-stone/50 dark:bg-graphite rounded-panel p-6 border border-graphite/20 dark:border-white/20 shadow-sm flex flex-col justify-between transition-colors relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-verdigris dark:text-emerald-400 text-xs font-sans font-semibold uppercase tracking-wider">
                    {taxBreakdown ? 'EARNINGS' : 'TOTAL EARNINGS'}
                  </span>
                  {comparePrevious && prevStats && (
                    <span className={`flex items-center text-xs font-semibold font-mono tabular ${prevStats.diffEarnings >= 0 ? 'text-verdigris dark:text-emerald-400' : 'text-rust dark:text-orange-300'}`}>
                      {prevStats.diffEarnings >= 0 ? <TrendingUp size={14} className="mr-1" /> : <TrendingDown size={14} className="mr-1" />}
                      {prevStats.diffEarnings >= 0 ? '+' : ''}{prevStats.pctEarnings}% vs last period
                    </span>
                  )}
                </div>

                {taxBreakdown ? (
                  <div className="space-y-1 mt-1">
                    <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                      <span>Subtotal</span>
                      <span className="font-mono tabular">{formatTotal(taxBreakdown.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                      <span>{settings?.taxLabel || 'Tax'} ({settings?.taxRate}%)</span>
                      <span className="font-mono tabular">{formatTotal(taxBreakdown.tax)}</span>
                    </div>
                    <div className="flex justify-between text-2xl font-mono tabular font-medium text-graphite dark:text-stone pt-1 border-t border-graphite/20 dark:border-white/20">
                      <span>Total</span>
                      <span>{formatTotal(taxBreakdown.total)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-4xl font-mono tabular font-medium text-graphite dark:text-stone">
                    {formatTotal(totalEarnings)}
                  </div>
                )}
              </div>
            </div>

            {/* Insight Chips Row */}
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 items-center">
                {/* Gaps Chip */}
                {gaps.length > 0 ? (
                  <button
                    onClick={() => setExpandedChip(expandedChip === 'gaps' ? null : 'gaps')}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      expandedChip === 'gaps'
                        ? 'bg-signal/20 border-signal text-graphite dark:text-stone'
                        : 'bg-stone dark:bg-gray-800/60 border-graphite/20 dark:border-white/20 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <AlertTriangle size={14} className="text-signal-dim dark:text-signal" />
                    <span>{gaps.length} gap{gaps.length > 1 ? 's' : ''} &gt; 15min</span>
                  </button>
                ) : null}

                {/* Overlaps Chip */}
                {overlaps.length > 0 ? (
                  <button
                    onClick={() => setExpandedChip(expandedChip === 'overlaps' ? null : 'overlaps')}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      expandedChip === 'overlaps'
                        ? 'bg-rust/20 border-rust text-rust dark:text-orange-300'
                        : 'bg-stone dark:bg-gray-800/60 border-rust/30 text-rust dark:text-orange-300 hover:bg-rust/10'
                    }`}
                  >
                    <AlertTriangle size={14} className="text-rust dark:text-orange-300" />
                    <span>{overlaps.length} overlap{overlaps.length > 1 ? 's' : ''}</span>
                  </button>
                ) : null}

                {/* Tax Nudge Chip */}
                {totalEarnings > 0 && !settings?.taxEnabled && !settings?.taxPromptDismissed ? (
                  <button
                    onClick={() => setExpandedChip(expandedChip === 'tax' ? null : 'tax')}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      expandedChip === 'tax'
                        ? 'bg-signal/20 border-signal text-graphite dark:text-stone'
                        : 'bg-stone dark:bg-gray-800/60 border-graphite/20 dark:border-white/20 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Info size={14} className="text-signal-dim dark:text-signal" />
                    <span>Add tax rate</span>
                  </button>
                ) : null}

                {/* Clean status chip */}
                {gaps.length === 0 && overlaps.length === 0 && (settings?.taxEnabled || settings?.taxPromptDismissed || totalEarnings === 0) && (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full bg-verdigris/10 border border-verdigris/30 text-verdigris dark:text-emerald-400">
                    <CheckCircle2 size={14} />
                    <span>No issues found</span>
                  </div>
                )}
              </div>

              {/* Expanded Chip Panels */}
              {expandedChip === 'gaps' && gaps.length > 0 && (
                <div className="p-4 bg-stone/50 dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-panel text-sm animate-in fade-in">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold text-graphite dark:text-stone">Untracked Time Gaps</h4>
                    <button onClick={() => setExpandedChip(null)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {gaps.map((g, idx) => (
                      <div key={idx} className="flex justify-between text-xs py-1 border-b border-graphite/10 dark:border-white/10 text-gray-600 dark:text-gray-400">
                        <span>{format(g.start, 'MMM d, h:mm a')} – {format(g.end, 'h:mm a')}</span>
                        <span className="font-mono">{g.durationMins} mins</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {expandedChip === 'overlaps' && overlaps.length > 0 && (
                <div className="p-4 bg-stone/50 dark:bg-graphite border border-rust/30 rounded-panel text-sm animate-in fade-in">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold text-rust dark:text-orange-300">Overlapping Time Entries</h4>
                    <button onClick={() => setExpandedChip(null)} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {overlaps.map((pair, idx) => (
                      <div key={idx} className="text-xs p-2 bg-stone dark:bg-gray-800/50 rounded border border-rust/20">
                        <div className="font-medium text-graphite dark:text-stone">
                          Pair {idx + 1}:
                        </div>
                        <div className="text-gray-600 dark:text-gray-400">
                          1: {timecodeMap.get(pair.e1.timecodeId)?.name} ({format(parseISO(pair.e1.startTime), 'MMM d, h:mm a')} – {pair.e1.endTime ? format(parseISO(pair.e1.endTime), 'h:mm a') : 'Now'})
                        </div>
                        <div className="text-gray-600 dark:text-gray-400">
                          2: {timecodeMap.get(pair.e2.timecodeId)?.name} ({format(parseISO(pair.e2.startTime), 'MMM d, h:mm a')} – {pair.e2.endTime ? format(parseISO(pair.e2.endTime), 'h:mm a') : 'Now'})
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {expandedChip === 'tax' && (
                <div className="p-4 bg-stone/50 dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-panel text-sm flex items-center justify-between gap-3 animate-in fade-in">
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Add a tax rate in Settings to show before/after-tax totals on your earnings and exports.
                  </p>
                  <button onClick={() => updateSettings({ taxPromptDismissed: true })} className="text-xs font-semibold px-3 py-1 bg-graphite text-stone dark:bg-stone dark:text-ink rounded">
                    Dismiss
                  </button>
                </div>
              )}
            </div>

            {/* Breakdown Section: Controls + Chart + Table */}
            {timecodeData.length > 0 ? (
              <div className="bg-stone/30 dark:bg-graphite/50 p-6 rounded-panel border border-graphite/20 dark:border-white/20 space-y-6">
                {/* Segmented Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-graphite/20 dark:border-white/20 pb-4">
                  {/* By Timecode vs By Group */}
                  <div className="flex bg-stone dark:bg-gray-800 p-1 rounded-panel border border-graphite/10 dark:border-white/10 self-start">
                    <button
                      onClick={() => setBreakdownType('timecode')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                        breakdownType === 'timecode'
                          ? 'bg-white dark:bg-graphite text-graphite dark:text-stone shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'
                      }`}
                    >
                      By Timecode
                    </button>
                    <button
                      onClick={() => setBreakdownType('group')}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                        breakdownType === 'group'
                          ? 'bg-white dark:bg-graphite text-graphite dark:text-stone shadow-sm'
                          : 'text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'
                      }`}
                    >
                      By Group
                    </button>
                  </div>

                  {/* Chart Type Switcher */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Chart:</span>
                    <div className="flex bg-stone dark:bg-gray-800 p-1 rounded-panel border border-graphite/10 dark:border-white/10">
                      <button
                        onClick={() => setChartType('bar')}
                        className={`p-1.5 rounded-md transition-colors ${
                          chartType === 'bar'
                            ? 'bg-white dark:bg-graphite text-graphite dark:text-stone shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'
                        }`}
                        title="Bar Chart"
                      >
                        <BarChart2 size={16} />
                      </button>
                      <button
                        onClick={() => setChartType('pie')}
                        className={`p-1.5 rounded-md transition-colors ${
                          chartType === 'pie'
                            ? 'bg-white dark:bg-graphite text-graphite dark:text-stone shadow-sm'
                            : 'text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'
                        }`}
                        title="Donut Chart"
                      >
                        <PieIcon size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Grid layout: Chart & Table */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                  {/* Chart Area */}
                  <div className="h-72 w-full">
                    <h3 className="text-sm font-semibold text-graphite dark:text-stone mb-2 text-center">
                      Time {breakdownType === 'timecode' ? 'by Timecode' : 'by Group'}
                    </h3>
                    <ResponsiveContainer width="100%" height="100%">
                      {chartType === 'bar' ? (
                        <BarChart data={breakdownType === 'timecode' ? timecodeData : groupData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                          <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                          <YAxis tick={{ fontSize: 11, fontFamily: 'monospace' }} label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
                          <Tooltip formatter={(value: any) => [`${value} hrs`, 'Duration']} />
                          <Bar dataKey="durationHours" radius={[4, 4, 0, 0]}>
                            {(breakdownType === 'timecode' ? timecodeData : groupData).map((entry) => (
                              <Cell
                                key={entry.id}
                                fill={entry.color}
                                opacity={hoveredId == null || hoveredId === entry.id ? 1 : 0.3}
                                onMouseEnter={() => setHoveredId(entry.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className="transition-opacity cursor-pointer"
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      ) : (
                        <PieChart>
                          <Pie
                            data={breakdownType === 'timecode' ? timecodeData : groupData}
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="durationHours"
                          >
                            {(breakdownType === 'timecode' ? timecodeData : groupData).map((entry) => (
                              <Cell
                                key={entry.id}
                                fill={entry.color}
                                opacity={hoveredId == null || hoveredId === entry.id ? 1 : 0.3}
                                onMouseEnter={() => setHoveredId(entry.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className="transition-opacity cursor-pointer"
                              />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: any) => [`${value} hrs`, 'Duration']} />
                          <Legend verticalAlign="bottom" height={36} />
                        </PieChart>
                      )}
                    </ResponsiveContainer>
                  </div>

                  {/* Linked Table */}
                  <div>
                    <h3 className="text-sm font-semibold text-graphite dark:text-stone mb-3">Breakdown Table</h3>
                    <div className="overflow-hidden border border-graphite/20 dark:border-white/20 rounded-panel shadow-sm bg-white dark:bg-graphite">
                      <table className="min-w-full divide-y divide-graphite/20 dark:divide-white/20 text-sm">
                        <thead className="bg-stone dark:bg-graphite">
                          <tr>
                            <th className="px-4 py-2.5 text-left font-semibold text-gray-600 dark:text-gray-400 font-sans text-xs uppercase tracking-wide">
                              {breakdownType === 'timecode' ? 'Timecode' : 'Group'}
                            </th>
                            <th className="px-4 py-2.5 text-right font-semibold text-gray-600 dark:text-gray-400 font-sans text-xs uppercase tracking-wide">Hours</th>
                            {showFeesColumn && breakdownType === 'timecode' && (
                              <th className="px-4 py-2.5 text-right font-semibold text-gray-600 dark:text-gray-400 font-sans text-xs uppercase tracking-wide">Fees</th>
                            )}
                            {showEarningsColumn && breakdownType === 'timecode' && (
                              <th className="px-4 py-2.5 text-right font-semibold text-gray-600 dark:text-gray-400 font-sans text-xs uppercase tracking-wide">Earnings</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-graphite/20 dark:divide-white/20">
                          {(breakdownType === 'timecode' ? timecodeData : groupData).map((row) => {
                            const isHovered = hoveredId === row.id;
                            return (
                              <tr
                                key={row.id}
                                onMouseEnter={() => setHoveredId(row.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                className={`transition-colors cursor-pointer ${
                                  isHovered ? 'bg-signal/15 dark:bg-signal/20' : 'hover:bg-signal/5'
                                }`}
                              >
                                <td className="px-4 py-2 flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }}></div>
                                  <span className="font-medium text-graphite dark:text-stone">{row.name}</span>
                                </td>
                                <td className="px-4 py-2 text-right text-graphite dark:text-stone font-mono tabular">{row.durationHours.toFixed(2)}</td>
                                {showFeesColumn && breakdownType === 'timecode' && (
                                  <td className="px-4 py-2 text-right text-graphite dark:text-stone font-mono tabular">
                                    {'fees' in row && typeof (row as { fees?: number }).fees === 'number'
                                      ? formatAmount((row as { fees: number }).fees)
                                      : '-'}
                                  </td>
                                )}
                                {showEarningsColumn && breakdownType === 'timecode' && (
                                  <td className="px-4 py-2 text-right text-graphite dark:text-stone font-mono tabular">
                                    {'earnings' in row && typeof (row as { earnings?: number }).earnings === 'number'
                                      ? formatAmount((row as { earnings: number }).earnings)
                                      : '-'}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-600 dark:text-gray-400">
                No time tracked for this period.
              </div>
            )}
          </div>
        )}

        {/* ESTIMATES TAB */}
        {activeTab === 'estimates' && (
          <div className="space-y-8 animate-in fade-in">
            {estimateDeepData ? (
              <>
                {/* 4 Headline Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-stone/50 dark:bg-graphite rounded-panel p-4 border border-graphite/20 dark:border-white/20 shadow-sm">
                    <span className="block text-3xl font-mono tabular font-medium text-graphite dark:text-stone">
                      {estimateDeepData.count}
                    </span>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                      tasks estimated
                    </span>
                  </div>

                  <div className="bg-stone/50 dark:bg-graphite rounded-panel p-4 border border-graphite/20 dark:border-white/20 shadow-sm">
                    <span className="block text-3xl font-mono tabular font-medium text-graphite dark:text-stone">
                      {estimateDeepData.hitRatePct}%
                    </span>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                      hit rate (on/under)
                    </span>
                  </div>

                  <div className="bg-stone/50 dark:bg-graphite rounded-panel p-4 border border-graphite/20 dark:border-white/20 shadow-sm">
                    <span className={`block text-3xl font-mono tabular font-medium ${
                      estimateDeepData.biasPct > 0 ? 'text-rust dark:text-orange-300' : 'text-verdigris dark:text-emerald-400'
                    }`}>
                      {estimateDeepData.biasPct > 0 ? '+' : ''}{estimateDeepData.biasPct}%
                    </span>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                      bias (net direction)
                    </span>
                  </div>

                  <div className="bg-stone/50 dark:bg-graphite rounded-panel p-4 border border-graphite/20 dark:border-white/20 shadow-sm">
                    <span className="block text-3xl font-mono tabular font-medium text-graphite dark:text-stone">
                      ±{estimateDeepData.typicalMissPct}%
                    </span>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
                      typical miss (magnitude)
                    </span>
                  </div>
                </div>

                {estimateDeepData.clippedCount > 0 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 -mt-4">
                    {estimateDeepData.clippedCount === 1
                      ? '1 task started before this range or ran past it. It is compared'
                      : `${estimateDeepData.clippedCount} tasks started before this range or ran past it. They are compared`}
                    {' '}against its whole duration, not just the part inside the range, so these figures cover more
                    time than the report bills.
                  </p>
                )}

                {/* Distribution Histogram Chart */}
                <div className="bg-stone/30 dark:bg-graphite/50 p-6 rounded-panel border border-graphite/20 dark:border-white/20">
                  <h3 className="text-sm font-semibold text-graphite dark:text-stone mb-2">
                    Estimate Variance Distribution
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
                    Histogram showing entry count by percentage deviation. Overruns on the right (rust), underruns on the left (verdigris).
                  </p>
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={estimateDeepData.histogram} margin={{ top: 20, right: 20, left: -20, bottom: 5 }}>
                        <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                        <YAxis tick={{ fontSize: 11, fontFamily: 'monospace' }} allowDecimals={false} />
                        <Tooltip formatter={(val: any) => [`${val} tasks`, 'Count']} />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {estimateDeepData.histogram.map((entry, index) => (
                            <Cell key={`hist-${index}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Per-Timecode Breakdown Table */}
                <div className="bg-stone/30 dark:bg-graphite/50 p-6 rounded-panel border border-graphite/20 dark:border-white/20">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                    <h3 className="text-sm font-semibold text-graphite dark:text-stone">
                      Per-Timecode Estimate Performance
                    </h3>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Click headers to sort
                    </span>
                  </div>

                  <div className="overflow-x-auto border border-graphite/20 dark:border-white/20 rounded-panel bg-white dark:bg-graphite">
                    <table className="min-w-full divide-y divide-graphite/20 dark:divide-white/20 text-sm">
                      <thead className="bg-stone dark:bg-graphite select-none">
                        <tr>
                          <th onClick={() => handleSortClick('name')} className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide cursor-pointer hover:text-graphite dark:hover:text-stone">
                            Timecode {tcSortField === 'name' ? (tcSortAsc ? '▲' : '▼') : ''}
                          </th>
                          <th onClick={() => handleSortClick('count')} className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide cursor-pointer hover:text-graphite dark:hover:text-stone">
                            Count {tcSortField === 'count' ? (tcSortAsc ? '▲' : '▼') : ''}
                          </th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">
                            Avg Est
                          </th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide">
                            Avg Act
                          </th>
                          <th onClick={() => handleSortClick('bias')} className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide cursor-pointer hover:text-graphite dark:hover:text-stone">
                            Bias {tcSortField === 'bias' ? (tcSortAsc ? '▲' : '▼') : ''}
                          </th>
                          <th onClick={() => handleSortClick('typicalMiss')} className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide cursor-pointer hover:text-graphite dark:hover:text-stone">
                            Typical Miss {tcSortField === 'typicalMiss' ? (tcSortAsc ? '▲' : '▼') : ''}
                          </th>
                          <th onClick={() => handleSortClick('hitRate')} className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase tracking-wide cursor-pointer hover:text-graphite dark:hover:text-stone">
                            Hit Rate {tcSortField === 'hitRate' ? (tcSortAsc ? '▲' : '▼') : ''}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-graphite/20 dark:divide-white/20">
                        {sortedPerTimecodeTable.map(tc => (
                          <tr key={tc.id} className="hover:bg-signal/5">
                            <td className="px-4 py-2.5 font-medium text-graphite dark:text-stone">{tc.name}</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular">{tc.count}</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular">{tc.avgExpMins}m</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular">{tc.avgActMins}m</td>
                            <td className={`px-4 py-2.5 text-right font-mono tabular font-semibold ${
                              tc.bias > 0 ? 'text-rust dark:text-orange-300' : 'text-verdigris dark:text-emerald-400'
                            }`}>
                              {tc.bias > 0 ? '+' : ''}{tc.bias}%
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular">±{tc.typicalMiss}%</td>
                            <td className="px-4 py-2.5 text-right font-mono tabular">{tc.hitRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Trend Over Time */}
                {estimatesTrend.length > 0 && (
                  <div className="bg-stone/30 dark:bg-graphite/50 p-6 rounded-panel border border-graphite/20 dark:border-white/20">
                    <h3 className="text-sm font-semibold text-graphite dark:text-stone mb-2">
                      Estimating Trend Over Time (Trailing Weeks)
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
                      Tracking Bias % (direction) and Hit Rate % over the past 8 weeks.
                    </p>
                    <div className="h-60 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={estimatesTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                          <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                          <YAxis tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                          <Tooltip />
                          <Legend verticalAlign="top" height={36} />
                          <Line type="monotone" dataKey="bias" name="Bias %" stroke="#B85C3E" strokeWidth={2} dot={{ r: 4 }} />
                          <Line type="monotone" dataKey="hitRate" name="Hit Rate %" stroke="#3E7368" strokeWidth={2} dot={{ r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Worst Offenders List */}
                {estimateDeepData.worstOffenders.length > 0 && (
                  <div className="bg-stone/30 dark:bg-graphite/50 p-6 rounded-panel border border-graphite/20 dark:border-white/20">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-graphite dark:text-stone">
                          Top Overrun Entries ("Worst Offenders")
                        </h3>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          Specific entries with the largest variance in this period.
                        </p>
                      </div>

                      <div className="flex bg-stone dark:bg-gray-800 p-1 rounded-panel border border-graphite/10 dark:border-white/10 self-start">
                        <button
                          onClick={() => setWorstOffenderSort('pct')}
                          className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                            worstOffenderSort === 'pct'
                              ? 'bg-white dark:bg-graphite text-graphite dark:text-stone shadow-sm'
                              : 'text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'
                          }`}
                        >
                          Sort by % Over
                        </button>
                        <button
                          onClick={() => setWorstOffenderSort('mins')}
                          className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                            worstOffenderSort === 'mins'
                              ? 'bg-white dark:bg-graphite text-graphite dark:text-stone shadow-sm'
                              : 'text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'
                          }`}
                        >
                          Sort by Mins Over
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {estimateDeepData.worstOffenders.map(({ entry, variancePct, diffSec }) => {
                        const tc = timecodeMap.get(entry.timecodeId);
                        const expMins = entry.expectedDurationMinutes!;
                        const actualSec = workedSecondsFor(billableLines, entry.id);
                        const actMins = Math.round(actualSec / 60);
                        const diffMins = Math.round(diffSec / 60);

                        return (
                          <div
                            key={entry.id}
                            className="p-3 bg-white dark:bg-graphite rounded-panel border border-graphite/20 dark:border-white/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-signal/50 transition-colors"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-graphite dark:text-stone">{tc?.name ?? 'Unknown'}</span>
                                {entry.note && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                                    — "{entry.note}"
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                Est: {expMins}m → Actual: {actMins}m (+{diffMins}m over)
                              </div>
                            </div>

                            <div className="flex items-center gap-4 shrink-0">
                              <span className="font-mono font-semibold text-sm text-rust dark:text-orange-300">
                                +{Math.round(variancePct)}%
                              </span>
                              <button
                                onClick={() => setEditingEntry(entry)}
                                className="flex items-center gap-1 text-xs font-medium text-signal-dim dark:text-signal hover:underline"
                              >
                                <span>Open entry</span>
                                <ExternalLink size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12 text-gray-600 dark:text-gray-400">
                No entries with estimates found in the selected period.
              </div>
            )}
          </div>
        )}

        {/* TIMELINE TAB */}
        {activeTab === 'timeline' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Resolution 1: Single Day 24h Bar */}
            {timelineDays.length === 1 && (
              <div className="bg-stone/30 dark:bg-graphite/50 p-6 rounded-panel border border-graphite/20 dark:border-white/20">
                <h3 className="text-base font-semibold text-graphite dark:text-stone mb-1 text-center">
                  Daily Timeline — {timelineDays[0].dateStr}
                </h3>
                {/* The heatmap this bar is replaced by at two days and up plots
                    billable time. Saying which one this is, and what it comes to
                    against the billed figure, is what stops the same day reading
                    as two different amounts of work depending on the range. */}
                <p className="text-xs text-center text-gray-500 dark:text-gray-400 mb-4">
                  Blocks are time on the clock, pauses removed — {formatDuration(singleDayWorkedSeconds)} worked,
                  {' '}{formatDuration(timelineDays[0].seconds)} billed.
                </p>
                <div className="relative h-14 bg-stone dark:bg-graphite rounded-panel shadow-inner overflow-hidden border border-graphite/20 dark:border-white/20">
                  {singleDayTicks.map(tick => (
                    <div
                      key={tick.at}
                      className="absolute top-0 bottom-0 border-l border-graphite/20 dark:border-white/20"
                      style={{ left: `${tick.leftPercent}%` }}
                    >
                      <span className="absolute top-full mt-1 -ml-3 text-[10px] font-mono tabular text-gray-500 dark:text-gray-400">
                        {tick.label}
                      </span>
                    </div>
                  ))}

                  {singleDayBlocks.map(block => (
                    <div
                      key={block.key}
                      className="absolute top-0 bottom-0 opacity-80 hover:opacity-100 transition-opacity"
                      style={{ left: `${block.leftPercent}%`, width: `${block.widthPercent}%`, backgroundColor: block.color }}
                      title={block.title}
                    ></div>
                  ))}
                </div>
                <div className="h-6"></div>
              </div>
            )}

            {/* Resolution 2: Calendar Heatmap Grid (2 to 42 days) */}
            {timelineDays.length > 1 && timelineDays.length <= 42 && (
              <div className="bg-stone/30 dark:bg-graphite/50 p-6 rounded-panel border border-graphite/20 dark:border-white/20">
                <h3 className="text-base font-semibold text-graphite dark:text-stone mb-2">
                  Daily Activity Heatmap
                </h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-6">
                  Hours tracked per day in the selected period. Hover over a day for details.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
                  {timelineDays.map((d) => {
                    const maxHours = 8;
                    const intensity = Math.min(1, d.hours / maxHours);
                    let bgClass = 'bg-stone dark:bg-gray-800 text-gray-500';

                    if (d.hours > 0) {
                      if (intensity < 0.25) bgClass = 'bg-signal/20 text-graphite dark:text-stone';
                      else if (intensity < 0.5) bgClass = 'bg-signal/40 text-graphite dark:text-stone';
                      else if (intensity < 0.75) bgClass = 'bg-signal/70 text-ink dark:text-stone';
                      else bgClass = 'bg-signal text-ink font-bold';
                    }

                    return (
                      <div
                        key={d.dateStr}
                        className={`p-3 rounded-panel border border-graphite/10 dark:border-white/10 flex flex-col justify-between h-20 transition-transform hover:scale-105 ${bgClass}`}
                        title={`${d.dateStr}: ${d.hours} hours logged`}
                      >
                        <span className="text-xs font-semibold">{format(d.date, 'MMM d')}</span>
                        <span className="text-lg font-mono tabular self-end">{d.hours > 0 ? `${d.hours}h` : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Resolution 3: Stacked Weekly Bar Chart (> 42 days) */}
            {timelineDays.length > 42 && (
              <div className="bg-stone/30 dark:bg-graphite/50 p-6 rounded-panel border border-graphite/20 dark:border-white/20">
                <h3 className="text-base font-semibold text-graphite dark:text-stone mb-2">
                  Weekly Tracked Hours
                </h3>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-6">
                  Aggregate tracked time per week across the extended date range.
                </p>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(() => {
                        const weeklyMap = new Map<string, number>();
                        timelineDays.forEach(d => {
                          const wLabel = format(startOfWeek(d.date, { weekStartsOn: 1 }), 'MMM d');
                          const curr = weeklyMap.get(wLabel) || 0;
                          weeklyMap.set(wLabel, curr + d.hours);
                        });
                        return Array.from(weeklyMap.entries()).map(([label, hours]) => ({
                          label,
                          hours: Number(hours.toFixed(1)),
                        }));
                      })()}
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <XAxis dataKey="label" tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                      <YAxis tick={{ fontSize: 11, fontFamily: 'monospace' }} />
                      <Tooltip formatter={(val: any) => [`${val} hrs`, 'Total Time']} />
                      <Bar dataKey="hours" fill="#10161C" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}

        {/* EXPORT TAB */}
        {activeTab === 'export' && (
          <div className="space-y-8 animate-in fade-in">
            {/* Export Preview Strip */}
            <div className="p-4 bg-stone/50 dark:bg-graphite rounded-panel border border-graphite/20 dark:border-white/20 flex flex-wrap items-center justify-between gap-4 text-sm">
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block uppercase tracking-wide">Export Scope</span>
                <span className="font-semibold text-graphite dark:text-stone">{scopeLabel}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block uppercase tracking-wide">Period</span>
                <span className="font-semibold text-graphite dark:text-stone">
                  {safeFormatDate(dateRange.start, 'MMM d, yyyy')} – {safeFormatDate(dateRange.end, 'MMM d, yyyy')}
                </span>
              </div>
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block uppercase tracking-wide">Total Hours</span>
                <span className="font-mono font-semibold text-graphite dark:text-stone">{formatDuration(totalSeconds)}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400 block uppercase tracking-wide">Total Earnings</span>
                <span className="font-mono font-semibold text-graphite dark:text-stone">{formatTotal(totalEarnings)}</span>
              </div>
            </div>

            {/* Report Metadata Configuration */}
            <div className="space-y-4 max-w-xl">
              <div className="p-6 bg-stone/30 dark:bg-graphite/50 rounded-panel border border-graphite/20 dark:border-white/20 space-y-4">
                <h3 className="text-sm font-semibold text-graphite dark:text-stone">
                  PDF Report Header Details
                </h3>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Prepared for</label>
                    <input
                      type="text"
                      value={preparedForOverride}
                      onChange={(e) => setPreparedForOverride(e.target.value)}
                      placeholder={scopeLabel}
                      className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400 w-24 shrink-0">Prepared by</label>
                    <input
                      type="text"
                      value={preparedByOverride}
                      onChange={(e) => setPreparedByOverride(e.target.value)}
                      placeholder={[settings?.preparerName, settings?.preparerCompany].filter(Boolean).join(' — ') || 'not set in Settings'}
                      className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    />
                  </div>

                  {reportFields.map((f, i) => (
                    <div key={f.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={f.label}
                        onChange={(e) => updateReportField(i, { label: e.target.value })}
                        placeholder="Label"
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone"
                      />
                      <input
                        type="text"
                        value={f.value}
                        onChange={(e) => updateReportField(i, { value: e.target.value })}
                        placeholder="Value"
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone"
                      />
                      <button
                        onClick={() => setReportFields(prev => prev.filter((_, j) => j !== i))}
                        aria-label="Remove field"
                        className="text-gray-500 hover:text-rust p-1 shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={() => setReportFields(prev => [...prev, { id: crypto.randomUUID(), label: '', value: '' }])}
                    className="flex items-center gap-1 text-xs text-signal-dim dark:text-signal hover:underline font-medium"
                  >
                    <Plus size={14} />
                    <span>Add custom metadata field</span>
                  </button>
                </div>
              </div>

              <div className="p-6 bg-signal/5 dark:bg-signal/10 border border-signal/20 rounded-panel space-y-3">
                <h3 className="text-sm font-semibold text-graphite dark:text-stone">
                  PDF Report Footer
                </h3>
                <textarea
                  value={footerTextOverride}
                  onChange={(e) => setFooterTextOverride(e.target.value)}
                  placeholder={settings?.reportFooterText || 'e.g. payment/bank details, terms'}
                  rows={3}
                  className="w-full px-3 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded-md bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal resize-y"
                />
              </div>
            </div>

            {/* Export Buttons Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <button
                onClick={handleExportCSV}
                className="flex flex-col items-center justify-center p-5 bg-white dark:bg-graphite hover:bg-stone dark:hover:bg-gray-800/60 rounded-panel border border-graphite/20 dark:border-white/20 transition-all text-center gap-2 group"
              >
                <Download size={24} className="text-gray-600 dark:text-gray-300 group-hover:text-signal-dim dark:group-hover:text-signal transition-colors" />
                <div>
                  <span className="block font-semibold text-sm text-graphite dark:text-stone">Summary CSV</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Timecode & earnings summary</span>
                </div>
              </button>

              <button
                onClick={downloadDetailedRawCSV}
                className="flex flex-col items-center justify-center p-5 bg-white dark:bg-graphite hover:bg-stone dark:hover:bg-gray-800/60 rounded-panel border border-graphite/20 dark:border-white/20 transition-all text-center gap-2 group"
              >
                <Download size={24} className="text-gray-600 dark:text-gray-300 group-hover:text-signal-dim dark:group-hover:text-signal transition-colors" />
                <div>
                  <span className="block font-semibold text-sm text-graphite dark:text-stone">Detailed Raw CSV</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Entry-level line items & notes</span>
                </div>
              </button>

              <button
                onClick={handleExportICS}
                className="flex flex-col items-center justify-center p-5 bg-white dark:bg-graphite hover:bg-stone dark:hover:bg-gray-800/60 rounded-panel border border-graphite/20 dark:border-white/20 transition-all text-center gap-2 group"
              >
                <Calendar size={24} className="text-gray-600 dark:text-gray-300 group-hover:text-signal-dim dark:group-hover:text-signal transition-colors" />
                <div>
                  <span className="block font-semibold text-sm text-graphite dark:text-stone">Export Calendar (ICS)</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Importable iCal schedule</span>
                </div>
              </button>

              <button
                onClick={handlePrint}
                disabled={isGeneratingPdf}
                className="flex flex-col items-center justify-center p-5 bg-graphite dark:bg-stone hover:bg-ink dark:hover:bg-gray-300 text-stone dark:text-ink rounded-panel transition-all text-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                {isGeneratingPdf ? <Loader2 size={24} className="animate-spin" /> : <Printer size={24} />}
                <div>
                  <span className="block font-semibold text-sm">
                    {isGeneratingPdf ? 'Generating…' : 'Generate Report (PDF)'}
                  </span>
                  <span className="text-xs opacity-80">Branded invoice & timecard</span>
                </div>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Entry Edit Modal */}
      {editingEntry && (
        <EntryEditModal
          key={editingEntry.id}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}

      {/* Save As Dialog */}
      <SaveAsDialog />
    </div>
  );
};
