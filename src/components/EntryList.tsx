import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, parseISO, subDays } from 'date-fns';
import { Clock, FileEdit, Trash2, Scissors } from 'lucide-react';
import { GroupedVirtuoso } from 'react-virtuoso';
import { EntryEditModal } from './EntryEditModal';
import { EntrySplitModal } from './EntrySplitModal';
import { ManualEntryModal } from './ManualEntryModal';
import { Modal } from './ui/Modal';
import type { Entry } from '../types';
import { getElapsedTimeMs, formatDurationShort } from '../utils/timeUtils';
import { buildScreenLines, displaySecondsFor, secondsFor, workedSecondsFor, workedVsBilledNote } from '../utils/billing';
import { useNowTick } from '../hooks/useNowTick';

const LiveEntryDuration: React.FC<{ entry: Entry, formatDuration: (s: number) => string }> = ({ entry, formatDuration }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const updateElapsed = () => {
      setElapsed(Math.floor(getElapsedTimeMs(entry.startTime, entry.pausedSegments) / 1000));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [entry.startTime, entry.pausedSegments]);

  return <>{formatDuration(elapsed)}</>;
};

// Live-updating "vs estimate" label for a currently-running entry.
const LiveEstimateComparison: React.FC<{ entry: Entry, expectedSeconds: number }> = ({ entry, expectedSeconds }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const updateElapsed = () => {
      setElapsed(Math.floor(getElapsedTimeMs(entry.startTime, entry.pausedSegments) / 1000));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [entry.startTime, entry.pausedSegments]);

  const over = elapsed > expectedSeconds;
  return (
    <span className={over ? 'text-rust font-medium' : 'text-gray-500 dark:text-gray-400'}>
      Est. {formatDurationShort(expectedSeconds)}
      {over ? ` · ${formatDurationShort(elapsed - expectedSeconds)} over` : ''}
    </span>
  );
};

// Static "estimate vs actual" label for a completed entry.
const EstimateComparison: React.FC<{ entry: Entry, expectedSeconds: number, actualSeconds: number }> = ({ expectedSeconds, actualSeconds }) => {
  const diff = actualSeconds - expectedSeconds;
  const over = diff > 0;
  const under = diff < 0;
  return (
    <span className={over ? 'text-rust' : under ? 'text-verdigris dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}>
      Est. {formatDurationShort(expectedSeconds)}
      {diff !== 0 ? ` · ${formatDurationShort(Math.abs(diff))} ${over ? 'over' : 'under'}` : ' · on target'}
    </span>
  );
};

export const EntryList: React.FC = () => {
  const { entries, timecodes, groups, deleteEntry, bulkDeleteEntries, settings } = useTimeTracker();
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [splittingEntry, setSplittingEntry] = useState<Entry | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const timecodeMap = React.useMemo(() => new Map(timecodes.map(t => [t.id, t])), [timecodes]);

  const getTimecodeName = React.useCallback((id: string) => {
    const tc = timecodeMap.get(id);
    return tc ? tc.name : 'Unknown';
  }, [timecodeMap]);

  const getTimecodeColor = React.useCallback((id: string) => {
    const tc = timecodeMap.get(id);
    return tc?.color || '#3b82f6';
  }, [timecodeMap]);

  const filteredEntries = React.useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    return entries.filter((entry) => {
      const tc = timecodeMap.get(entry.timecodeId);
      const tcName = tc ? tc.name : 'Unknown';

      const matchesSearch = searchTerm === '' ||
        (entry.note?.toLowerCase().includes(searchLower)) ||
        (tcName.toLowerCase().includes(searchLower));

      let matchesFilter = true;
      if (selectedFilter.startsWith('group:')) {
        const groupId = selectedFilter.slice(6);
        matchesFilter = tc?.groupId === groupId;
      } else if (selectedFilter.startsWith('timecode:')) {
        const timecodeId = selectedFilter.slice(9);
        matchesFilter = entry.timecodeId === timecodeId;
      }

      const entryDate = format(parseISO(entry.startTime), 'yyyy-MM-dd');
      const matchesFrom = !dateFrom || entryDate >= dateFrom;
      const matchesTo = !dateTo || entryDate <= dateTo;

      return matchesSearch && matchesFilter && matchesFrom && matchesTo;
    });
  }, [entries, timecodeMap, searchTerm, selectedFilter, dateFrom, dateTo]);

  const nonDeletedEntries = React.useMemo(() => entries.filter(e => !e.deletedAt), [entries]);

  // A running timer's stored `duration` is 0 until it stops, so the list used
  // to leave it out of both the row and the total. Measuring to `now` counts it,
  // and refreshing that on a tick keeps it current while it runs.
  const hasRunningEntry = nonDeletedEntries.some(e => !e.endTime);
  const nowMs = useNowTick(hasRunningEntry);

  // The same lines the report and the timesheet are built from, so an entry
  // cannot show one duration here and another there. `dateRange` is null: this
  // list files each entry under the day it started rather than clipping to a
  // window. Computed over all non-deleted entries so filtering/search does not
  // alter bucket rounding.
  // scopeWindow is explicitly null: this list has no reporting period, it shows
  // all time. At 'timecode' or 'invoice' scope that would make the bucket the
  // user's entire history, so an entry's billable minutes would shift whenever
  // an unrelated entry was recorded months later. buildScreenLines
  // degrades those two scopes to 'day' here — see `effectiveRoundingScope`.
  const billableLines = React.useMemo(
    () => buildScreenLines(nonDeletedEntries, settings, { now: new Date(nowMs) }),
    [nonDeletedEntries, settings, nowMs]
  );

  const handleClearFilters = () => {
    setSearchTerm('');
    setSelectedFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = searchTerm !== '' || selectedFilter !== 'all' || dateFrom !== '' || dateTo !== '';

  // Billable seconds and time on the clock, kept apart. The rows above print
  // each entry's own duration with `displaySecondsFor`, which falls back to the
  // worked time for a fee entry, so a total built from `secondsFor` alone can
  // legitimately be smaller than the rows that make it up — a $150 fee carrying
  // 40 minutes used to read "totaling 0m". `workedVsBilledNote` says which is
  // which, in the same words the report uses.
  const { totalFilteredSeconds, totalFilteredWorkedSeconds, totalFilteredFees } = React.useMemo(() => {
    let billed = 0;
    let worked = 0;
    let fees = 0;
    for (const e of filteredEntries) {
      billed += secondsFor(billableLines, e.id);
      worked += workedSecondsFor(billableLines, e.id);
      const line = billableLines.get(e.id);
      if (line?.isFixedCost) fees += line.amount;
    }
    return { totalFilteredSeconds: billed, totalFilteredWorkedSeconds: worked, totalFilteredFees: fees };
  }, [filteredEntries, billableLines]);

  const totalFilteredNote = React.useMemo(
    () => workedVsBilledNote(totalFilteredWorkedSeconds, totalFilteredSeconds, totalFilteredFees),
    [totalFilteredWorkedSeconds, totalFilteredSeconds, totalFilteredFees]
  );

  const formatTotalDurationShort = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    const s = seconds % 60;
    if (s > 0) return `${s}s`;
    return '0m';
  };

  // Grouping by date walks and re-sorts the whole filtered list, so it is
  // memoised alongside the filter rather than redone on every render — the
  // running-timer tick alone would otherwise repeat it once a minute.
  const { groupedEntries, sortedDates, groupCounts, flatEntries } = React.useMemo(() => {
    const grouped = filteredEntries.reduce((acc, entry) => {
      const dateStr = format(parseISO(entry.startTime), 'yyyy-MM-dd');
      if (!acc[dateStr]) {
        acc[dateStr] = [];
      }
      acc[dateStr].push(entry);
      return acc;
    }, {} as Record<string, Entry[]>);

    const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    return {
      groupedEntries: grouped,
      sortedDates: dates,
      groupCounts: dates.map(date => grouped[date].length),
      // Flat, group-ordered view of the rows, so each virtualised row can be
      // keyed by its entry id rather than by position.
      flatEntries: dates.flatMap(date => grouped[date]),
    };
  }, [filteredEntries]);

  const formatDateHeader = (dateStr: string) => {
    const date = parseISO(dateStr + 'T00:00:00'); // Ensure local timezone
    const today = new Date();
    const yesterday = subDays(today, 1);

    if (format(date, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')) return 'Today';
    if (format(date, 'yyyy-MM-dd') === format(yesterday, 'yyyy-MM-dd')) return 'Yesterday';
    return format(date, 'MMMM d, yyyy');
  };

  return (
    <div className="w-full max-w-3xl mx-auto mt-8">
      <hr className="my-8 border-graphite/20 dark:border-white/20" />
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-graphite dark:text-stone">Recent Entries</h2>
        <button
          onClick={() => setIsManualModalOpen(true)}
          className="inline-flex items-center px-3 py-1.5 border border-graphite/20 dark:border-white/20 shadow-sm text-sm font-medium rounded-panel text-graphite dark:text-stone bg-white dark:bg-graphite hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite focus-visible:ring-signal transition-colors"
        >
          Add Manual Entry
        </button>
      </div>

      <div className="flex flex-col gap-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <input
            type="text"
            placeholder="Search notes or timecode..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 shadow-inner focus:ring-signal focus:border-signal block w-full sm:text-sm border-graphite/20 dark:border-white/20 rounded-panel bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite focus-visible:ring-signal"
          />
          <select
            value={selectedFilter}
            onChange={(e) => setSelectedFilter(e.target.value)}
            className="block w-full sm:w-64 pl-3 pr-10 py-2 text-base border-graphite/20 dark:border-white/20 shadow-inner focus:outline-none focus:ring-signal focus:border-signal sm:text-sm rounded-panel bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite focus-visible:ring-signal"
          >
            <option value="all">All Groups & Timecodes</option>
            {(() => {
              const timecodeIdsInEntries = new Set(entries.filter(e => !e.deletedAt).map(e => e.timecodeId));
              const availableTimecodes = timecodes.filter(t => !t.archived || timecodeIdsInEntries.has(t.id));
              const availableGroupIds = new Set(availableTimecodes.map(t => t.groupId).filter(Boolean) as string[]);
              const availableGroups = groups.filter(g => !g.archived || availableGroupIds.has(g.id));
              const ungrouped = availableTimecodes.filter(t => !t.groupId);

              return (
                <>
                  {availableGroups.map((g) => {
                    const groupTcs = availableTimecodes.filter(t => t.groupId === g.id);
                    return (
                      <optgroup key={g.id} label={`${g.name}${g.archived ? ' (archived)' : ''}`}>
                        <option value={`group:${g.id}`}>All {g.name}</option>
                        {groupTcs.map((t) => (
                          <option key={t.id} value={`timecode:${t.id}`}>{t.name}{t.archived ? ' (archived)' : ''}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                  {ungrouped.length > 0 && (
                    <optgroup label="Ungrouped">
                      {ungrouped.map((t) => (
                        <option key={t.id} value={`timecode:${t.id}`}>{t.name}{t.archived ? ' (archived)' : ''}</option>
                      ))}
                    </optgroup>
                  )}
                </>
              );
            })()}
          </select>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="flex flex-row gap-2 w-full sm:w-auto">
            <div className="flex-1 sm:flex-none min-w-0">
              <label htmlFor="entry-date-from" className="text-xs text-gray-500 dark:text-gray-400 sm:hidden">From</label>
              <input
                id="entry-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="block w-full min-w-0 sm:w-auto px-2 sm:pl-3 sm:pr-10 py-2 text-base border-graphite/20 dark:border-white/20 shadow-inner focus:outline-none focus:ring-signal focus:border-signal sm:text-sm rounded-panel bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite focus-visible:ring-signal"
                aria-label="From Date"
              />
            </div>
            <span className="text-gray-500 dark:text-gray-400 hidden sm:inline self-center">to</span>
            <div className="flex-1 sm:flex-none min-w-0">
              <label htmlFor="entry-date-to" className="text-xs text-gray-500 dark:text-gray-400 sm:hidden">To</label>
              <input
                id="entry-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="block w-full min-w-0 sm:w-auto px-2 sm:pl-3 sm:pr-10 py-2 text-base border-graphite/20 dark:border-white/20 shadow-inner focus:outline-none focus:ring-signal focus:border-signal sm:text-sm rounded-panel bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite focus-visible:ring-signal"
                aria-label="To Date"
              />
            </div>
          </div>
          {hasActiveFilters && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleClearFilters}
                className="text-sm text-gray-600 hover:text-signal-dim dark:hover:text-signal dark:text-gray-400 transition-colors whitespace-nowrap"
              >
                Clear filters
              </button>
              {filteredEntries.length > 0 && (
                <button
                  onClick={() => setShowBulkDeleteConfirm(true)}
                  className="text-sm text-rust hover:underline whitespace-nowrap"
                >
                  Delete all {filteredEntries.length} filtered {filteredEntries.length === 1 ? 'entry' : 'entries'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-graphite shadow-sm rounded-panel border border-graphite/20 dark:border-white/20 transition-colors overflow-hidden">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-600 dark:text-gray-400">
            No entries yet. Start tracking!
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-600 dark:text-gray-400">
            No entries found.
          </div>
        ) : (
          <GroupedVirtuoso
            style={{ height: '70vh', minHeight: '400px' }}
            groupCounts={groupCounts}
            computeItemKey={(index) => flatEntries[index]?.id ?? `row-${index}`}
            className="divide-y divide-graphite/20 dark:divide-white/20"
            groupContent={(index) => {
              const dateStr = sortedDates[index];
              return (
                <div className="px-4 py-2 bg-stone dark:bg-graphite/80 border-t border-b border-graphite/20 dark:border-white/20 first:border-t-0">
                  <span className="text-xs font-semibold font-sans text-signal-dim dark:text-signal uppercase tracking-wider">
                    {formatDateHeader(dateStr)}
                  </span>
                </div>
              );
            }}
            itemContent={(index, groupIndex) => {
              const dateStr = sortedDates[groupIndex];
              const entryIndexInGroup = index - groupCounts.slice(0, groupIndex).reduce((a, b) => a + b, 0);
              const entry = groupedEntries[dateStr][entryIndexInGroup];

              if (!entry) return null;

              const rowBg = index % 2 === 0
                ? 'bg-white dark:bg-graphite'
                : 'bg-stone/40 dark:bg-white/[0.03]';

              return (
                <div className={`px-4 py-4 flex items-center sm:px-6 ${rowBg} hover:bg-signal/5 transition-colors`}>
                  <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between">
                    <div>
                      <div className="flex text-sm items-center">
                        <span
                          className="font-medium truncate flex items-center"
                          style={{ color: getTimecodeColor(entry.timecodeId) }}
                        >
                          <span
                            className="w-3 h-3 rounded-full mr-2"
                            style={{ backgroundColor: getTimecodeColor(entry.timecodeId) }}
                          />
                          {getTimecodeName(entry.timecodeId)}
                        </span>
                        {entry.isRunning && (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-signal/10 text-signal-dim dark:text-signal border border-signal/20">
                            Running
                          </span>
                        )}
                        {entry.isPaused && (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-verdigris/10 text-verdigris dark:text-emerald-400 border border-verdigris/20">
                            Paused
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex">
                        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 tabular font-mono">
                          <Clock className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
                          <p>
                            {format(parseISO(entry.startTime), 'h:mm a')}
                            {' - '}
                            {entry.endTime ? format(parseISO(entry.endTime), 'h:mm a') : 'Now'}
                          </p>
                        </div>
                      </div>
                      {entry.note && (
                        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300 truncate max-w-sm">
                          {entry.note}
                        </div>
                      )}
                      {entry.tags && entry.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {entry.tags.map(tag => (
                            <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 flex-shrink-0 sm:mt-0 sm:ml-5">
                      <div className="flex items-center space-x-4">
                        <div className="flex flex-col items-end">
                          <span className="text-lg font-mono tabular font-medium text-graphite dark:text-stone">
                            {entry.isRunning
                              ? <LiveEntryDuration entry={entry} formatDuration={formatDuration} />
                              : formatDuration(displaySecondsFor(billableLines, entry.id))}
                          </span>
                          {entry.expectedDurationMinutes ? (
                            <span className="text-xs font-mono tabular whitespace-nowrap">
                              {entry.isRunning
                                ? <LiveEstimateComparison entry={entry} expectedSeconds={entry.expectedDurationMinutes * 60} />
                                : <EstimateComparison entry={entry} expectedSeconds={entry.expectedDurationMinutes * 60} actualSeconds={workedSecondsFor(billableLines, entry.id)} />}
                            </span>
                          ) : null}
                        </div>

                        {entry.duration > 60 && (
                          <button
                            onClick={() => !entry.isRunning && setSplittingEntry(entry)}
                            className={`focus:outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite rounded ${entry.isRunning ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50' : 'text-gray-500 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'}`}
                            title={entry.isRunning ? "Cannot split a running entry" : "Split Entry"}
                            aria-label={entry.isRunning ? "Cannot split a running entry" : "Split Entry"}
                            disabled={entry.isRunning}
                          >
                            <Scissors className="h-5 w-5" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="text-gray-500 dark:text-gray-400 hover:text-signal-dim dark:hover:text-signal focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite rounded transition-colors"
                          title="Edit Entry"
                          aria-label="Edit Entry"
                        >
                          <FileEdit className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Delete this entry? This can be undone from the toast or Trash.')) {
                              deleteEntry(entry.id);
                            }
                          }}
                          className="text-gray-500 dark:text-gray-400 hover:text-rust dark:hover:text-rust focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite rounded transition-colors"
                          title="Delete Entry (Move to Trash)"
                          aria-label="Delete Entry"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>

      {splittingEntry && (
        <EntrySplitModal entry={splittingEntry} onClose={() => setSplittingEntry(null)} />
      )}

      {editingEntry && (
        <EntryEditModal
          key={editingEntry.id}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}

      {isManualModalOpen && (
        <ManualEntryModal
          onClose={() => setIsManualModalOpen(false)}
        />
      )}

      {showBulkDeleteConfirm && (
        <Modal onClose={() => setShowBulkDeleteConfirm(false)}>
          <div className="bg-white dark:bg-graphite rounded-panel shadow-xl border border-graphite/20 dark:border-white/20 p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-graphite dark:text-stone mb-2">
              Confirm Bulk Delete
            </h3>
            {/* The headline figure stays the billable one, which is the number
                the report, the timesheet grid and the calendar all print for
                the same entries. The note beside it carries the time on the
                clock, so a fee entry no longer reads as "totaling 0m" with
                nothing to say where its two hours went. */}
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              Delete {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'} totaling {formatTotalDurationShort(totalFilteredSeconds)} billable? They'll move to Trash and can be restored for 30 days.
            </p>
            {totalFilteredNote && (
              <p className="text-xs font-mono tabular text-signal-dim dark:text-signal mb-3">
                {totalFilteredNote}
              </p>
            )}
            <div className="bg-stone dark:bg-gray-800/40 p-3 rounded-panel text-xs text-gray-600 dark:text-gray-300 space-y-1 mb-4">
              <div className="font-semibold text-graphite dark:text-stone">Applied Filters:</div>
              {selectedFilter.startsWith('group:') && (
                <div>• Group: {groups.find(g => g.id === selectedFilter.slice(6))?.name || 'Unknown'}</div>
              )}
              {selectedFilter.startsWith('timecode:') && (
                <div>• Timecode: {getTimecodeName(selectedFilter.slice(9))}</div>
              )}
              {(dateFrom || dateTo) && <div>• Dates: {dateFrom || 'Start'} to {dateTo || 'End'}</div>}
              {searchTerm && <div>• Search: "{searchTerm}"</div>}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowBulkDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-panel transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const idsToDelete = filteredEntries.map(e => e.id);
                  setShowBulkDeleteConfirm(false);
                  await bulkDeleteEntries(idsToDelete);
                }}
                className="px-4 py-2 text-sm font-medium bg-rust hover:bg-rust/90 text-white rounded-panel transition-colors"
              >
                Delete {filteredEntries.length} {filteredEntries.length === 1 ? 'Entry' : 'Entries'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
