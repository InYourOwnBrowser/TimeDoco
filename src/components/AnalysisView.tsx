import React, { useState, useMemo, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subMonths, subQuarters, parseISO, format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Download, Printer, AlertTriangle, Calendar } from 'lucide-react';
import { applyRounding, calculateDuration } from '../utils/timeUtils';
import { createEvents, type EventAttributes } from 'ics';

type DatePreset = 'today' | 'week' | 'month' | 'lastMonth' | 'lastQuarter' | 'custom';

export const AnalysisView: React.FC = () => {
  const { entries, timecodes, groups, settings } = useTimeTracker();

  const [preset, setPreset] = useState<DatePreset>('today');
  const [customStart, setCustomStart] = useState<string>(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState<string>(format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [tick, setTick] = useState(0);

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
      return entryStart <= dateRange.end && entryEnd >= dateRange.start;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, dateRange, tick]);


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

  const { timecodeData, groupData, totalSeconds, totalEarnings } = useMemo(() => {
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

    return { timecodeData: formattedTcData, groupData: formattedGrpData, totalSeconds: tSec, totalEarnings: tEarn };
  }, [filteredEntries, dateRange, timecodes, groups, settings?.roundingRule]);

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
    link.setAttribute('download', `time-report-${format(dateRange.start, 'yyyy-MM-dd')}.csv`);
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
      link.setAttribute('download', `time-entries-${format(dateRange.start, 'yyyy-MM-dd')}.ics`);
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
    link.setAttribute('download', `time-entries-${format(dateRange.start, 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = async () => {
    // Note: PDF printable exports are implemented here using jspdf and jspdf-autotable
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const tableData = timecodeData.map(tc => {
      const timecode = timecodes.find(t => t.id === tc.id);
      const groupName = timecode?.groupId ? groups.find(g => g.id === timecode.groupId)?.name || 'Unknown' : 'Ungrouped';
      return [tc.name, groupName, tc.durationHours.toString(), tc.earnings.toFixed(2)];
    });

    autoTable(doc, {
      head: [['Timecode', 'Group', 'Duration (Hours)', 'Earnings']],
      body: tableData,
    });

    doc.save(`time-report-${format(dateRange.start, 'yyyy-MM-dd')}.pdf`);
  };

  return (
    <div className="w-full bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden print:shadow-none print:border-none">
      <div className="p-6 border-b border-gray-100 dark:border-gray-700 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Analysis & Reports</h2>
          <div className="flex gap-2">
            <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600" title="Summary CSV">
              <Download size={16} /> Summary CSV
            </button>
            <button onClick={downloadDetailedRawCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600" title="Export Detailed CSV">
              <Download size={16} /> Detailed Raw CSV
            </button>
            <button onClick={handleExportICS} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600" title="Export Calendar (ICS)">
              <Calendar size={16} /> Export ICS
            </button>
            <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600">
              <Printer size={16} /> PDF / Print
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {(['today', 'week', 'month', 'lastMonth', 'lastQuarter', 'custom'] as DatePreset[]).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
                preset === p ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : p === 'lastMonth' ? 'Last Month' : p === 'lastQuarter' ? 'Last Quarter' : 'Custom'}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2 mb-2">
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
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-blue-50 dark:bg-blue-900/50 rounded-lg p-5 border border-blue-100 dark:border-blue-800 flex flex-col justify-center items-center">
            <span className="text-blue-600 dark:text-blue-200 text-sm font-medium mb-1 uppercase tracking-wide">Total Tracked Time</span>
            <span className="text-4xl font-bold text-gray-900 dark:text-white">{formatDuration(totalSeconds)}</span>
          </div>
          {totalEarnings > 0 && (
            <div className="bg-green-50 dark:bg-green-900/50 rounded-lg p-5 border border-green-100 dark:border-green-800 flex flex-col justify-center items-center">
              <span className="text-green-700 dark:text-green-200 text-sm font-medium mb-1 uppercase tracking-wide">Total Earnings</span>
              <span className="text-4xl font-bold text-gray-900 dark:text-white">${totalEarnings.toFixed(2)}</span>
            </div>
          )}
        </div>



        {gaps.length > 0 && (
          <div className="mb-8 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-3">
            <AlertTriangle className="text-blue-500 mt-0.5 shrink-0" size={20} />
            <div>
              <h4 className="font-medium text-blue-800 dark:text-blue-300">Untracked Time Gaps Detected</h4>
              <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                There are {gaps.length} gaps of 15+ minutes between time entries during this period.
              </p>
            </div>
          </div>
        )}

        {overlaps.length > 0 && (
          <div className="mb-8 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-3">
            <AlertTriangle className="text-amber-500 mt-0.5 shrink-0" size={20} />
            <div>
              <h4 className="font-medium text-amber-800 dark:text-amber-300">Overlapping Entries Detected</h4>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
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
            <div className="relative h-12 bg-gray-200 dark:bg-gray-800 rounded-md overflow-hidden border border-gray-300 dark:border-gray-700">
              {/* Hour markers */}
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-gray-300 dark:border-gray-600/50"
                  style={{ left: `${(i / 24) * 100}%` }}
                >
                  <span className="absolute top-full mt-1 -ml-3 text-[10px] text-gray-400">
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
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
                  <Tooltip
                    formatter={(value: any) => [`${value} hrs`, 'Duration']}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
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
                <div className="overflow-hidden border border-gray-200 dark:border-gray-700 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900/50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">Timecode</th>
                        <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Hours</th>
                        {totalEarnings > 0 && <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">Earnings</th>}
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {timecodeData.map((tc) => (
                        <tr key={tc.id}>
                          <td className="px-4 py-2.5 flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tc.color }}></div>
                            <span className="font-medium text-gray-800 dark:text-gray-200">{tc.name}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">{tc.durationHours.toFixed(2)}</td>
                          {totalEarnings > 0 && (
                            <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-300">
                              {tc.earnings > 0 ? `$${tc.earnings.toFixed(2)}` : '-'}
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
