import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, parseISO, setHours, setMinutes, addSeconds } from 'date-fns';
import { applyRounding } from '../utils/timeUtils';
import { useToast } from '../context/ToastContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/Button';

const ADJUSTMENT_TAG = 'timesheet-adjustment';

export const TimesheetMatrixView: React.FC = () => {
  const { entries, timecodes, groups, settings, addManualEntry, updateEntry, deleteEntry } = useTimeTracker();
  const { addToast } = useToast();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const weekDays = eachDayOfInterval({
    start: currentWeekStart,
    end: endOfWeek(currentWeekStart, { weekStartsOn: 1 })
  });

  const activeTimecodes = timecodes.filter(t => !t.archived);
  const activeGroups = groups.filter(g => !g.archived);

  // Group timecodes by group
  const groupedTimecodes = activeGroups.map(g => ({
    ...g,
    timecodes: activeTimecodes.filter(t => t.groupId === g.id)
  })).filter(g => g.timecodes.length > 0);

  const unassignedTimecodes = activeTimecodes.filter(t => !t.groupId);
  if (unassignedTimecodes.length > 0) {
    groupedTimecodes.push({ id: 'unassigned', name: 'Unassigned', color: '#9ca3af', archived: false, updatedAt: '', timecodes: unassignedTimecodes });
  }

  const getCellEntries = (timecodeId: string, date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return entries.filter(e => e.timecodeId === timecodeId && format(parseISO(e.startTime), 'yyyy-MM-dd') === dateStr && !e.deletedAt);
  };

  const getCellHours = (timecodeId: string, date: Date) => {
    const cellEntries = getCellEntries(timecodeId, date);
    const totalSeconds = cellEntries.reduce((sum, e) => sum + e.duration, 0);
    return applyRounding(totalSeconds, settings?.roundingRule || 'none') / 3600;
  };

  const getRowTotalHours = (timecodeId: string) => {
    return weekDays.reduce((sum, day) => sum + getCellHours(timecodeId, day), 0);
  };

  const getColTotalHours = (date: Date) => {
    return activeTimecodes.reduce((sum, tc) => sum + getCellHours(tc.id, date), 0);
  };

  const getWeekTotalHours = () => {
    return activeTimecodes.reduce((sum, tc) => sum + getRowTotalHours(tc.id), 0);
  };

  const commitCell = async (timecodeId: string, day: Date, newHours: number) => {
    const existingEntriesForCell = getCellEntries(timecodeId, day);
    const trackedSeconds = existingEntriesForCell
      .filter(e => !e.tags?.includes(ADJUSTMENT_TAG))
      .reduce((sum, e) => sum + e.duration, 0);

    const targetSeconds = Math.round(newHours * 3600);
    const delta = targetSeconds - trackedSeconds;

    const existingAdjustment = existingEntriesForCell.find(e => e.tags?.includes(ADJUSTMENT_TAG));

    if (delta <= 0) {
      if (existingAdjustment) await deleteEntry(existingAdjustment.id);
      if (delta < 0) {
        addToast("Can't reduce below tracked time — edit or delete the underlying entries instead.", 'error');
      }
      return;
    }

    const start = setHours(setMinutes(day, 0), 12); // fixed 12:00 local anchor
    const end = addSeconds(start, delta);

    if (existingAdjustment) {
      await updateEntry(existingAdjustment.id, { startTime: start.toISOString(), endTime: end.toISOString() });
    } else {
      await addManualEntry({
        timecodeId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        note: 'Timesheet adjustment',
        tags: [ADJUSTMENT_TAG]
      });
    }
  };

  return (
    <div className="w-full overflow-x-auto pb-8">
      <div className="flex justify-between items-center mb-6 min-w-[800px]">
        <h2 className="text-xl font-semibold text-graphite dark:text-stone">
          Week of {format(currentWeekStart, 'MMM d, yyyy')}
        </h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))} aria-label="Previous week">
            <ChevronLeft size={20} />
          </Button>
          <Button variant="ghost" onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>This week</Button>
          <Button variant="ghost" onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))} aria-label="Next week">
            <ChevronRight size={20} />
          </Button>
        </div>
      </div>

      <div className="min-w-[800px] border border-graphite/10 dark:border-white/10 rounded-panel overflow-hidden bg-stone dark:bg-graphite">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-graphite/10 dark:border-white/10">
            <tr>
              <th className="px-4 py-3 font-semibold text-gray-500 w-1/4">Timecode</th>
              {weekDays.map(day => (
                <th key={day.toISOString()} className="px-2 py-3 font-semibold text-gray-500 text-center w-24">
                  <div>{format(day, 'EEE')}</div>
                  <div className="text-xs font-normal">{format(day, 'MMM d')}</div>
                </th>
              ))}
              <th className="px-4 py-3 font-bold text-graphite dark:text-stone text-right w-24">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-graphite/10 dark:divide-white/10">
            {groupedTimecodes.map(group => (
              <React.Fragment key={group.id}>
                {group.id !== 'unassigned' && (
                  <tr className="bg-gray-50/50 dark:bg-gray-800/30">
                    <td colSpan={9} className="px-4 py-2 font-medium text-xs uppercase tracking-wider text-gray-500 flex items-center">
                      <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: group.color }}></div>
                      {group.name}
                    </td>
                  </tr>
                )}
                {group.timecodes.map(tc => (
                  <tr key={tc.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-graphite dark:text-stone flex items-center">
                      {group.id === 'unassigned' && <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: tc.color || '#9ca3af' }}></div>}
                      {tc.name}
                    </td>
                    {weekDays.map(day => (
                      <td key={day.toISOString()} className="px-1 py-1 align-middle">
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          defaultValue={getCellHours(tc.id, day) || ''}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              commitCell(tc.id, day, val);
                            } else if (e.target.value === '') {
                              commitCell(tc.id, day, 0);
                            }
                          }}
                          className="w-full text-center p-1.5 bg-transparent border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-signal focus:ring-1 focus:ring-signal rounded tabular-nums focus:outline-none focus:bg-white dark:focus:bg-gray-700 transition-all text-graphite dark:text-stone"
                          placeholder="-"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-graphite dark:text-stone bg-gray-50/30 dark:bg-gray-800/20">
                      {getRowTotalHours(tc.id).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-800/50 border-t border-graphite/20 dark:border-white/20">
            <tr>
              <td className="px-4 py-3 font-bold text-graphite dark:text-stone">Total</td>
              {weekDays.map(day => (
                <td key={day.toISOString()} className="px-2 py-3 text-center font-bold tabular-nums text-graphite dark:text-stone">
                  {getColTotalHours(day).toFixed(2)}
                </td>
              ))}
              <td className="px-4 py-3 text-right font-bold tabular-nums text-signal">
                {getWeekTotalHours().toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
