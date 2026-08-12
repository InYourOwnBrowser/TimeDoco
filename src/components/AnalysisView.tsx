import React, { useState, useMemo } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO, format, differenceInSeconds } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Download, Printer } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type DatePreset = 'today' | 'week' | 'month' | 'custom';

export const AnalysisView: React.FC = () => {
  const { entries, timecodes, groups } = useTimeTracker();

  const [preset, setPreset] = useState<DatePreset>('today');
  const [customStart, setCustomStart] = useState<string>(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState<string>(format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));

  const dateRange = useMemo(() => {
    const now = new Date();
    switch (preset) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'week':
        return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'custom':
      default:
        return {
          start: startOfDay(new Date(customStart + 'T00:00:00')),
          end: endOfDay(new Date(customEnd + 'T00:00:00'))
        };
    }
  }, [preset, customStart, customEnd]);

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
  }, [entries, dateRange]);

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

      // Calculate duration just within this window
      // Note: Pause segments inside this window would ideally be subtracted,
      // but for simplicity we'll use a proportion of the total duration or just the raw overlap
      // if it's simpler. Let's use proportional duration to be fair to pauses.
      const rawFullDuration = differenceInSeconds(entryEnd, entryStart);
      const rawOverlapDuration = Math.max(0, differenceInSeconds(effectiveEnd, effectiveStart));

      const actualDuration = rawFullDuration > 0 && entry.duration > 0
        ? Math.round(entry.duration * (rawOverlapDuration / rawFullDuration))
        : rawOverlapDuration;

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
  }, [filteredEntries, dateRange, timecodes, groups]);

  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
  };

  const handleExportCSV = () => {
    const headers = ['Timecode', 'Group', 'Duration (Hours)', 'Earnings'];
    const rows = timecodeData.map(tc => {
      const timecode = timecodes.find(t => t.id === tc.id);
      const groupName = timecode?.groupId ? groups.find(g => g.id === timecode.groupId)?.name || 'Unknown' : 'Ungrouped';
      return [
        `"${tc.name.replace(/"/g, '""')}"`,
        `"${groupName.replace(/"/g, '""')}"`,
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

  const handlePrint = () => {
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
            <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600">
              <Download size={16} /> CSV
            </button>
            <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600">
              <Printer size={16} /> PDF / Print
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {(['today', 'week', 'month', 'custom'] as DatePreset[]).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-4 py-1.5 text-sm font-medium rounded-full capitalize transition-colors ${
                preset === p ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'Custom'}
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
