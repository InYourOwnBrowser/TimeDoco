import React, { useMemo } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { startOfWeek, endOfWeek, eachDayOfInterval, parseISO } from 'date-fns';
import { Target, TrendingUp } from 'lucide-react';
import { billableSecondsByDay, buildScreenLines, workedVsBilledNote } from '../utils/billing';
import { calendarDayKey } from '../utils/timeUtils';
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
    const weekDays = eachDayOfInterval({ start, end });
    const weekDateStrings = new Set(weekDays.map(calendarDayKey));

    const live = entries.filter(entry => !entry.deletedAt);

    // Shared with the report and the timesheet rather than re-derived here.
    // The hand-rolled version this replaces summed pause segments raw, so a
    // pause recorded twice was subtracted twice, and it ignored the rounding
    // rule the rest of the app applies — two ways for the progress bar to
    // disagree with every other view of the same week.
    // The week is what the bar measures, but it is not a reporting period the
    // user picked, so it is not a scope window: 'timecode' and 'invoice' scope
    // belong to the report and degrade to 'day' here, which is the bucket the
    // timesheet grid and the entry list build too.
    const lines = buildScreenLines(live, settings, {
      now,
    });

    // The bar measures this week, and an entry running through midnight belongs
    // to the week each of its hours was worked in — the same split the grid and
    // the calendar draw, so a Sunday-night shift moves both bars by an hour
    // rather than one by two. Selecting on the start day put the whole shift in
    // whichever week it began.
    //
    // Worked time is split the same way, and for the same reason the note
    // exists: comparing this week's billed hours against the *whole* entry's
    // clock time would report the half that belongs to the next week as
    // "rounding", which is the one thing `workedVsBilledNote` must never say.
    // With the rule switched off, billable seconds are worked seconds, so one
    // split serves both figures.
    const sumWeek = (byEntry: Map<string, Map<string, number>>) => {
      let total = 0;
      for (const [, days] of byEntry) {
        for (const [day, value] of days) {
          if (weekDateStrings.has(day)) total += value;
        }
      }
      return total;
    };

    const seconds = sumWeek(billableSecondsByDay(live, lines, now));
    let workedSeconds = sumWeek(
      billableSecondsByDay(live, buildScreenLines(live, { ...settings, roundingRule: 'none' }, { now }), now),
    );

    // A fee bills no hours at all, so it never reaches either split. Its time on
    // the clock still has to be disclosed, and it is attributed to the day the
    // entry began — the rule `buildBillableLines` already applies to the money.
    let hasFixedCost = false;
    for (const entry of live) {
      const line = lines.get(entry.id);
      if (!line?.isFixedCost) continue;
      if (!weekDateStrings.has(calendarDayKey(parseISO(entry.startTime)))) continue;
      hasFixedCost = true;
      workedSeconds += line.workedSeconds;
    }

    return {
      hours: seconds / 3600,
      // The bar measures billable hours, and a flat fee bills as a fee rather
      // than by the hour, so its time on the clock moves the bar not at all.
      // Without this the week's target could sit short of a full day and give
      // no clue why. Rounding is disclosed the same way, in the same words the
      // report uses.
      note: workedVsBilledNote(workedSeconds, seconds, hasFixedCost),
    };
  }, [entries, settings, nowMs]);

  const { hours: weeklyHours, note: weeklyNote } = weeklyData;

  const targetHours = settings?.weeklyTargetHours;

  if (!targetHours) {
    return (
      <div className="w-full max-w-md mx-auto mt-6 bg-white dark:bg-graphite p-5 rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 text-center text-sm text-gray-600 dark:text-gray-400">
        Set a weekly target in Settings to track your goal progress.
      </div>
    );
  }

  const progress = Math.min((weeklyHours / targetHours) * 100, 100);

  return (
    <div className="w-full max-w-md mx-auto mt-6 bg-white dark:bg-graphite p-5 rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-signal-dim dark:text-signal" />
          <h3 className="text-xs font-sans uppercase tracking-wide font-semibold text-gray-800 dark:text-gray-200">WEEKLY TARGET</h3>
        </div>
        <div className="text-sm font-mono tabular font-medium text-gray-600 dark:text-gray-400">
          <span className={weeklyHours >= targetHours ? "text-verdigris dark:text-emerald-400 font-bold" : "text-graphite dark:text-stone"}>
            {weeklyHours.toFixed(1)}
          </span> / {targetHours} hrs
        </div>
      </div>

      <div className="w-full bg-stone dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ease-out ${
            weeklyHours >= targetHours ? 'bg-verdigris' : 'bg-signal'
          }`}
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      {weeklyNote && (
        <p className="mt-2 text-xs font-mono tabular text-signal-dim dark:text-signal text-center">
          {weeklyNote}
        </p>
      )}

      {weeklyHours >= targetHours && (
        <p className="mt-3 text-xs text-verdigris dark:text-emerald-400 flex items-center gap-1 font-medium justify-center">
          <TrendingUp size={14} /> Target reached!
        </p>
      )}
    </div>
  );
};
