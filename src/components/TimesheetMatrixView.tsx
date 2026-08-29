import React, { useState, useEffect, useMemo } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, parseISO, setHours, setMinutes, addSeconds } from 'date-fns';
import { applyRounding } from '../utils/timeUtils';
import { useToast } from '../context/ToastContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/Button';
import { Panel } from './ui/Panel';

const ADJUSTMENT_TAG = 'timesheet-adjustment';

export const TimesheetMatrixView: React.FC = () => {
  const { entries, timecodes, groups, settings, addManualEntry, updateEntry, deleteEntry } = useTimeTracker();
  const { addToast } = useToast();
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const [manuallyShownIds, setManuallyShownIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setManuallyShownIds(new Set()); // reset when navigating to a different week
  }, [currentWeekStart]);

  const weekDays = useMemo(() => eachDayOfInterval({
    start: currentWeekStart,
    end: endOfWeek(currentWeekStart, { weekStartsOn: 1 })
  }), [currentWeekStart]);

  const activeTimecodes = useMemo(() => timecodes.filter(t => !t.archived), [timecodes]);
  const activeGroups = useMemo(() => groups.filter(g => !g.archived), [groups]);

  const entriesByTimecodeAndDate = useMemo(() => {
    const map = new Map<string, typeof entries>();
    for (const e of entries) {
      if (e.deletedAt) continue;
      const dateStr = format(parseISO(e.startTime), 'yyyy-MM-dd');
      const key = `${e.timecodeId}|${dateStr}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [entries]);

  const cellHoursMap = useMemo(() => {
    const map = new Map<string, number>();
    const roundingRule = settings?.roundingRule || 'none';
    for (const tc of activeTimecodes) {
      for (const day of weekDays) {
        const dateStr = format(day, 'yyyy-MM-dd');
        const key = `${tc.id}|${dateStr}`;
        const cellEntries = entriesByTimecodeAndDate.get(key) || [];
        const totalSeconds = cellEntries.reduce((sum, e) => sum + e.duration, 0);
        map.set(key, applyRounding(totalSeconds, roundingRule) / 3600);
      }
    }
    return map;
  }, [activeTimecodes, weekDays, entriesByTimecodeAndDate, settings?.roundingRule]);

  const rowTotalHoursMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const tc of activeTimecodes) {
      let sum = 0;
      for (const day of weekDays) {
        const dateStr = format(day, 'yyyy-MM-dd');
        sum += cellHoursMap.get(`${tc.id}|${dateStr}`) || 0;
      }
      map.set(tc.id, sum);
    }
    return map;
  }, [activeTimecodes, weekDays, cellHoursMap]);

  const getCellEntries = (timecodeId: string, date: Date) =>
    entriesByTimecodeAndDate.get(`${timecodeId}|${format(date, 'yyyy-MM-dd')}`) || [];

  const getCellHours = (timecodeId: string, date: Date) =>
    cellHoursMap.get(`${timecodeId}|${format(date, 'yyyy-MM-dd')}`) || 0;

  const getRowTotalHours = (timecodeId: string) =>
    rowTotalHoursMap.get(timecodeId) || 0;

  const isVisible = (tcId: string) => getRowTotalHours(tcId) > 0 || manuallyShownIds.has(tcId);

  // Group timecodes by group
  const groupedTimecodes = activeGroups.map(g => ({
    ...g,
    timecodes: activeTimecodes.filter(t => t.groupId === g.id && isVisible(t.id))
  })).filter(g => g.timecodes.length > 0);

  const unassignedTimecodes = activeTimecodes.filter(t => !t.groupId && isVisible(t.id));
  if (unassignedTimecodes.length > 0) {
    groupedTimecodes.push({ id: 'unassigned', name: 'Unassigned', color: '#9ca3af', archived: false, updatedAt: '', timecodes: unassignedTimecodes });
  }

  const hiddenTimecodes = activeTimecodes.filter(t => !isVisible(t.id));

  const getColTotalHours = (date: Date) => {
    return activeTimecodes.reduce((sum, tc) => sum + getCellHours(tc.id, date), 0);
  };

  const displayHours = (n: number) => (n > 0 ? n.toFixed(2) : '');

  const getWeekTotalHours = () => {
    return activeTimecodes.reduce((sum, tc) => sum + getRowTotalHours(tc.id), 0);
  };

  const commitCell = async (timecodeId: string, day: Date, newHours: number) => {
    const existingEntriesForCell = getCellEntries(timecodeId, day);
    const rawTrackedSeconds = existingEntriesForCell
      .filter(e => !e.tags?.includes(ADJUSTMENT_TAG))
      .reduce((sum, e) => sum + e.duration, 0);
    const trackedSeconds = applyRounding(rawTrackedSeconds, settings?.roundingRule || 'none');

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

      <Panel className="min-w-[800px] overflow-hidden border border-graphite/20 dark:border-white/20">
        <table className="w-full text-sm text-left">
          <thead className="bg-stone/80 dark:bg-gray-800/50 border-b border-graphite/20 dark:border-white/20">
            <tr>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 w-1/4">Timecode</th>
              {weekDays.map(day => (
                <th key={day.toISOString()} className="px-2 py-3 font-semibold text-gray-600 dark:text-gray-400 text-center w-24">
                  <div>{format(day, 'EEE')}</div>
                  <div className="text-xs font-normal text-gray-600 dark:text-gray-400">{format(day, 'MMM d')}</div>
                </th>
              ))}
              <th className="px-4 py-3 font-bold text-graphite dark:text-stone text-right w-24">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-graphite/20 dark:divide-white/20">
            {groupedTimecodes.map(group => (
              <React.Fragment key={group.id}>
                {group.id !== 'unassigned' && (
                  <tr className="bg-stone/40 dark:bg-gray-800/30">
                    <td colSpan={9} className="px-4 py-2 font-medium text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400 flex items-center">
                      <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: group.color }}></div>
                      {group.name}
                    </td>
                  </tr>
                )}
                {group.timecodes.map(tc => (
                  <tr key={tc.id} className="hover:bg-stone/60 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-graphite dark:text-stone flex items-center">
                      {group.id === 'unassigned' && <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: tc.color || '#9ca3af' }}></div>}
                      {tc.name}
                    </td>
                    {weekDays.map(day => (
                      <td key={day.toISOString()} className="px-1 py-1 align-middle">
                        <input
                          key={`${tc.id}-${day.toISOString()}-${getCellHours(tc.id, day)}`}
                          type="number"
                          step="0.25"
                          min="0"
                          defaultValue={displayHours(getCellHours(tc.id, day))}
                          onBlur={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                              commitCell(tc.id, day, val);
                            } else if (e.target.value === '') {
                              commitCell(tc.id, day, 0);
                            }
                          }}
                          className="w-full text-center p-1.5 bg-transparent border border-transparent hover:border-graphite/20 dark:hover:border-white/20 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite rounded tabular-nums focus:outline-none focus:bg-white dark:focus:bg-graphite transition-all text-graphite dark:text-stone"
                          placeholder="-"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-graphite dark:text-stone bg-stone/30 dark:bg-gray-800/20">
                      {getRowTotalHours(tc.id).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot className="bg-stone/80 dark:bg-gray-800/50 border-t border-graphite/20 dark:border-white/20">
            <tr>
              <td className="px-4 py-3 font-bold text-graphite dark:text-stone">Total</td>
              {weekDays.map(day => (
                <td key={day.toISOString()} className="px-2 py-3 text-center font-bold tabular-nums text-graphite dark:text-stone">
                  {getColTotalHours(day).toFixed(2)}
                </td>
              ))}
              <td className="px-4 py-3 text-right font-bold tabular-nums text-signal-dim dark:text-signal">
                {getWeekTotalHours().toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </Panel>
      {hiddenTimecodes.length > 0 && (
        <div className="mt-3 min-w-[800px]">
          <select
            value=""
            onChange={(e) => { if (e.target.value) setManuallyShownIds(prev => new Set(prev).add(e.target.value)); }}
            className="text-sm px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone"
          >
            <option value="">+ Add a timecode to this week…</option>
            {hiddenTimecodes.map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
          </select>
        </div>
      )}
    </div>
  );
};
