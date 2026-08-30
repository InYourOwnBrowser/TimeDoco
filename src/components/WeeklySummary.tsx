import React, { useMemo } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { startOfWeek, endOfWeek, parseISO } from 'date-fns';
import { Target, TrendingUp } from 'lucide-react';
import { buildLinesFromSettings, sumBillableLines } from '../utils/billing';
import { useNowTick } from '../hooks/useNowTick';

export const WeeklySummary: React.FC = () => {
  const { entries, settings } = useTimeTracker();

  // A running timer grows the week's total, so the bar has to keep up with it.
  const hasRunningEntry = entries.some(e => !e.endTime && !e.deletedAt);
  const nowMs = useNowTick(hasRunningEntry);

  const weeklyData = useMemo(() => {
    const now = new Date(nowMs);
    // Assuming week starts on Monday
    const start = startOfWeek(now, { weekStartsOn: 1 });
    const end = endOfWeek(now, { weekStartsOn: 1 });

    const inWeek = entries.filter(entry => {
      if (entry.deletedAt) return false;
      const entryStart = parseISO(entry.startTime);
      const entryEnd = entry.endTime ? parseISO(entry.endTime) : now;
      return entryEnd >= start && entryStart <= end;
    });

    // Shared with the report and the timesheet rather than re-derived here.
    // The hand-rolled version this replaces summed pause segments raw, so a
    // pause recorded twice was subtracted twice, and it ignored the rounding
    // rule the rest of the app applies — two ways for the progress bar to
    // disagree with every other view of the same week.
    // The week is what the bar measures, but it is not a reporting period the
    // user picked, so it is not a scope window: 'timecode' and 'invoice' scope
    // belong to the report and degrade to 'day' here, which is the bucket the
    // timesheet grid and the entry list build too.
    const lines = buildLinesFromSettings(inWeek, settings, {
      dateRange: { start, end },
      scopeWindow: null,
      now,
    });

    return sumBillableLines([...lines.values()]).seconds / 3600;
  }, [entries, settings, nowMs]);

  const targetHours = settings?.weeklyTargetHours;

  if (!targetHours) {
    return (
      <div className="w-full max-w-md mx-auto mt-6 bg-white dark:bg-graphite p-5 rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 text-center text-sm text-gray-600 dark:text-gray-400">
        Set a weekly target in Settings to track your goal progress.
      </div>
    );
  }

  const progress = Math.min((weeklyData / targetHours) * 100, 100);

  return (
    <div className="w-full max-w-md mx-auto mt-6 bg-white dark:bg-graphite p-5 rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-signal-dim dark:text-signal" />
          <h3 className="text-xs font-sans uppercase tracking-wide font-semibold text-gray-800 dark:text-gray-200">WEEKLY TARGET</h3>
        </div>
        <div className="text-sm font-mono tabular font-medium text-gray-600 dark:text-gray-400">
          <span className={weeklyData >= targetHours ? "text-verdigris dark:text-emerald-400 font-bold" : "text-graphite dark:text-stone"}>
            {weeklyData.toFixed(1)}
          </span> / {targetHours} hrs
        </div>
      </div>

      <div className="w-full bg-stone dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ease-out ${
            weeklyData >= targetHours ? 'bg-verdigris' : 'bg-signal'
          }`}
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      {weeklyData >= targetHours && (
        <p className="mt-3 text-xs text-verdigris dark:text-emerald-400 flex items-center gap-1 font-medium justify-center">
          <TrendingUp size={14} /> Target reached!
        </p>
      )}
    </div>
  );
};
