import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, addMonths, subMonths, isSameMonth, isToday, parseISO } from 'date-fns';
import { applyRounding } from '../utils/timeUtils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/Button';

export const TimesheetCalendarView: React.FC = () => {
  const { entries, settings } = useTimeTracker();
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
          <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const hours = getDayTotalHours(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          return (
            <div
              key={day.toISOString()}
              className={`min-h-[80px] p-2 border border-graphite/10 dark:border-white/10 rounded-md flex flex-col justify-between transition-colors ${!isCurrentMonth ? 'opacity-40 bg-gray-50 dark:bg-gray-800/20' : 'bg-stone dark:bg-graphite'} ${isToday(day) ? 'ring-2 ring-signal ring-inset' : ''} ${isCurrentMonth ? getIntensityColor(hours) : ''}`}
            >
              <div className={`text-sm font-medium ${isToday(day) ? 'text-signal' : 'text-gray-500 dark:text-gray-400'}`}>
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
    </div>
  );
};
