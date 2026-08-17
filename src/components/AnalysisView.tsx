import React, { useState, useMemo, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subMonths, subQuarters, parseISO, format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Download, Printer, AlertTriangle, Calendar, Loader2, X } from 'lucide-react';
import { HelpTooltip } from './ui/HelpTooltip';
import { useToast } from '../context/ToastContext';
import { applyRounding, calculateDuration, calculateTaxBreakdown } from '../utils/timeUtils';
import { createEvents, type EventAttributes } from 'ics';
import { LOGO_PRINT_BASE64 } from '../assets/logoPrint';

type DatePreset = 'today' | 'week' | 'month' | 'lastMonth' | 'lastQuarter' | 'custom';

export const AnalysisView: React.FC = () => {
  const { entries, timecodes, groups, settings, updateSettings } = useTimeTracker();
  const currencySymbol = settings?.currencySymbol || '$';

  const [preset, setPreset] = useState<DatePreset>('today');
  const [customStart, setCustomStart] = useState<string>(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState<string>(format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [tick, setTick] = useState(0);

  const { addToast } = useToast();
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [selectedTimecodeId, setSelectedTimecodeId] = useState<string>('all');
  const [preparedForOverride, setPreparedForOverride] = useState('');
  const [preparedByOverride, setPreparedByOverride] = useState('');

  const [reportFields, setReportFields] = useState<{ id: string; label: string; value: string }[]>([]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

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
    if (selectedTimecodeId !== 'all') return timecodes.find(t => t.id === selectedTimecodeId)?.name ?? 'All';
    if (selectedGroupId !== 'all') return groups.find(g => g.id === selectedGroupId)?.name ?? 'All';
    return 'All';
  }, [selectedGroupId, selectedTimecodeId, groups, timecodes]);

  const scopeSlug = scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');


  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (preset) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'week':
        return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'lastMonth': {
        const lastMo = subMonths(now, 1);
        return { start: startOfMonth(lastMo), end: endOfMonth(lastMo) };
      }
      case 'lastQuarter': {
        const lastQ = subQuarters(now, 1);
        return { start: startOfQuarter(lastQ), end: endOfQuarter(lastQ) };
      }
      case 'custom':
      default:
        return {
          start: startOfDay(new Date(customStart + 'T00:00:00')),
          end: endOfDay(new Date(customEnd + 'T00:00:00'))
        };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customStart, customEnd, tick]);

  // Filter entries that overlap with the date range
  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      // If it's still running and has no end time, we check if it started before the end of our range.
      // For completed entries, we check if they fall within the range.
      const entryStart = parseISO(entry.startTime);
      const entryEnd = entry.endTime ? parseISO(entry.endTime) : new Date();

      // We want entries that intersect with our date range at all.
      // So entryStart <= rangeEnd AND entryEnd >= rangeStart
      const inRange = entryStart <= dateRange.end && entryEnd >= dateRange.start;

      const tc = timecodes.find(t => t.id === entry.timecodeId);
      const matchesGroup = selectedGroupId === 'all' || tc?.groupId === selectedGroupId;
      const matchesTimecode = selectedTimecodeId === 'all' || entry.timecodeId === selectedTimecodeId;

      return inRange && matchesGroup && matchesTimecode;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, dateRange, tick, selectedGroupId, selectedTimecodeId, timecodes]);


  // Detect overlaps in the filtered entries
  const overlaps = useMemo(() => {
    const overlappingPairs: { e1: typeof entries[0], e2: typeof entries[0] }[] = [];
    const sorted = [...filteredEntries].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const e1 = sorted[i];
        const e2 = sorted[j];

        const start1 = new Date(e1.startTime).getTime();
        const end1 = e1.endTime ? new Date(e1.endTime).getTime() : Date.now();
        const start2 = new Date(e2.startTime).getTime();
        const end2 = e2.endTime ? new Date(e2.endTime).getTime() : Date.now();

        if (start1 < end2 && start2 < end1) {
          overlappingPairs.push({ e1, e2 });
        } else if (start2 >= end1) {
          // Since it's sorted by start time, if start2 >= end1,
          // no subsequent entries will overlap with e1.
          break;
        }
      }
    }
    return overlappingPairs;
  }, [filteredEntries]);


  // Detect gaps > 15 minutes within the same day
  const gaps = useMemo(() => {
    const detectedGaps: { start: Date, end: Date, durationMins: number }[] = [];
    const GAP_THRESHOLD_MINS = 15;

    // Group entries by day first
    const entriesByDay = new Map<string, typeof filteredEntries>();

    filteredEntries.forEach(entry => {
      if (!entry.endTime) return; // Only consider completed entries for gap detection

      const start = new Date(entry.startTime);

      // If entry spans multiple days, split it for gap detection purposes (simplified: just use start day)
      // For accurate intra-day gap detection, we group by start date string
      const dateStr = format(start, 'yyyy-MM-dd');
      if (!entriesByDay.has(dateStr)) {
        entriesByDay.set(dateStr, []);
      }
      entriesByDay.get(dateStr)!.push(entry);
    });

    entriesByDay.forEach((dayEntries) => {
      // Sort by start time
      const sorted = [...dayEntries].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      // Merge overlapping/adjacent entries to find true gaps
      if (sorted.length < 2) return;

      let currentEnd = new Date(sorted[0].endTime!);

      for (let i = 1; i < sorted.length; i++) {
        const nextStart = new Date(sorted[i].startTime);
        const nextEnd = new Date(sorted[i].endTime!);

        if (nextStart > currentEnd) {
          // We have a gap
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

  const { timecodeData, groupData, totalSeconds, totalEarnings, taxBreakdown } = useMemo(() => {
    let tSec = 0;
    let tEarn = 0;
    const tcMap = new Map<string, { duration: number, earnings: number }>();
    const grpMap = new Map<string, number>();

    filteredEntries.forEach(entry => {
      // Calculate exactly how much of this entry falls within the date range
      const entryStart = parseISO(entry.startTime);
      const entryEnd = entry.endTime ? parseISO(entry.endTime) : new Date();

      const effectiveStart = entryStart < dateRange.start ? dateRange.start : entryStart;
      const effectiveEnd = entryEnd > dateRange.end ? dateRange.end : entryEnd;

      // Calculate duration exactly within this clipped window
      let actualDuration = calculateDuration(effectiveStart, effectiveEnd, entry.pausedSegments || []);

      actualDuration = applyRounding(actualDuration, settings?.roundingRule || 'none');

      if (actualDuration <= 0) return;

      tSec += actualDuration;

      const tc = timecodes.find(t => t.id === entry.timecodeId);
      const earnings = tc?.hourlyRate ? (actualDuration / 3600) * tc.hourlyRate : 0;
      tEarn += earnings;

      const currentTc = tcMap.get(entry.timecodeId) || { duration: 0, earnings: 0 };
      tcMap.set(entry.timecodeId, {
        duration: currentTc.duration + actualDuration,
        earnings: currentTc.earnings + earnings
      });

      const groupId = tc?.groupId || 'ungrouped';
      const currentGrp = grpMap.get(groupId) || 0;
      grpMap.set(groupId, currentGrp + actualDuration);
    });

    const formattedTcData = Array.from(tcMap.entries()).map(([tcId, data]) => {
      const tc = timecodes.find(t => t.id === tcId);
      return {
        id: tcId,
        name: tc?.name || 'Unknown',
        durationHours: Number((data.duration / 3600).toFixed(2)),
        earnings: data.earnings,
        color: tc?.color || groups.find(g => g.id === tc?.groupId)?.color || '#cbd5e1'
      };
    }).sort((a, b) => b.durationHours - a.durationHours);

    const formattedGrpData = Array.from(grpMap.entries()).map(([grpId, duration]) => {
      const grp = groups.find(g => g.id === grpId);
      return {
        id: grpId,
        name: grpId === 'ungrouped' ? 'Ungrouped' : grp?.name || 'Unknown',
        durationHours: Number((duration / 3600).toFixed(2)),
        color: grp?.color || '#cbd5e1'
      };
    }).sort((a, b) => b.durationHours - a.durationHours);

    const calculatedTax = settings?.taxEnabled && settings?.taxRate
      ? calculateTaxBreakdown(tEarn, settings.taxRate, !!settings.taxInclusive)
      : null;

    return {
      timecodeData: formattedTcData,
      groupData: formattedGrpData,
      totalSeconds: tSec,
      totalEarnings: tEarn,
      taxBreakdown: calculatedTax
    };
  }, [filteredEntries, dateRange, timecodes, groups, settings?.roundingRule, settings?.taxEnabled, settings?.taxRate, settings?.taxInclusive]);

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  const escapeCSV = (str: string) => {
    let escaped = str.replace(/"/g, '""');
    if (/^[=+\-@]/.test(escaped)) {
      escaped = "'" + escaped;
    }
    return `"${escaped}"`;
  };

  const handleExportCSV = () => {
    const headers = ['Timecode', 'Group', 'Duration (Hours)', 'Earnings'];
    const rows = timecodeData.map(tc => {
      const timecode = timecodes.find(t => t.id === tc.id);
      const groupName = timecode?.groupId ? groups.find(g => g.id === timecode.groupId)?.name || 'Unknown' : 'Ungrouped';
      return [
        escapeCSV(tc.name),
        escapeCSV(groupName),
        tc.durationHours.toString(),
        tc.earnings.toFixed(2)
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `time-report-${scopeSlug}-${format(dateRange.start, 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Implements the raw/detailed entry-level CSV export feature requested in the audit report
  const handleExportICS = () => {
    const events: EventAttributes[] = filteredEntries.map(e => {
      const tc = timecodes.find(t => t.id === e.timecodeId);
      const start = parseISO(e.startTime);
      const end = e.endTime ? parseISO(e.endTime) : new Date();

      return {
        start: [
          start.getUTCFullYear(),
          start.getUTCMonth() + 1,
          start.getUTCDate(),
          start.getUTCHours(),
          start.getUTCMinutes()
        ],
        end: [
          end.getUTCFullYear(),
          end.getUTCMonth() + 1,
          end.getUTCDate(),
          end.getUTCHours(),
          end.getUTCMinutes()
        ],
        startInputType: 'utc',
        startOutputType: 'utc',
        endInputType: 'utc',
        endOutputType: 'utc',
        title: tc?.name ?? 'Unknown',
        description: e.note ?? '',
      };
    });

    if (events.length === 0) return;

    createEvents(events, (error, value) => {
      if (error) {
        console.error('Error generating ICS file', error);
        return;
      }
      const blob = new Blob([value], { type: 'text/calendar;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `time-entries-${scopeSlug}-${format(dateRange.start, 'yyyy-MM-dd')}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    });
  };

  // Implements the raw/detailed entry-level CSV export feature requested in the audit report
  const downloadDetailedRawCSV = () => {
    const headers = ['Date', 'Timecode', 'Group', 'Start', 'End', 'Duration (h)', 'Note'];
    const rows = filteredEntries.map(e => {
      const tc = timecodes.find(t => t.id === e.timecodeId);
      const grp = groups.find(g => g.id === tc?.groupId);
      return [
        escapeCSV(format(parseISO(e.startTime), 'yyyy-MM-dd')),
        escapeCSV(tc?.name ?? 'Unknown'),
        escapeCSV(grp?.name ?? 'Ungrouped'),
        escapeCSV(format(parseISO(e.startTime), 'HH:mm:ss')),
        escapeCSV(e.endTime ? format(parseISO(e.endTime), 'HH:mm:ss') : ''),
        (applyRounding(e.duration, settings?.roundingRule ?? 'none') / 3600).toFixed(2),
        escapeCSV(e.note),
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `time-entries-${scopeSlug}-${format(dateRange.start, 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = async () => {
    setIsGeneratingPdf(true);
    await new Promise(resolve => setTimeout(resolve, 0)); // let the spinner actually render before the sync work below blocks the thread

    try {
      const preparedFor = preparedForOverride || scopeLabel;
      const defaultPreparedBy = [settings?.preparerName, settings?.preparerCompany].filter(Boolean).join(' — ');
      const preparedBy = preparedByOverride || defaultPreparedBy;
      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      const drawHeader = () => {
        const userLogo = settings?.userLogoBase64;

        if (userLogo) {
          try {
            const props = doc.getImageProperties(userLogo);
            const maxW = 35, maxH = 12;
            const ratio = props.width / props.height;
            const w = ratio > maxW / maxH ? maxW : maxH * ratio;
            const h = ratio > maxW / maxH ? maxW / ratio : maxH;
            doc.addImage(userLogo, props.fileType, 14, 10, w, h);
          } catch (e) {
            console.error('Failed to render user logo in PDF, falling back to TimeDoco logo only:', e);
            doc.addImage(LOGO_PRINT_BASE64, 'PNG', 14, 10, 37.5, 10);
          }
          // TimeDoco becomes a small secondary credit, top-right
          doc.addImage(LOGO_PRINT_BASE64, 'PNG', pageWidth - 14 - 25, 8, 25, 6.67);
        } else {
          // No user logo configured — unchanged from today
          doc.addImage(LOGO_PRINT_BASE64, 'PNG', 14, 10, 37.5, 10);
        }

        doc.setFontSize(9);
        doc.setTextColor(140);
        doc.text('Time & Activity Report', pageWidth - 14, userLogo ? 18 : 15, { align: 'right' });
      };

      let headerDrawnPage = 0;
      const ensureHeader = (pageNumber: number) => {
        if (pageNumber === headerDrawnPage) return; // already drawn for this page
        headerDrawnPage = pageNumber;
        drawHeader();
      };

      ensureHeader(1); // page 1, before the metadata block

      doc.setFontSize(10);
      doc.setTextColor(60);
      let y = 28;
      const metaLine = (label: string, value: string) => {
        if (!value) return;
        doc.setFont('helvetica', 'bold'); doc.text(label, 14, y);
        doc.setFont('helvetica', 'normal'); doc.text(value, 40, y);
        y += 5;
      };
      metaLine('Prepared for:', preparedFor);
      metaLine('Prepared by:', preparedBy);
      metaLine('Period:', `${format(dateRange.start, 'MMM d, yyyy')} – ${format(dateRange.end, 'MMM d, yyyy')}`);
      metaLine('Generated:', format(new Date(), "MMM d, yyyy 'at' HH:mm"));

      reportFields
        .filter(f => f.label.trim() && f.value.trim())
        .forEach(f => metaLine(`${f.label}:`, f.value));

      y += 3;
      doc.setFontSize(12);
      doc.setTextColor(20);
      doc.setFont('helvetica', 'bold');
      doc.text('Summary', 14, y);

      const timecodeById = new Map(timecodes.map(t => [t.id, t]));
      const groupById = new Map(groups.map(g => [g.id, g]));

      const summaryRows = timecodeData.map(tc => {
        const timecode = timecodeById.get(tc.id);
        const groupName = timecode?.groupId ? groupById.get(timecode.groupId)?.name || 'Unknown' : 'Ungrouped';
        const rate = timecode?.hourlyRate ? `${currencySymbol}${timecode.hourlyRate.toFixed(2)}/hr` : '-';
        return [tc.name, groupName, rate, tc.durationHours.toFixed(2), tc.earnings > 0 ? `${currencySymbol}${tc.earnings.toFixed(2)}` : '-'];
      });

      const foot = taxBreakdown
        ? [
            ['', '', '', 'Subtotal', `${currencySymbol}${taxBreakdown.subtotal.toFixed(2)}`],
            ['', '', '', `${settings?.taxLabel || 'Tax'} (${settings?.taxRate}%)`, `${currencySymbol}${taxBreakdown.tax.toFixed(2)}`],
            ['', 'Total', '', (totalSeconds / 3600).toFixed(2), `${currencySymbol}${taxBreakdown.total.toFixed(2)}`],
          ]
        : [['', 'Total', '', (totalSeconds / 3600).toFixed(2), totalEarnings > 0 ? `${currencySymbol}${totalEarnings.toFixed(2)}` : '-']];

      autoTable(doc, {
        startY: y + 4,
        head: [['Timecode', 'Group', 'Rate', 'Hours', 'Total']],
        body: summaryRows,
        foot,
        footStyles: { fontStyle: 'bold', fillColor: [238, 240, 236], textColor: [16, 22, 28] },
        margin: { top: 25 },
        didDrawPage: (data) => ensureHeader(data.pageNumber),
      });

      // Detailed entries — the actual proof of work, including notes
      const detailRows = [...filteredEntries]
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .map(e => {
          const tc = timecodeById.get(e.timecodeId);
          const hrs = (applyRounding(e.duration, settings?.roundingRule ?? 'none') / 3600).toFixed(2);
          return [
            format(parseISO(e.startTime), 'MMM d'),
            tc?.name ?? 'Unknown',
            format(parseISO(e.startTime), 'HH:mm'),
            e.endTime ? format(parseISO(e.endTime), 'HH:mm') : 'Running',
            hrs,
            e.note || '—',
          ];
        });

      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 10,
        head: [['Date', 'Timecode', 'Start', 'End', 'Hours', 'Note']],
        body: detailRows,
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 5: { cellWidth: 60 } },
        margin: { top: 25 },
        didDrawPage: (data) => ensureHeader(data.pageNumber),
      });

      const pageCount = (doc.internal as any).getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(160);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
        doc.text('Generated with TimeDoco', 14, doc.internal.pageSize.getHeight() - 8);
      }

      doc.save(`time-report-${scopeSlug}-${format(dateRange.start, 'yyyy-MM-dd')}.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      addToast('Failed to generate PDF. Please try again.', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="w-full bg-stone dark:bg-graphite rounded-panel shadow-sm border border-graphite/10 dark:border-white/10 overflow-hidden print:shadow-none print:border-none">
      <div className="p-6 border-b border-graphite/10 dark:border-white/10 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <h2 className="text-xl font-bold text-graphite dark:text-stone">Analysis & Reports</h2>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-graphite dark:text-stone bg-gray-50 dark:bg-gray-800/30 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-md transition-colors border border-graphite/20 dark:border-white/20 focus-visible:ring-2 focus-visible:ring-signal" title="Summary CSV">
              <Download size={16} /> <span className="hidden sm:inline">Summary CSV</span><span className="sm:hidden">CSV</span>
            </button>
            <button onClick={downloadDetailedRawCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-graphite dark:text-stone bg-gray-50 dark:bg-gray-800/30 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-md transition-colors border border-graphite/20 dark:border-white/20 focus-visible:ring-2 focus-visible:ring-signal" title="Export Detailed CSV">
              <Download size={16} /> <span className="hidden sm:inline">Detailed Raw CSV</span><span className="sm:hidden">Detailed CSV</span>
            </button>
            <button onClick={handleExportICS} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-graphite dark:text-stone bg-gray-50 dark:bg-gray-800/30 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-md transition-colors border border-graphite/20 dark:border-white/20 focus-visible:ring-2 focus-visible:ring-signal" title="Export Calendar (ICS)">
              <Calendar size={16} /> <span className="hidden sm:inline">Export ICS</span><span className="sm:hidden">ICS</span>
            </button>
            <button
              onClick={handlePrint}
              disabled={isGeneratingPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-graphite dark:text-stone bg-gray-50 dark:bg-gray-800/30 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-md transition-colors border border-graphite/20 dark:border-white/20 focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGeneratingPdf ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
              <span className="hidden sm:inline">{isGeneratingPdf ? 'Generating…' : 'PDF / Print'}</span>
              <span className="sm:hidden">{isGeneratingPdf ? '...' : 'Print'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {(['today', 'week', 'month', 'lastMonth', 'lastQuarter', 'custom'] as DatePreset[]).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
                preset === p ? 'bg-graphite text-stone dark:bg-stone dark:text-ink' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : p === 'lastMonth' ? 'Last Month' : p === 'lastQuarter' ? 'Last Quarter' : 'Custom'}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2 mb-4">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <span className="text-gray-500 dark:text-gray-400">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="px-3 py-1.5 text-sm border-graphite/10 dark:border-white/10 rounded-md bg-stone dark:bg-ink text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            <option value="all">All Clients / Groups</option>
            {groups.filter(g => !g.archived).map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select
            value={selectedTimecodeId}
            onChange={(e) => setSelectedTimecodeId(e.target.value)}
            className="px-3 py-1.5 text-sm border-graphite/10 dark:border-white/10 rounded-md bg-stone dark:bg-ink text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            <option value="all">All Timecodes</option>
            {timecodeOptions.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {(selectedGroupId !== 'all' || selectedTimecodeId !== 'all') && (
            <button
              onClick={() => { setSelectedGroupId('all'); setSelectedTimecodeId('all'); }}
              className="text-sm text-gray-500 hover:text-signal dark:text-gray-400 transition-colors"
            >
              Clear filter
            </button>
          )}
          <HelpTooltip text="Filters everything below, including the CSV, ICS, and PDF exports — use this to send a client-specific breakdown." />
        </div>
        <div className="flex flex-col gap-2 mb-4 max-w-md">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 w-20 shrink-0">Prepared for</label>
            <input
              type="text"
              value={preparedForOverride}
              onChange={(e) => setPreparedForOverride(e.target.value)}
              placeholder={scopeLabel}
              className="flex-1 px-3 py-1.5 text-sm border-graphite/10 dark:border-white/10 rounded-md bg-stone dark:bg-ink text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400 w-20 shrink-0">Prepared by</label>
            <input
              type="text"
              value={preparedByOverride}
              onChange={(e) => setPreparedByOverride(e.target.value)}
              placeholder={[settings?.preparerName, settings?.preparerCompany].filter(Boolean).join(' — ') || 'not set in Settings'}
              className="flex-1 px-3 py-1.5 text-sm border-graphite/10 dark:border-white/10 rounded-md bg-stone dark:bg-ink text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            />
          </div>
          {reportFields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <input type="text" value={f.label} onChange={(e) => updateReportField(i, { label: e.target.value })} placeholder="Label" className="w-20 shrink-0 px-2 py-1.5 text-xs border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-ink text-graphite dark:text-stone" />
              <input type="text" value={f.value} onChange={(e) => updateReportField(i, { value: e.target.value })} placeholder="Value" className="flex-1 px-2 py-1.5 text-xs border border-graphite/10 dark:border-white/10 rounded bg-stone dark:bg-ink text-graphite dark:text-stone" />
              <button onClick={() => setReportFields(prev => prev.filter((_, j) => j !== i))} aria-label="Remove field" className="text-gray-400 hover:text-rust shrink-0"><X size={14} /></button>
            </div>
          ))}
          <button onClick={() => setReportFields(prev => [...prev, { id: crypto.randomUUID(), label: '', value: '' }])} className="text-xs text-signal hover:text-signal-dim self-start">+ Field</button>
        </div>
      </div>

      <div className="p-6">
        {scopeLabel !== 'All' && <p className="text-sm text-gray-500 mb-2">Showing: {scopeLabel}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-stone dark:bg-ink rounded-panel p-5 border border-graphite/10 dark:border-white/10 shadow-inner flex flex-col justify-center items-center transition-colors">
            <span className="text-signal text-xs font-sans font-semibold mb-1 uppercase tracking-wide">TOTAL TRACKED TIME</span>
            <span className="text-4xl font-mono tabular font-medium text-graphite dark:text-stone">{formatDuration(totalSeconds)}</span>
          </div>
          {totalEarnings > 0 && (
            <div className="bg-stone dark:bg-ink rounded-panel p-5 border border-graphite/10 dark:border-white/10 shadow-inner flex flex-col justify-center transition-colors">
              {taxBreakdown ? (
                  <>
                    <span className="text-verdigris text-xs font-sans font-semibold mb-2 uppercase tracking-wide text-center">Earnings</span>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                        <span>Subtotal</span>
                        <span className="font-mono tabular">{currencySymbol}{taxBreakdown.subtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                        <span>{settings?.taxLabel || 'Tax'} ({settings?.taxRate}%)</span>
                        <span className="font-mono tabular">{currencySymbol}{taxBreakdown.tax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-medium text-graphite dark:text-stone pt-1 border-t border-graphite/10 dark:border-white/10">
                        <span>Total</span>
                        <span className="font-mono tabular">{currencySymbol}{taxBreakdown.total.toFixed(2)}</span>
                      </div>
                    </div>
                  </>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="text-verdigris text-xs font-sans font-semibold mb-1 uppercase tracking-wide">TOTAL EARNINGS</span>
                  <span className="text-4xl font-mono tabular font-medium text-graphite dark:text-stone">{currencySymbol}{totalEarnings.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {totalEarnings > 0 && !settings?.taxEnabled && !settings?.taxPromptDismissed && (
          <div className="mb-8 p-4 bg-stone dark:bg-ink border border-graphite/10 dark:border-white/10 rounded-panel shadow-inner flex items-start justify-between gap-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Add a tax rate in Settings to show before/after-tax totals on your earnings and reports.
            </p>
            <button onClick={() => updateSettings({ taxPromptDismissed: true })} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}



        {gaps.length > 0 && (
          <div className="mb-8 p-4 bg-stone dark:bg-ink border border-graphite/10 dark:border-white/10 rounded-panel shadow-inner flex items-start gap-3">
            <AlertTriangle className="text-signal mt-0.5 shrink-0" size={20} />
            <div>
              <h4 className="font-medium text-graphite dark:text-stone">Untracked Time Gaps Detected</h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                There are {gaps.length} gaps of 15+ minutes between time entries during this period.
              </p>
            </div>
          </div>
        )}

        {overlaps.length > 0 && (
          <div className="mb-8 p-4 bg-stone dark:bg-ink border border-rust/30 dark:border-rust/30 rounded-panel shadow-inner flex items-start gap-3">
            <AlertTriangle className="text-rust mt-0.5 shrink-0" size={20} />
            <div>
              <h4 className="font-medium text-rust">Overlapping Entries Detected</h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                There are {overlaps.length} overlapping time entries in this period. Review your history in the Tracker tab to ensure your tracked time is accurate.
              </p>
            </div>
          </div>
        )}


        {/* Timeline View - Only show if range is exactly one day (e.g. preset 'today' or custom 1-day range) */}
        {dateRange.start.getTime() === startOfDay(dateRange.start).getTime() &&
         dateRange.end.getTime() === endOfDay(dateRange.start).getTime() && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4 text-center">Daily Timeline</h3>
            <div className="relative h-12 bg-stone dark:bg-ink rounded-panel shadow-inner overflow-hidden border border-graphite/10 dark:border-white/10">
              {/* Hour markers */}
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-graphite/10 dark:border-white/10"
                  style={{ left: `${(i / 24) * 100}%` }}
                >
                  <span className="absolute top-full mt-1 -ml-3 text-[10px] font-mono tabular text-gray-400">
                    {i % 4 === 0 ? (i === 0 || i === 24 ? '12A' : i === 12 ? '12P' : i > 12 ? `${i - 12}P` : `${i}A`) : ''}
                  </span>
                </div>
              ))}

              {/* Time blocks */}
              {filteredEntries.map(entry => {
                const entryStart = parseISO(entry.startTime);
                const entryEnd = entry.endTime ? parseISO(entry.endTime) : new Date();

                const dayStart = dateRange.start;
                const totalDaySeconds = 86400;

                const startSeconds = Math.max(0, (entryStart.getTime() - dayStart.getTime()) / 1000);
                const endSeconds = Math.min(totalDaySeconds, (entryEnd.getTime() - dayStart.getTime()) / 1000);

                if (startSeconds >= totalDaySeconds || endSeconds <= 0) return null;

                const leftPercent = (startSeconds / totalDaySeconds) * 100;
                const widthPercent = ((endSeconds - startSeconds) / totalDaySeconds) * 100;

                const tc = timecodes.find(t => t.id === entry.timecodeId);
                const color = tc?.color || groups.find(g => g.id === tc?.groupId)?.color || '#cbd5e1';

                return (
                  <div
                    key={entry.id}
                    className="absolute top-0 bottom-0 opacity-80 hover:opacity-100 transition-opacity"
                    style={{ left: `${leftPercent}%`, width: `${widthPercent}%`, backgroundColor: color }}
                    title={`${tc?.name || 'Unknown'} (${format(entryStart, 'h:mm a')} - ${entry.endTime ? format(entryEnd, 'h:mm a') : 'Now'})`}
                  ></div>
                );
              })}
            </div>
            <div className="h-6"></div> {/* Spacer for labels */}
          </div>
        )}

        {timecodeData.length > 0 ? (
          <>
            <div className="mb-8 h-80">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4 text-center">Time by Timecode</h3>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timecodeData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12, fontFamily: 'monospace' }} />
                  <YAxis tick={{ fontSize: 12, fontFamily: 'monospace' }} label={{ value: 'Hours', angle: -90, position: 'insideLeft', fontFamily: 'sans-serif' }} />
                  <Tooltip
                    formatter={(value: any) => [`${value} hrs`, 'Duration']}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.06)', fontFamily: 'monospace' }}
                  />
                  <Bar dataKey="durationHours" radius={[4, 4, 0, 0]}>
                    {timecodeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              <div className="h-64">
                 <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2 text-center">Time by Group</h3>
                 <ResponsiveContainer width="100%" height="100%">
                   <PieChart>
                     <Pie
                       data={groupData}
                       cx="50%"
                       cy="50%"
                       innerRadius={60}
                       outerRadius={80}
                       paddingAngle={2}
                       dataKey="durationHours"
                     >
                       {groupData.map((entry, index) => (
                         <Cell key={`cell-${index}`} fill={entry.color} />
                       ))}
                     </Pie>
                     <Tooltip formatter={(value: any) => [`${value} hrs`, 'Duration']} />
                     <Legend verticalAlign="bottom" height={36}/>
                   </PieChart>
                 </ResponsiveContainer>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-3">Breakdown</h3>
                <div className="overflow-hidden border border-graphite/10 dark:border-white/10 rounded-panel shadow-inner">
                  <table className="min-w-full divide-y divide-graphite/10 dark:divide-white/10 text-sm">
                    <thead className="bg-stone dark:bg-ink">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-500 dark:text-gray-400 font-sans text-xs uppercase tracking-wide">Timecode</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-500 dark:text-gray-400 font-sans text-xs uppercase tracking-wide">Hours</th>
                        {totalEarnings > 0 && <th className="px-4 py-3 text-right font-semibold text-gray-500 dark:text-gray-400 font-sans text-xs uppercase tracking-wide">Earnings</th>}
                      </tr>
                    </thead>
                    <tbody className="bg-stone dark:bg-ink divide-y divide-graphite/10 dark:divide-white/10">
                      {timecodeData.map((tc) => (
                        <tr key={tc.id} className="hover:bg-signal/5 transition-colors">
                          <td className="px-4 py-2.5 flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tc.color }}></div>
                            <span className="font-medium text-graphite dark:text-stone">{tc.name}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-graphite dark:text-stone font-mono tabular">{tc.durationHours.toFixed(2)}</td>
                          {totalEarnings > 0 && (
                            <td className="px-4 py-2.5 text-right text-graphite dark:text-stone font-mono tabular">
                              {tc.earnings > 0 ? `${currencySymbol}${tc.earnings.toFixed(2)}` : '-'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            No time tracked for this period.
          </div>
        )}
      </div>
    </div>
  );
};
