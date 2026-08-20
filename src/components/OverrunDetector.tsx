import React, { useEffect, useState, useRef } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Modal } from './ui/Modal';
import { getElapsedTimeMs, formatElapsedSeconds } from '../utils/timeUtils';
import type { Entry } from '../types';

export const OverrunDetector: React.FC = () => {
  const { activeEntries, timecodes, stopTimer } = useTimeTracker();
  const [promptEntry, setPromptEntry] = useState<Entry | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPromptEntry((current) => {
        if (current) return current; // one prompt at a time

        const overrun = activeEntries.find((entry) => {
          if (entry.isPaused) return false;
          if (!entry.expectedDurationMinutes || entry.expectedDurationMinutes <= 0) return false;
          if (dismissedRef.current.has(entry.id)) return false;

          const elapsedMs = getElapsedTimeMs(entry.startTime, entry.pausedSegments);
          return elapsedMs >= entry.expectedDurationMinutes * 60 * 1000;
        });

        return overrun || null;
      });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [activeEntries]);

  // Stop nagging about entries that are no longer active (stopped/paused elsewhere)
  useEffect(() => {
    const activeIds = new Set(activeEntries.map((e) => e.id));
    dismissedRef.current.forEach((id) => {
      if (!activeIds.has(id)) dismissedRef.current.delete(id);
    });
  }, [activeEntries]);

  if (!promptEntry) return null;

  const tc = timecodes.find((t) => t.id === promptEntry.timecodeId);
  const elapsedSeconds = Math.floor(getElapsedTimeMs(promptEntry.startTime, promptEntry.pausedSegments) / 1000);

  const handleKeepGoing = () => {
    dismissedRef.current.add(promptEntry.id);
    setPromptEntry(null);
  };

  const handleStop = async () => {
    dismissedRef.current.add(promptEntry.id);
    const entryId = promptEntry.id;
    setPromptEntry(null);
    await stopTimer(entryId);
  };

  return (
    <Modal onClose={handleKeepGoing}>
      <div className="bg-white dark:bg-graphite rounded-panel shadow-xl border border-graphite/20 dark:border-white/20 max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-xl font-semibold text-graphite dark:text-stone mb-2">Past your estimate</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          You estimated {promptEntry.expectedDurationMinutes} min for{' '}
          <strong>{tc?.name || 'this task'}</strong>, and you're now at{' '}
          {formatElapsedSeconds(elapsedSeconds)}. Still working on it?
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={handleStop}
            className="px-4 py-2 text-sm font-medium text-graphite dark:text-stone bg-white dark:bg-gray-800/30 border border-graphite/20 dark:border-white/20 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-panel transition-colors"
          >
            No, stop timer
          </button>
          <button
            onClick={handleKeepGoing}
            className="px-4 py-2 text-sm font-medium bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink rounded-panel transition-colors"
          >
            Yes, keep going
          </button>
        </div>
      </div>
    </Modal>
  );
};
