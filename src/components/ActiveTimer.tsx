import React, { useState, useEffect, useRef } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Play, Square, Pause } from 'lucide-react';
import { TimecodeSelector } from './TimecodeSelector';
import { type Entry } from '../types';
import { getElapsedTimeMs, formatElapsedSeconds } from '../utils/timeUtils';
import { useToast } from '../context/ToastContext';

export const ActiveTimer: React.FC<{ activeEntry: Entry | null }> = ({ activeEntry }) => {
  const { startTimer, stopTimer, pauseTimer, resumeTimer, timecodes, updateActiveNote } = useTimeTracker();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedTimecodeId, setSelectedTimecodeId] = useState<string | null>(null);
  const [localNote, setLocalNote] = useState('');
  const [localTags, setLocalTags] = useState<string>('');
  const [preStartNote, setPreStartNote] = useState('');
  const [preStartTags, setPreStartTags] = useState('');

  const lastLoadedEntryIdRef = useRef<string | null>(null);

  // Sync local note & tags when active entry changes (e.g. initial load)
  useEffect(() => {
    if (activeEntry && lastLoadedEntryIdRef.current !== activeEntry.id) {
      setLocalNote(activeEntry.note);
      setLocalTags((activeEntry.tags || []).join(', '));
      lastLoadedEntryIdRef.current = activeEntry.id;
    } else if (!activeEntry) {
      lastLoadedEntryIdRef.current = null;
    }
  }, [activeEntry]);

  // Debounced save for the note and tags
  useEffect(() => {
    if (!activeEntry) return;
    const handler = setTimeout(() => {
      const tagsArray = localTags.split(',').map(t => t.trim()).filter(t => t !== '').slice(0, 20);
      const tagsChanged = JSON.stringify(tagsArray) !== JSON.stringify(activeEntry.tags || []);
      if (localNote !== activeEntry.note || tagsChanged) {
        updateActiveNote(activeEntry.id, localNote, tagsArray);
      }
    }, 1000);
    return () => clearTimeout(handler);
  }, [localNote, localTags, activeEntry, updateActiveNote]);

  const { settings } = useTimeTracker();
  const { addToast } = useToast();
  const alertTriggeredRef = useRef(false);

  useEffect(() => {
    if (!activeEntry) {
      setElapsedSeconds(0);
      alertTriggeredRef.current = false;
      return;
    }

    const calculateElapsed = () => {
      const elapsedMs = getElapsedTimeMs(activeEntry.startTime, activeEntry.pausedSegments);
      const seconds = Math.floor(elapsedMs / 1000);
      setElapsedSeconds(seconds);

      if (settings?.targetAlertMinutes && !alertTriggeredRef.current) {
        if (seconds >= settings.targetAlertMinutes * 60) {
          addToast(`Target reached! ${settings.targetAlertMinutes} minutes elapsed.`, 'info', undefined, 10000);
          if (Notification.permission === 'granted') {
            new Notification('TimeDoco Target Reached', {
               body: `You have tracked ${settings.targetAlertMinutes} minutes.`,
             });
          }
          alertTriggeredRef.current = true;
        }
      }
    };

    calculateElapsed();

    if (!activeEntry.isPaused) {
      const interval = setInterval(calculateElapsed, 1000);
      return () => clearInterval(interval);
    }
  }, [activeEntry, settings?.targetAlertMinutes, addToast]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default' && settings?.targetAlertMinutes) {
      Notification.requestPermission();
    }
  }, [settings?.targetAlertMinutes]);

  const activeTimecode = activeEntry ? timecodes.find(t => t.id === activeEntry.timecodeId) : null;

  const handleStop = async () => {
    if (activeEntry) {
      const tagsArray = localTags.split(',').map(t => t.trim()).filter(t => t !== '').slice(0, 20);
      const tagsChanged = JSON.stringify(tagsArray) !== JSON.stringify(activeEntry.tags || []);
      if (localNote !== activeEntry.note || tagsChanged) {
        await updateActiveNote(activeEntry.id, localNote, tagsArray);
      }
      stopTimer(activeEntry.id);
    }
  };

  return (
    <div className="bg-white dark:bg-graphite p-6 rounded-panel shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] border border-graphite/20 dark:border-white/20 max-w-md w-full mx-auto flex flex-col items-center transition-colors">
      {!activeEntry ? (
        <div className="w-full flex flex-col items-center gap-6">
          <div className="text-5xl text-gray-400 dark:text-gray-500 font-mono tracking-wider tabular">
            00:00
          </div>

          <div className="w-full relative z-20">
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 text-center">What are you working on?</label>
            <TimecodeSelector onSelect={setSelectedTimecodeId} selectedId={selectedTimecodeId} />
          </div>

          <div className="w-full space-y-2">
            <input
              type="text"
              maxLength={2000}
              placeholder="Add a note (optional)"
              className="w-full text-center text-sm px-3 py-2 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-colors bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
              value={preStartNote}
              onChange={(e) => setPreStartNote(e.target.value)}
            />
            <input
              type="text"
              maxLength={500}
              placeholder="Tags (e.g. design, client)"
              className="w-full text-center text-xs px-3 py-1.5 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-colors bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
              value={preStartTags}
              onChange={(e) => setPreStartTags(e.target.value)}
            />
          </div>

          <button
            disabled={!selectedTimecodeId}
            onClick={() => {
              if (!selectedTimecodeId) return;
              const tagsArray = preStartTags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
              startTimer(selectedTimecodeId, preStartNote, tagsArray);
              setPreStartNote('');
              setPreStartTags('');
            }}
            className="mt-2 w-16 h-16 rounded-full bg-signal hover:bg-signal-dim text-ink flex items-center justify-center shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
            aria-label="Start Timer (Cmd/Ctrl+Shift+S)"
            title="Start Timer (Cmd/Ctrl+Shift+S)"
          >
            <Play size={24} className="ml-1 text-ink fill-current" />
          </button>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-4">

          <div className="flex flex-col items-center">
            <span className="text-xs uppercase tracking-wide font-sans text-gray-500 dark:text-gray-400 mb-1">RECORDING</span>
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

          <div className="flex items-center gap-3">
            <div className={`w-4 h-4 rounded-full ${activeEntry.isPaused ? 'bg-verdigris' : 'bg-signal recording-dot'}`}></div>
            <div className="text-6xl font-mono tracking-wider tabular text-graphite dark:text-stone">
              {formatElapsedSeconds(elapsedSeconds)}
            </div>
          </div>

          <div className="w-full mt-2 mb-2 space-y-2">
            <input
              type="text"
              maxLength={2000}
              placeholder="Add a note..."
              className="w-full text-center text-sm px-3 py-2 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-colors bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
              value={localNote}
              onChange={(e) => setLocalNote(e.target.value)}
            />
            <input
              type="text"
              maxLength={500}
              placeholder="Tags (e.g. design, review)"
              className="w-full text-center text-xs px-3 py-1.5 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-colors bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-500 dark:placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
              value={localTags}
              onChange={(e) => setLocalTags(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-4 mt-2">
            {activeEntry.isPaused ? (
              <button
                onClick={() => resumeTimer(activeEntry.id)}
                className="w-14 h-14 rounded-full bg-verdigris text-white hover:bg-verdigris-dim flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
                title="Resume"
                aria-label="Resume Timer"
              >
                <Play size={20} className="ml-1" />
              </button>
            ) : (
              <button
                onClick={() => pauseTimer(activeEntry.id)}
                className="w-14 h-14 rounded-full bg-stone dark:bg-gray-700 text-graphite dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
                title="Pause"
                aria-label="Pause Timer"
              >
                <Pause size={20} />
              </button>
            )}

            <button
              onClick={handleStop}
              className="w-16 h-16 rounded-full bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink flex items-center justify-center shadow-lg transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
              title="Stop (Cmd/Ctrl+Shift+S)"
              aria-label="Stop Timer (Cmd/Ctrl+Shift+S)"
            >
              <Square size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
