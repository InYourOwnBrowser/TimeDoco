import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Square, Play, Pause, FileEdit } from 'lucide-react';
import { getElapsedTimeMs, formatElapsedSeconds } from '../utils/timeUtils';

export const GlobalActiveTimerBar: React.FC = () => {
  const { activeEntries, timecodes, stopTimer, pauseTimer, resumeTimer } = useTimeTracker();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Pick the most recent timer
  const primaryEntry = activeEntries.length > 0
    ? [...activeEntries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0]
    : null;

  useEffect(() => {
    if (!primaryEntry) {
      setElapsedSeconds(0);
      return;
    }

    const calculateElapsed = () => {
      const elapsedMs = getElapsedTimeMs(primaryEntry.startTime, primaryEntry.pausedSegments);
      setElapsedSeconds(Math.floor(elapsedMs / 1000));
    };

    calculateElapsed();

    if (!primaryEntry.isPaused) {
      const interval = setInterval(calculateElapsed, 200);
      return () => clearInterval(interval);
    }
  }, [primaryEntry]);

  if (!primaryEntry) return null;

  const activeTimecode = timecodes.find(t => t.id === primaryEntry.timecodeId);
  const tcName = activeTimecode?.name || 'Unknown Timecode';
  const tcColor = activeTimecode?.color || '#cbd5e1';

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="bg-stone dark:bg-graphite rounded-panel shadow-sm border border-graphite/20 dark:border-white/20 p-2 pr-4 flex items-center gap-4 transition-colors">

        {/* Play/Pause control for this timer */}
        {primaryEntry.isPaused ? (
           <button
             onClick={() => resumeTimer(primaryEntry.id)}
             className="w-10 h-10 rounded-full bg-verdigris/10 text-verdigris dark:text-emerald-400 hover:bg-verdigris/20 flex items-center justify-center transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
             title="Resume"
             aria-label="Resume Timer"
           >
             <Play size={16} className="ml-1" />
           </button>
        ) : (
           <button
             onClick={() => pauseTimer(primaryEntry.id)}
             className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 flex items-center justify-center transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
             title="Pause"
             aria-label="Pause Timer"
           >
             <Pause size={16} />
           </button>
        )}

        <div className="flex flex-col min-w-0 pr-2">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tcColor }}></div>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[120px]">
              {tcName}
            </span>
            {primaryEntry.note && (
              <div title={primaryEntry.note}>
                <FileEdit size={14} className="text-gray-500 dark:text-gray-400 shrink-0 cursor-help" />
              </div>
            )}
            {activeEntries.length > 1 && (
              <span className="text-xs font-semibold bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full">
                +{activeEntries.length - 1}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className={`w-2 h-2 rounded-full shrink-0 ${primaryEntry.isPaused ? 'bg-verdigris' : 'bg-signal recording-dot'}`}></div>
            <span className="text-lg font-mono font-medium tracking-wide tabular leading-none text-graphite dark:text-stone">
              {formatElapsedSeconds(elapsedSeconds)}
            </span>
          </div>
        </div>

        <button
          onClick={() => stopTimer(primaryEntry.id)}
          className="w-10 h-10 rounded-full bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink flex items-center justify-center transition-colors shrink-0 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
          title="Stop Timer"
          aria-label="Stop Timer"
        >
          <Square size={16} />
        </button>
      </div>
    </div>
  );
};
