import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, parseISO } from 'date-fns';
import { Clock, FileEdit, Trash2 } from 'lucide-react';
import { EntryEditModal } from './EntryEditModal';
import { ManualEntryModal } from './ManualEntryModal';
import type { Entry } from '../types';

export const EntryList: React.FC = () => {
  const { entries, timecodes, deleteEntry } = useTimeTracker();
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

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

      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-md border border-transparent dark:border-gray-700 transition-colors">
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {entries.length === 0 ? (
            <li className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
              No entries yet. Start tracking!
            </li>
          ) : (
            entries.map(entry => (
              <li key={entry.id}>
                <div className="px-4 py-4 flex items-center sm:px-6">
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
                    </div>
                    <div className="mt-4 flex-shrink-0 sm:mt-0 sm:ml-5">
                      <div className="flex items-center space-x-4">
                        <span className="text-lg font-mono font-medium text-gray-900 dark:text-gray-100">
                          {formatDuration(entry.duration)}
                        </span>
                        <button
                          onClick={() => setEditingEntry(entry)}
                          className="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 focus:outline-none transition-colors"
                          title="Edit Entry"
                        >
                          <FileEdit className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Are you sure you want to delete this entry?')) {
                              deleteEntry(entry.id);
                            }
                          }}
                          className="text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 focus:outline-none transition-colors"
                          title="Delete Entry"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

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
