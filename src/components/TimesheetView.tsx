import React, { useState } from 'react';
import { TimesheetCalendarView } from './TimesheetCalendarView';
import { TimesheetMatrixView } from './TimesheetMatrixView';
import { CalendarDays, Grid3x3 } from 'lucide-react';
import { Button } from './ui/Button';

export const TimesheetView: React.FC = () => {
  const [viewMode, setViewMode] = useState<'calendar' | 'matrix'>('calendar');

  return (
    <div className="w-full max-w-5xl mx-auto pb-16">
      <div className="flex justify-between items-end mb-8 border-b border-graphite/10 dark:border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-graphite dark:text-stone mb-1">Timesheet</h1>
          <p className="text-sm text-gray-500">Overview and manual time entry</p>
        </div>
        <div className="flex bg-stone dark:bg-ink p-1 rounded-panel border border-graphite/10 dark:border-white/10 shadow-inner">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode('calendar')}
            className={viewMode === 'calendar' ? 'bg-signal/10 text-signal' : 'text-gray-500'}
          >
            <CalendarDays size={16} className="mr-2" />
            Calendar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode('matrix')}
            className={viewMode === 'matrix' ? 'bg-signal/10 text-signal' : 'text-gray-500'}
          >
            <Grid3x3 size={16} className="mr-2" />
            Matrix
          </Button>
        </div>
      </div>

      {viewMode === 'calendar' ? <TimesheetCalendarView /> : <TimesheetMatrixView />}
    </div>
  );
};
