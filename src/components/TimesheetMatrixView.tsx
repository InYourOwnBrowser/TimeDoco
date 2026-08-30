import React, { useState, useEffect, useMemo } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, parseISO } from 'date-fns';
import { buildScreenLines, secondsFor, workedSecondsFor } from '../utils/billing';
import { applyRounding, findFreeSlot, formatDurationShort, roundCurrency } from '../utils/timeUtils';
import { useNowTick } from '../hooks/useNowTick';
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

  const currentWeekEnd = useMemo(() => endOfWeek(currentWeekStart, { weekStartsOn: 1 }), [currentWeekStart]);

  const weekDays = useMemo(() => eachDayOfInterval({
    start: currentWeekStart,
    end: currentWeekEnd
  }), [currentWeekStart, currentWeekEnd]);

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

  // A running timer's stored `duration` is 0 until it stops, so the grid used
  // to show a blank cell for time being tracked right now.
  const hasRunningEntry = entries.some(e => !e.endTime && !e.deletedAt);
  const nowMs = useNowTick(hasRunningEntry);

  const weekDateStrings = useMemo(() => weekDays.map(day => format(day, 'yyyy-MM-dd')), [weekDays]);

  const weekEntries = useMemo(() => {
    const inWeek = new Set(weekDateStrings);
    return entries.filter(e => !e.deletedAt && inWeek.has(format(parseISO(e.startTime), 'yyyy-MM-dd')));
  }, [entries, weekDateStrings]);

  const weekTimecodeIdsWithEntries = useMemo(() => {
    const set = new Set<string>();
    for (const e of weekEntries) {
      set.add(e.timecodeId);
    }
    return set;
  }, [weekEntries]);

  const gridTimecodes = useMemo(() => {
    return timecodes.filter(t => !t.archived || weekTimecodeIdsWithEntries.has(t.id));
  }, [timecodes, weekTimecodeIdsWithEntries]);

  const gridGroups = useMemo(() => {
    const activeGroupIds = new Set(groups.filter(g => !g.archived).map(g => g.id));
    const groupsInUse = new Set(gridTimecodes.map(t => t.groupId).filter(Boolean) as string[]);
    return groups.filter(g => activeGroupIds.has(g.id) || groupsInUse.has(g.id));
  }, [groups, gridTimecodes]);

  // One set of billable lines for the whole visible week, shared with the
  // report and the entry list. Summing the stored `duration` and rounding each
  // cell separately gave a grid that ignored the rounding scope and disagreed
  // with every other view; sharing out one scope-aware figure keeps the cells,
  // the row totals and the week total reconciling with each other.
  // scopeWindow is null: the grid is not a report, so it names no reporting
  // period. Naming the visible week made an entry's billable minutes depend on
  // how much time the screen happened to be showing, and the calendar tab
  // beside it — same days, a month-wide window — gave a different figure for
  // the same day. 'timecode' and 'invoice' scope degrade to 'day' here.
  const billableLines = useMemo(
    () => buildScreenLines(weekEntries, settings, {
      now: new Date(nowMs),
    }),
    [weekEntries, settings, nowMs]
  );

  const cellHoursMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const tc of gridTimecodes) {
      for (const dateStr of weekDateStrings) {
        const key = `${tc.id}|${dateStr}`;
        const cellEntries = entriesByTimecodeAndDate.get(key) || [];
        const totalSeconds = cellEntries.reduce((sum, e) => sum + secondsFor(billableLines, e.id), 0);
        map.set(key, totalSeconds / 3600);
      }
    }
    return map;
  }, [gridTimecodes, weekDateStrings, entriesByTimecodeAndDate, billableLines]);

  // A flat fee bills as a fee, so it contributes no hours and a cell holding
  // only fee work reads as blank — the grid cannot print those hours without
  // disagreeing with the report and every other total. It carries a marker
  // instead, naming the time on the clock and the fee that replaced it, so the
  // blank is disclosed rather than silent.
  const cellFeesMap = useMemo(() => {
    const map = new Map<string, { seconds: number; amount: number; count: number }>();
    for (const tc of gridTimecodes) {
      for (const dateStr of weekDateStrings) {
        const key = `${tc.id}|${dateStr}`;
        const cellEntries = entriesByTimecodeAndDate.get(key) || [];
        let seconds = 0;
        let amount = 0;
        let count = 0;
        for (const e of cellEntries) {
          const line = billableLines.get(e.id);
          if (!line?.isFixedCost) continue;
          seconds += line.workedSeconds;
          amount += line.amount;
          count += 1;
        }
        if (count > 0) map.set(key, { seconds, amount, count });
      }
    }
    return map;
  }, [gridTimecodes, weekDateStrings, entriesByTimecodeAndDate, billableLines]);

  const currencySymbol = settings?.currencySymbol || '$';

  const getCellFeeNote = (timecodeId: string, date: Date): string | null => {
    const fee = cellFeesMap.get(`${timecodeId}|${format(date, 'yyyy-MM-dd')}`);
    if (!fee) return null;
    const label = fee.count === 1 ? 'a flat fee' : `${fee.count} flat fees`;
    const amount = `${currencySymbol}${roundCurrency(fee.amount).toFixed(2)}`;
    return fee.seconds > 0
      ? `${formatDurationShort(fee.seconds)} on the clock bills as ${label} of ${amount}, so it adds no hours to this cell.`
      : `${label.charAt(0).toUpperCase()}${label.slice(1)} of ${amount} on this day. A fee bills no hours.`;
  };

  const hasFeeInWeek = (timecodeId: string) =>
    weekDateStrings.some(dateStr => cellFeesMap.has(`${timecodeId}|${dateStr}`));

  const rowTotalHoursMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const tc of gridTimecodes) {
      let sum = 0;
      for (const day of weekDays) {
        const dateStr = format(day, 'yyyy-MM-dd');
        sum += cellHoursMap.get(`${tc.id}|${dateStr}`) || 0;
      }
      map.set(tc.id, sum);
    }
    return map;
  }, [gridTimecodes, weekDays, cellHoursMap]);

  const getCellEntries = (timecodeId: string, date: Date) =>
    entriesByTimecodeAndDate.get(`${timecodeId}|${format(date, 'yyyy-MM-dd')}`) || [];

  const getCellHours = (timecodeId: string, date: Date) =>
    cellHoursMap.get(`${timecodeId}|${format(date, 'yyyy-MM-dd')}`) || 0;

  const getRowTotalHours = (timecodeId: string) =>
    rowTotalHoursMap.get(timecodeId) || 0;

  const isVisible = (tcId: string) => getRowTotalHours(tcId) > 0 || hasFeeInWeek(tcId) || manuallyShownIds.has(tcId);

  // Group timecodes by group
  const groupedTimecodes = gridGroups.map(g => ({
    ...g,
    timecodes: gridTimecodes.filter(t => t.groupId === g.id && isVisible(t.id))
  })).filter(g => g.timecodes.length > 0);

  const unassignedTimecodes = gridTimecodes.filter(t => !t.groupId && isVisible(t.id));
  if (unassignedTimecodes.length > 0) {
    groupedTimecodes.push({ id: 'unassigned', name: 'Unassigned', color: '#9ca3af', archived: false, updatedAt: '', timecodes: unassignedTimecodes });
  }

  const hiddenTimecodes = timecodes.filter(t => !t.archived && !isVisible(t.id));

  const getColTotalHours = (date: Date) => {
    return gridTimecodes.reduce((sum, tc) => sum + getCellHours(tc.id, date), 0);
  };

  const displayHours = (n: number) => (n > 0 ? n.toFixed(2) : '');

  const getWeekTotalHours = () => {
    return gridTimecodes.reduce((sum, tc) => sum + getRowTotalHours(tc.id), 0);
  };

  // Half of the 0.01h the cell prints. The displayed value never round-trips to
  // the exact second, so re-committing the number already on screen has to read
  // as "unchanged" — otherwise it either invents a phantom adjustment or
  // reports an impossible reduction.
  const CELL_DISPLAY_TOLERANCE_SECONDS = 18;

  const commitCell = async (timecodeId: string, day: Date, newHours: number) => {
    const existingEntriesForCell = getCellEntries(timecodeId, day);
    const cellSeconds = existingEntriesForCell.reduce((sum, e) => sum + secondsFor(billableLines, e.id), 0);
    const rawEntries = existingEntriesForCell.filter(e => !e.tags?.includes(ADJUSTMENT_TAG));
    const rawBillableLines = buildScreenLines(rawEntries, settings, {
      now: new Date(nowMs),
    });
    const rawBilledSeconds = rawEntries.reduce((sum, e) => sum + secondsFor(rawBillableLines, e.id), 0);
    const trackedSeconds = rawEntries.reduce((sum, e) => sum + workedSecondsFor(rawBillableLines, e.id), 0);

    const targetSeconds = Math.round(newHours * 3600);
    if (Math.abs(targetSeconds - cellSeconds) < CELL_DISPLAY_TOLERANCE_SECONDS) return;

    const existingAdjustment = existingEntriesForCell.find(e => e.tags?.includes(ADJUSTMENT_TAG));

    if (targetSeconds < rawBilledSeconds) {
      addToast("Can't reduce below tracked time — edit or delete the underlying entries instead.", 'error');
      return;
    }

    const delta = targetSeconds - rawBilledSeconds;
    const roundingRule = settings?.roundingRule || 'none';
    if (delta > 0 && roundingRule !== 'none') {
      const reroundedSeconds = applyRounding(trackedSeconds + delta, roundingRule);
      if (reroundedSeconds === rawBilledSeconds) {
        addToast('Due to rounding, this edit would not change the displayed hours.', 'info');
        return;
      }
      if (Math.abs(reroundedSeconds - targetSeconds) >= CELL_DISPLAY_TOLERANCE_SECONDS) {
        addToast(`Due to rounding (${roundingRule}), cell display will round to ${(reroundedSeconds / 3600).toFixed(2)}h.`, 'info');
      }
    }

    if (delta <= 0) {
      if (existingAdjustment) {
        await deleteEntry(existingAdjustment.id);
        addToast('Timesheet adjustment removed.', 'info');
      }
      return;
    }

    const slot = findFreeSlot(
      day,
      delta,
      entries,
      existingAdjustment?.id,
      timecodeId,
      settings?.allowConcurrentTimers
    );

    if (!slot) {
      addToast('No free time left on this day — edit the underlying entries instead.', 'error');
      return;
    }
    const { start, end } = slot;

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
                    {weekDays.map(day => {
                      const feeNote = getCellFeeNote(tc.id, day);
                      return (
                        <td key={day.toISOString()} className="px-1 py-1 align-middle">
                          <div className="relative">
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
                            {feeNote && (
                              <span
                                role="img"
                                className="pointer-events-none absolute top-0 right-0.5 text-xs font-bold leading-none text-rust dark:text-orange-300"
                                title={feeNote}
                                aria-label={feeNote}
                              >
                                &bull;
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
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
      <p className="mt-2 text-xs font-mono tabular text-gray-500 dark:text-gray-400 min-w-[800px]">
        Note: Cells display billed time (reflecting any rounding rule). Cell edits are applied to worked time by creating or adjusting an entry.
      </p>
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
