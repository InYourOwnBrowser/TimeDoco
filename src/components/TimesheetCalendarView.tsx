import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, addMonths, subMonths, isSameMonth, isToday, parseISO } from 'date-fns';
import { applyRounding } from '../utils/timeUtils';
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

  const getDayTotalHours = (date: Date) => {
    const dayStr = format(date, 'yyyy-MM-dd');
    const dayEntries = entries.filter(e => format(parseISO(e.startTime), 'yyyy-MM-dd') === dayStr);
    const totalSeconds = dayEntries.reduce((sum, e) => sum + e.duration, 0);
    const roundedSeconds = applyRounding(totalSeconds, settings?.roundingRule || 'none');
    return roundedSeconds / 3600;
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
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isSelected = selectedDayEntries && format(day, 'yyyy-MM-dd') === format(selectedDayEntries, 'yyyy-MM-dd');
          return (
            <div
              key={day.toISOString()}
              onClick={() => setSelectedDayEntries(isSelected ? null : day)}
              className={`min-h-[80px] p-2 border rounded-md flex flex-col justify-between transition-colors cursor-pointer hover:border-signal/50 ${isSelected ? 'border-signal ring-1 ring-signal' : 'border-graphite/20 dark:border-white/20'} ${!isCurrentMonth ? 'opacity-40 bg-gray-50 dark:bg-gray-800/20' : 'bg-white dark:bg-graphite'} ${isToday(day) && !isSelected ? 'ring-2 ring-signal ring-inset' : ''} ${isCurrentMonth ? getIntensityColor(hours) : ''}`}
            >
              <div className={`text-sm font-medium ${isToday(day) ? 'text-signal-dim dark:text-signal' : 'text-gray-600 dark:text-gray-400'}`}>
                {format(day, 'd')}
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
        const dayEntries = entries.filter(e => format(parseISO(e.startTime), 'yyyy-MM-dd') === format(selectedDayEntries, 'yyyy-MM-dd'));
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
                        {(applyRounding(entry.duration, settings?.roundingRule || 'none') / 3600).toFixed(2)}h
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
