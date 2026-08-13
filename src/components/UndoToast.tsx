import React, { useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { RotateCcw, X } from 'lucide-react';

export const UndoToast: React.FC = () => {
  const { lastStoppedEntry, undoStopTimer, clearLastStoppedEntry } = useTimeTracker();

  useEffect(() => {
    if (lastStoppedEntry) {
      const timer = setTimeout(() => {
        clearLastStoppedEntry();
      }, 5000); // 5 seconds
      return () => clearTimeout(timer);
    }
  }, [lastStoppedEntry, clearLastStoppedEntry]);

  if (!lastStoppedEntry) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 dark:bg-gray-800 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5">
      <span className="text-sm font-medium">Timer stopped</span>
      <div className="w-px h-4 bg-gray-700"></div>
      <button
        onClick={undoStopTimer}
        className="text-sm font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
      >
        <RotateCcw size={14} />
        Undo
      </button>
      <button
        onClick={clearLastStoppedEntry}
        className="ml-2 text-gray-400 hover:text-white transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
};
