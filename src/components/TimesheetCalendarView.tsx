import React, { useMemo, useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, addMonths, subMonths, isSameMonth, isToday, parseISO } from 'date-fns';
import { buildLinesFromSettings, displaySecondsFor, secondsFor } from '../utils/billing';
import { formatDurationShort, roundCurrency } from '../utils/timeUtils';
import { useNowTick } from '../hooks/useNowTick';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/Button';

export const TimesheetCalendarView: React.FC = () => {
  const { entries, settings, timecodes } = useTimeTracker();
  const [currentDate, setCurrentDate] = useState(new Date());

  const firstDayOfMonth = startOfMonth(currentDate);
  const lastDayOfMonth = endOfMonth(currentDate);
  const startDate = startOfWeek(firstDayOfMonth, { weekStartsOn: 1 });
  const endDate = endOfWeek(lastDayOfMonth, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  // A running timer's stored `duration` is 0 until it stops, so today's square
  // stayed empty while time was being tracked into it.
  const hasRunningEntry = entries.some(e => !e.endTime && !e.deletedAt);
  const nowMs = useNowTick(hasRunningEntry);

  const gridStartStr = format(startDate, 'yyyy-MM-dd');
  const gridEndStr = format(endDate, 'yyyy-MM-dd');

  // Built once for the whole visible grid, from the same helper the report, the
  // entry list and the timesheet grid use, rather than re-rounding a sum of the
  // stored `duration` per square.
  const { billableLines, hoursByDay, feesByDay } = useMemo(() => {
    const visible: typeof entries = [];
    for (const e of entries) {
      if (e.deletedAt) continue;
      const dayStr = format(parseISO(e.startTime), 'yyyy-MM-dd');
      if (dayStr >= gridStartStr && dayStr <= gridEndStr) visible.push(e);
    }

    // scopeWindow is null: the calendar is not a report, so it names no
    // reporting period. Rounding a month-wide bucket here gave a different
    // figure for a day than the week grid on the tab beside it. 'timecode' and
    // 'invoice' scope degrade to 'day'.
    const lines = buildLinesFromSettings(visible, settings, {
      scopeWindow: null,
      now: new Date(nowMs),
    });

    const byDay = new Map<string, number>();
    // A flat fee bills as a fee, so its time on the clock adds nothing to the
    // square's total — a day of fee work reads as empty. The square cannot show
    // that time without disagreeing with every other total, so it carries a
    // marker instead, and the marker names the time and the fee behind it.
    const fees = new Map<string, { seconds: number; amount: number; count: number }>();
    for (const e of visible) {
      const dayStr = format(parseISO(e.startTime), 'yyyy-MM-dd');
      byDay.set(dayStr, (byDay.get(dayStr) || 0) + secondsFor(lines, e.id));

      const line = lines.get(e.id);
      if (!line?.isFixedCost) continue;
      const running = fees.get(dayStr) || { seconds: 0, amount: 0, count: 0 };
      running.seconds += line.workedSeconds;
      running.amount += line.amount;
      running.count += 1;
      fees.set(dayStr, running);
    }
    return { billableLines: lines, hoursByDay: byDay, feesByDay: fees };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, settings, gridStartStr, gridEndStr, nowMs]);

  const getDayTotalHours = (date: Date) => (hoursByDay.get(format(date, 'yyyy-MM-dd')) || 0) / 3600;

  const currencySymbol = settings?.currencySymbol || '$';

  const getDayFeeNote = (date: Date): string | null => {
    const fee = feesByDay.get(format(date, 'yyyy-MM-dd'));
    if (!fee) return null;
    const label = fee.count === 1 ? 'a flat fee' : `${fee.count} flat fees`;
    const amount = `${currencySymbol}${roundCurrency(fee.amount).toFixed(2)}`;
    return fee.seconds > 0
      ? `${formatDurationShort(fee.seconds)} on the clock bills as ${label} of ${amount}, so it adds no hours here.`
      : `${label.charAt(0).toUpperCase()}${label.slice(1)} of ${amount} on this day. A fee bills no hours.`;
  };

  const weeklyTarget = settings?.weeklyTargetHours || 40;
  const dailyTarget = weeklyTarget / 5;

  const getIntensityColor = (hours: number) => {
    if (hours === 0) return 'bg-transparent';
    const ratio = hours / dailyTarget;
    if (ratio >= 1) return 'bg-verdigris/80 text-white';
    if (ratio >= 0.75) return 'bg-verdigris/60 text-white';
    if (ratio >= 0.5) return 'bg-verdigris/40 text-graphite dark:text-stone';
    if (ratio >= 0.25) return 'bg-verdigris/20 text-graphite dark:text-stone';
    return 'bg-verdigris/10 text-graphite dark:text-stone';
  };

  const [selectedDayEntries, setSelectedDayEntries] = useState<Date | null>(null);

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-graphite dark:text-stone">
          {format(currentDate, 'MMMM yyyy')}
        </h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setCurrentDate(subMonths(currentDate, 1))} aria-label="Previous month">
            <ChevronLeft size={20} />
          </Button>
          <Button variant="ghost" onClick={() => setCurrentDate(new Date())}>Today</Button>
          <Button variant="ghost" onClick={() => setCurrentDate(addMonths(currentDate, 1))} aria-label="Next month">
            <ChevronRight size={20} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
          <div key={day} className="text-center text-sm font-medium text-gray-600 dark:text-gray-400 py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const hours = getDayTotalHours(day);
          const feeNote = getDayFeeNote(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isSelected = selectedDayEntries && format(day, 'yyyy-MM-dd') === format(selectedDayEntries, 'yyyy-MM-dd');
          return (
            <div
              key={day.toISOString()}
              onClick={() => setSelectedDayEntries(isSelected ? null : day)}
              className={`min-h-[80px] p-2 border rounded-md flex flex-col justify-between transition-colors cursor-pointer hover:border-signal/50 ${isSelected ? 'border-signal ring-1 ring-signal' : 'border-graphite/20 dark:border-white/20'} ${!isCurrentMonth ? 'opacity-40 bg-gray-50 dark:bg-gray-800/20' : 'bg-white dark:bg-graphite'} ${isToday(day) && !isSelected ? 'ring-2 ring-signal ring-inset' : ''} ${isCurrentMonth ? getIntensityColor(hours) : ''}`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className={`text-sm font-medium ${isToday(day) ? 'text-signal-dim dark:text-signal' : 'text-gray-600 dark:text-gray-400'}`}>
                  {format(day, 'd')}
                </div>
                {feeNote && (
                  <span
                    role="img"
                    className="text-xs font-bold leading-none text-rust dark:text-orange-300"
                    title={feeNote}
                    aria-label={feeNote}
                  >
                    &bull;
                  </span>
                )}
              </div>
              {hours > 0 && (
                <div className="text-sm font-semibold tabular-nums text-right">
                  {hours.toFixed(2)}h
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedDayEntries && (() => {
        const dayEntries = entries.filter(e => !e.deletedAt && format(parseISO(e.startTime), 'yyyy-MM-dd') === format(selectedDayEntries, 'yyyy-MM-dd'));
        return (
          <div className="mt-6 p-4 bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-panel">
            <h3 className="text-lg font-semibold text-graphite dark:text-stone mb-4 flex justify-between items-center">
              <span>Entries for {format(selectedDayEntries, 'MMMM d, yyyy')}</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedDayEntries(null)}>Close</Button>
            </h3>
            <div className="space-y-2">
              {dayEntries.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400 italic">No entries for this day.</p>
              ) : (
                dayEntries.map(entry => {
                  const tc = timecodes.find(t => t.id === entry.timecodeId);
                  return (
                    <div key={entry.id} className="flex justify-between items-center bg-stone dark:bg-gray-800/30 p-2 rounded text-sm border border-graphite/10 dark:border-white/10">
                      <div className="flex flex-col">
                        <span className="font-medium text-graphite dark:text-stone flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tc?.color || '#9ca3af' }} />
                          {tc?.name ?? 'Unknown'}
                        </span>
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {format(parseISO(entry.startTime), 'h:mm a')} - {entry.endTime ? format(parseISO(entry.endTime), 'h:mm a') : 'Now'}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </span>
                      </div>
                      <span className="font-mono text-gray-600 dark:text-gray-300">
                        {(displaySecondsFor(billableLines, entry.id) / 3600).toFixed(2)}h
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
