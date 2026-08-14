import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Play, Square, Pause } from 'lucide-react';
import { TimecodeSelector } from './TimecodeSelector';
import { type Entry } from '../types';
import { getElapsedTimeMs, formatElapsedSeconds } from '../utils/timeUtils';

export const ActiveTimer: React.FC<{ activeEntry: Entry | null }> = ({ activeEntry }) => {
  const { startTimer, stopTimer, pauseTimer, resumeTimer, timecodes, updateActiveNote } = useTimeTracker();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedTimecodeId, setSelectedTimecodeId] = useState<string | null>(null);
  const [localNote, setLocalNote] = useState('');

  // Sync local note when active entry changes (e.g. initial load)
  useEffect(() => {
    if (activeEntry && localNote !== activeEntry.note) {
      setLocalNote(activeEntry.note);
    }
  }, [activeEntry?.id, activeEntry, localNote]);

  // Debounced save for the note
  useEffect(() => {
    if (!activeEntry) return;
    const handler = setTimeout(() => {
      if (localNote !== activeEntry.note) {
        updateActiveNote(activeEntry.id, localNote);
      }
    }, 1000);
    return () => clearTimeout(handler);
  }, [localNote, activeEntry, updateActiveNote]);

  useEffect(() => {
    if (!activeEntry) {
      setElapsedSeconds(0);
      return;
    }

    const calculateElapsed = () => {
      const elapsedMs = getElapsedTimeMs(activeEntry.startTime, activeEntry.pausedSegments);
      setElapsedSeconds(Math.floor(elapsedMs / 1000));
    };

    calculateElapsed();

    if (!activeEntry.isPaused) {
      // Need frequent updates to catch the second boundary cleanly with requestAnimationFrame or short interval
      const interval = setInterval(calculateElapsed, 200);
      return () => clearInterval(interval);
    }
  }, [activeEntry]);

  const activeTimecode = activeEntry ? timecodes.find(t => t.id === activeEntry.timecodeId) : null;

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 max-w-md w-full mx-auto flex flex-col items-center transition-colors">
      {!activeEntry ? (
        <div className="w-full flex flex-col items-center gap-6">
          <div className="text-5xl font-light text-gray-300 dark:text-gray-600 font-mono tracking-wider">
            00:00
          </div>

          <div className="w-full relative z-20">
            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 text-center">What are you working on?</label>
            <TimecodeSelector onSelect={setSelectedTimecodeId} selectedId={selectedTimecodeId} />
          </div>

          <button
            disabled={!selectedTimecodeId}
            onClick={() => selectedTimecodeId && startTimer(selectedTimecodeId)}
            className="mt-2 w-16 h-16 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Play size={24} className="ml-1" />
          </button>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-4">

          <div className="flex flex-col items-center">
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Currently Tracking</span>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: activeTimecode?.color || '#cbd5e1' }}
              ></div>
              <span className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                {activeTimecode?.name || 'Unknown Timecode'}
              </span>
            </div>
          </div>

          <div className={`text-6xl font-light font-mono tracking-wider tabular-nums ${activeEntry.isPaused ? 'text-amber-500 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
            {formatElapsedSeconds(elapsedSeconds)}
          </div>

          <div className="w-full mt-2 mb-2">
            <input
              type="text"
              placeholder="What are you doing? (optional note)"
              className="w-full text-center text-sm p-2 border border-transparent hover:border-gray-200 dark:hover:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400 focus:ring-1 focus:ring-blue-500 dark:focus:ring-blue-400 rounded outline-none transition-colors bg-gray-50 dark:bg-gray-700 focus:bg-white dark:focus:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              value={localNote}
              onChange={(e) => setLocalNote(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-4 mt-2">
            {activeEntry.isPaused ? (
              <button
                onClick={() => resumeTimer(activeEntry.id)}
                className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 flex items-center justify-center transition-colors"
                title="Resume"
              >
                <Play size={20} className="ml-1" />
              </button>
            ) : (
              <button
                onClick={() => pauseTimer(activeEntry.id)}
                className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center transition-colors"
                title="Pause"
              >
                <Pause size={20} />
              </button>
            )}

            <button
              onClick={() => stopTimer(activeEntry.id)}
              className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition-colors"
              title="Stop"
            >
              <Square size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
