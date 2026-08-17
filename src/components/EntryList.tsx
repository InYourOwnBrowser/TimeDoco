import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, parseISO, subDays } from 'date-fns';
import { Clock, FileEdit, Trash2, Scissors } from 'lucide-react';
import { GroupedVirtuoso } from 'react-virtuoso';
import { EntryEditModal } from './EntryEditModal';
import { EntrySplitModal } from './EntrySplitModal';
import { ManualEntryModal } from './ManualEntryModal';
import type { Entry } from '../types';
import { applyRounding, getElapsedTimeMs } from '../utils/timeUtils';

const LiveEntryDuration: React.FC<{ entry: Entry, settings: any, formatDuration: (s: number) => string }> = ({ entry, settings, formatDuration }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const updateElapsed = () => {
      setElapsed(Math.floor(getElapsedTimeMs(entry.startTime, entry.pausedSegments) / 1000));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [entry.startTime, entry.pausedSegments]);

  return <>{formatDuration(applyRounding(elapsed, settings?.roundingRule || 'none'))}</>;
};

export const EntryList: React.FC = () => {
  const { entries, timecodes, groups, deleteEntry, settings } = useTimeTracker();
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [splittingEntry, setSplittingEntry] = useState<Entry | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTimecodeId, setSelectedTimecodeId] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const getTimecodeName = (id: string) => {
    const tc = timecodes.find(t => t.id === id);
    return tc ? tc.name : 'Unknown';
  };

  const getTimecodeColor = (id: string) => {
    const tc = timecodes.find(t => t.id === id);
    return tc?.color || '#3b82f6';
  };

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch = searchTerm === '' ||
      (entry.note?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (getTimecodeName(entry.timecodeId).toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesTimecode = selectedTimecodeId === 'all' || entry.timecodeId === selectedTimecodeId;

    const tc = timecodes.find(t => t.id === entry.timecodeId);
    const matchesGroup = selectedGroupId === 'all' || tc?.groupId === selectedGroupId;

    const entryDate = format(parseISO(entry.startTime), 'yyyy-MM-dd');
    const matchesFrom = !dateFrom || entryDate >= dateFrom;
    const matchesTo = !dateTo || entryDate <= dateTo;

    return matchesSearch && matchesTimecode && matchesGroup && matchesFrom && matchesTo;
  });

  const handleClearFilters = () => {
    setSearchTerm('');
    setSelectedTimecodeId('all');
    setSelectedGroupId('all');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = searchTerm !== '' || selectedTimecodeId !== 'all' || selectedGroupId !== 'all' || dateFrom !== '' || dateTo !== '';

  // Group entries by date
  const groupedEntries = filteredEntries.reduce((acc, entry) => {
    const dateStr = format(parseISO(entry.startTime), 'yyyy-MM-dd');
    if (!acc[dateStr]) {
      acc[dateStr] = [];
    }
    acc[dateStr].push(entry);
    return acc;
  }, {} as Record<string, Entry[]>);

  const sortedDates = Object.keys(groupedEntries).sort((a, b) => b.localeCompare(a));

  const groupCounts = sortedDates.map(date => groupedEntries[date].length);

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
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Recent Entries</h2>
        <button
          onClick={() => setIsManualModalOpen(true)}
          className="inline-flex items-center px-3 py-1.5 border border-graphite/10 dark:border-white/10 shadow-inner text-sm font-medium rounded-panel text-graphite dark:text-stone bg-stone dark:bg-ink hover:bg-gray-200 dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal transition-colors"
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
            className="flex-1 shadow-inner focus:ring-signal focus:border-signal block w-full sm:text-sm border-graphite/10 dark:border-white/10 rounded-panel bg-stone dark:bg-ink text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal"
          />
          <select
            value={selectedTimecodeId}
            onChange={(e) => setSelectedTimecodeId(e.target.value)}
            className="block w-full sm:w-48 pl-3 pr-10 py-2 text-base border-graphite/10 dark:border-white/10 shadow-inner focus:outline-none focus:ring-signal focus:border-signal sm:text-sm rounded-panel bg-stone dark:bg-ink text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal"
          >
            <option value="all">All Timecodes</option>
            {timecodes.filter(t => !t.archived).map((tc) => (
              <option key={tc.id} value={tc.id}>{tc.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="block w-full sm:w-auto pl-3 pr-10 py-2 text-base border-graphite/10 dark:border-white/10 shadow-inner focus:outline-none focus:ring-signal focus:border-signal sm:text-sm rounded-panel bg-stone dark:bg-ink text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal"
            aria-label="From Date"
          />
          <span className="text-gray-500 hidden sm:inline">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="block w-full sm:w-auto pl-3 pr-10 py-2 text-base border-graphite/10 dark:border-white/10 shadow-inner focus:outline-none focus:ring-signal focus:border-signal sm:text-sm rounded-panel bg-stone dark:bg-ink text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal"
            aria-label="To Date"
          />
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="block w-full sm:w-48 pl-3 pr-10 py-2 text-base border-graphite/10 dark:border-white/10 shadow-inner focus:outline-none focus:ring-signal focus:border-signal sm:text-sm rounded-panel bg-stone dark:bg-ink text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal"
          >
            <option value="all">All Groups</option>
            {groups.filter(g => !g.archived).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="text-sm text-gray-500 hover:text-signal dark:text-gray-400 transition-colors whitespace-nowrap"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="bg-stone dark:bg-ink shadow-sm rounded-panel border border-graphite/20 dark:border-white/15 transition-colors overflow-hidden">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
            No entries yet. Start tracking!
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
            No entries found.
          </div>
        ) : (
          <GroupedVirtuoso
            style={{ height: '70vh', minHeight: '400px' }}
            groupCounts={groupCounts}
            className="divide-y divide-graphite/10 dark:divide-white/10"
            groupContent={(index) => {
              const dateStr = sortedDates[index];
              return (
                <div className="px-4 py-2 bg-stone dark:bg-ink border-t border-b border-graphite/10 dark:border-white/10 first:border-t-0">
                  <span className="text-xs font-semibold font-sans text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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

              return (
                <div className="px-4 py-4 flex items-center sm:px-6 bg-stone dark:bg-ink hover:bg-signal/5 transition-colors">
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
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-signal/10 text-signal border border-signal/20">
                            Running
                          </span>
                        )}
                        {entry.isPaused && (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-verdigris/10 text-verdigris border border-verdigris/20">
                            Paused
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex">
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 tabular font-mono">
                          <Clock className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400 dark:text-gray-500" />
                          <p>
                            {format(parseISO(entry.startTime), 'h:mm a')}
                            {' - '}
                            {entry.endTime ? format(parseISO(entry.endTime), 'h:mm a') : 'Now'}
                          </p>
                        </div>
                      </div>
                      {entry.note && (
                        <div className="mt-2 text-sm text-gray-600 dark:text-gray-400 truncate max-w-sm">
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
                        <span className="text-lg font-mono tabular font-medium text-graphite dark:text-stone">
                          {entry.isRunning
                            ? <LiveEntryDuration entry={entry} settings={settings} formatDuration={formatDuration} />
                            : formatDuration(applyRounding(entry.duration, settings?.roundingRule || 'none'))}
                        </span>

                        {entry.duration > 60 && (
                          <button
                            onClick={() => !entry.isRunning && setSplittingEntry(entry)}
                            className={`focus:outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 rounded ${entry.isRunning ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed opacity-50' : 'text-gray-400 dark:text-gray-500 hover:text-graphite dark:hover:text-stone'}`}
                            title={entry.isRunning ? "Cannot split a running entry" : "Split Entry"}
                            aria-label={entry.isRunning ? "Cannot split a running entry" : "Split Entry"}
                            disabled={entry.isRunning}
                          >
                            <Scissors className="h-5 w-5" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="text-gray-400 dark:text-gray-500 hover:text-signal dark:hover:text-signal-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 rounded transition-colors"
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
                          className="text-gray-400 dark:text-gray-500 hover:text-rust dark:hover:text-rust focus:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 rounded transition-colors"
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
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}

      {isManualModalOpen && (
        <ManualEntryModal
          onClose={() => setIsManualModalOpen(false)}
        />
      )}
    </div>
  );
};
