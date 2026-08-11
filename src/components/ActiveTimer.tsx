import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { differenceInSeconds } from 'date-fns';
import { Play, Square, Pause } from 'lucide-react';
import { TimecodeSelector } from './TimecodeSelector';

export const ActiveTimer: React.FC = () => {
  const { activeEntry, startTimer, stopTimer, pauseTimer, resumeTimer, timecodes, updateActiveNote } = useTimeTracker();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedTimecodeId, setSelectedTimecodeId] = useState<string | null>(null);
  const [localNote, setLocalNote] = useState('');

  // Sync local note when active entry changes (e.g. initial load)
  useEffect(() => {
    if (activeEntry && localNote !== activeEntry.note) {
      setLocalNote(activeEntry.note);
    }
  }, [activeEntry?.id]);

  // Debounced save for the note
  useEffect(() => {
    if (!activeEntry) return;
    const handler = setTimeout(() => {
      if (localNote !== activeEntry.note) {
        updateActiveNote(localNote);
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
      const now = new Date();
      const start = new Date(activeEntry.startTime);

      let totalPauseSeconds = 0;
      activeEntry.pausedSegments.forEach(segment => {
        const pStart = new Date(segment.pauseStart);
        const pEnd = segment.pauseEnd ? new Date(segment.pauseEnd) : now;
        totalPauseSeconds += differenceInSeconds(pEnd, pStart);
      });

      const total = differenceInSeconds(now, start) - totalPauseSeconds;
      setElapsedSeconds(total > 0 ? total : 0);
    };

    calculateElapsed();

    if (!activeEntry.isPaused) {
      const interval = setInterval(calculateElapsed, 1000);
      return () => clearInterval(interval);
    }
  }, [activeEntry]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    const pad = (num: number) => num.toString().padStart(2, '0');

    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  };

  const activeTimecode = activeEntry ? timecodes.find(t => t.id === activeEntry.timecodeId) : null;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 max-w-md w-full mx-auto flex flex-col items-center">
      {!activeEntry ? (
        <div className="w-full flex flex-col items-center gap-6">
          <div className="text-5xl font-light text-gray-300 font-mono tracking-wider">
            00:00
          </div>

          <div className="w-full relative z-20">
            <label className="block text-sm font-medium text-gray-500 mb-2 text-center">What are you working on?</label>
            <TimecodeSelector onSelect={setSelectedTimecodeId} />
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
            <span className="text-sm font-medium text-gray-500 mb-1">Currently Tracking</span>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: activeTimecode?.color || '#cbd5e1' }}
              ></div>
              <span className="text-lg font-semibold text-gray-800">
                {activeTimecode?.name || 'Unknown Timecode'}
              </span>
            </div>
          </div>

          <div className={`text-6xl font-light font-mono tracking-wider tabular-nums ${activeEntry.isPaused ? 'text-amber-500' : 'text-blue-600'}`}>
            {formatTime(elapsedSeconds)}
          </div>

          <div className="w-full mt-2 mb-2">
            <input
              type="text"
              placeholder="What are you doing? (optional note)"
              className="w-full text-center text-sm p-2 border border-transparent hover:border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded outline-none transition-colors bg-gray-50 focus:bg-white"
              value={localNote}
              onChange={(e) => setLocalNote(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-4 mt-2">
            {activeEntry.isPaused ? (
              <button
                onClick={resumeTimer}
                className="w-14 h-14 rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 flex items-center justify-center transition-colors"
                title="Resume"
              >
                <Play size={20} className="ml-1" />
              </button>
            ) : (
              <button
                onClick={pauseTimer}
                className="w-14 h-14 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center justify-center transition-colors"
                title="Pause"
              >
                <Pause size={20} />
              </button>
            )}

            <button
              onClick={stopTimer}
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
