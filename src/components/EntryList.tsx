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
  const { entries, timecodes, deleteEntry, settings } = useTimeTracker();
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [splittingEntry, setSplittingEntry] = useState<Entry | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTimecodeId, setSelectedTimecodeId] = useState<string>('all');

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

    return matchesSearch && matchesTimecode;
  });

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
          className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
        >
          Add Manual Entry
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <input
          type="text"
          placeholder="Search notes or timecode..."
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
          }}
          className="flex-1 shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
        />
        <select
          value={selectedTimecodeId}
          onChange={(e) => {
            setSelectedTimecodeId(e.target.value);
          }}
          className="block w-full sm:w-48 pl-3 pr-10 py-2 text-base border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="all">All Timecodes</option>
          {timecodes.filter(t => !t.archived).map((tc) => (
            <option key={tc.id} value={tc.id}>{tc.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow sm:rounded-md border border-transparent dark:border-gray-700 transition-colors">
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
            className="divide-y divide-gray-200 dark:divide-gray-700"
            groupContent={(index) => {
              const dateStr = sortedDates[index];
              return (
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-t border-b border-gray-200 dark:border-gray-700 first:border-t-0">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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
                <div className="px-4 py-4 flex items-center sm:px-6 bg-white dark:bg-gray-800">
                  <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between">
                    <div>
                      <div className="flex text-sm">
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
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Running
                          </span>
                        )}
                        {entry.isPaused && (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            Paused
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex">
                        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
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
                        <span className="text-lg font-mono font-medium text-gray-900 dark:text-gray-100">
                          {entry.isRunning
                            ? <LiveEntryDuration entry={entry} settings={settings} formatDuration={formatDuration} />
                            : formatDuration(applyRounding(entry.duration, settings?.roundingRule || 'none'))}
                        </span>

                        {entry.duration > 60 && (
                          <button
                            onClick={() => !entry.isRunning && setSplittingEntry(entry)}
                            className={`focus:outline-none transition-colors ${entry.isRunning ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed opacity-50' : 'text-gray-400 dark:text-gray-500 hover:text-purple-600 dark:hover:text-purple-400'}`}
                            title={entry.isRunning ? "Cannot split a running entry" : "Split Entry"}
                            aria-label={entry.isRunning ? "Cannot split a running entry" : "Split Entry"}
                            disabled={entry.isRunning}
                          >
                            <Scissors className="h-5 w-5" />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none transition-colors"
                          title="Edit Entry"
                          aria-label="Edit Entry"
                        >
                          <FileEdit className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => {
                            deleteEntry(entry.id);
                          }}
                          className="text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 focus:outline-none transition-colors"
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
