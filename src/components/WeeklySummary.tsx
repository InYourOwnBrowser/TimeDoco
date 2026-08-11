import React, { useMemo } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { startOfWeek, endOfWeek, parseISO, differenceInSeconds } from 'date-fns';
import { Target, TrendingUp } from 'lucide-react';

export const WeeklySummary: React.FC = () => {
  const { entries, settings } = useTimeTracker();

  const weeklyData = useMemo(() => {
    const now = new Date();
    // Assuming week starts on Monday
    const start = startOfWeek(now, { weekStartsOn: 1 });
    const end = endOfWeek(now, { weekStartsOn: 1 });

    let totalSeconds = 0;

    entries.forEach(entry => {
      const entryStart = parseISO(entry.startTime);
      const entryEnd = entry.endTime ? parseISO(entry.endTime) : new Date();

      if (entryEnd >= start && entryStart <= end) {
        let actualStart = entryStart < start ? start : entryStart;
        let actualEnd = entryEnd > end ? end : entryEnd;

        let pauseSec = 0;
        entry.pausedSegments.forEach(seg => {
            const ps = parseISO(seg.pauseStart);
            const pe = seg.pauseEnd ? parseISO(seg.pauseEnd) : new Date();

            if (pe >= start && ps <= end) {
                const adjPs = ps < start ? start : ps;
                const adjPe = pe > end ? end : pe;
                pauseSec += differenceInSeconds(adjPe, adjPs);
            }
        });

        totalSeconds += Math.max(0, differenceInSeconds(actualEnd, actualStart) - pauseSec);
      }
    });

    const hours = totalSeconds / 3600;
    return hours;
  }, [entries]);

  const targetHours = settings?.weeklyTargetHours;

  if (!targetHours) {
    return null; // Don't show if no target is set
  }

  const progress = Math.min((weeklyData / targetHours) * 100, 100);

  return (
    <div className="w-full max-w-md mx-auto mt-6 bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Weekly Target</h3>
        </div>
        <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
          <span className={weeklyData >= targetHours ? "text-green-600 dark:text-green-400" : ""}>
            {weeklyData.toFixed(1)}
          </span> / {targetHours} hrs
        </div>
      </div>

      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ease-out ${
            weeklyData >= targetHours ? 'bg-green-500' : 'bg-blue-600 dark:bg-blue-500'
          }`}
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      {weeklyData >= targetHours && (
        <p className="mt-3 text-xs text-green-600 dark:text-green-400 flex items-center gap-1 font-medium justify-center">
          <TrendingUp size={14} /> Target reached! Great job!
        </p>
      )}
    </div>
  );
};
