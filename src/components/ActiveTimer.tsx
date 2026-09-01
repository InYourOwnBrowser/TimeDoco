import React, { useState, useEffect, useRef } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Play, Square, Pause } from 'lucide-react';
import { TimecodeSelector } from './TimecodeSelector';
import { type Entry } from '../types';
import { getElapsedTimeMs, formatElapsedSeconds, formatDurationShort } from '../utils/timeUtils';
import { useToast } from '../context/ToastContext';
import { unlockAudioAlert } from '../utils/audioAlert';
import { sendNotification, requestNotificationPermission } from '../utils/notification';

export const ActiveTimer: React.FC<{ activeEntry: Entry | null }> = ({ activeEntry }) => {
  const { startTimer, stopTimer, pauseTimer, resumeTimer, timecodes, updateActiveNote } = useTimeTracker();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [selectedTimecodeId, setSelectedTimecodeId] = useState<string | null>(null);
  const [localNote, setLocalNote] = useState('');
  const [localTags, setLocalTags] = useState<string>('');
  const [preStartNote, setPreStartNote] = useState('');
  const [preStartTags, setPreStartTags] = useState('');
  const [preStartExpectedMinutes, setPreStartExpectedMinutes] = useState('');

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
  // Which entry (and which target) the alert has already fired for. A plain
  // boolean was only reset when the timer bar emptied, so starting a second
  // timer straight after the first — the bar never goes empty — left the flag
  // set and the new timer never announced its target.
  const alertedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeEntry) {
      setElapsedSeconds(0);
      alertedForRef.current = null;
      return;
    }

    const alertKey = `${activeEntry.id}:${settings?.targetAlertMinutes ?? ''}`;

    const calculateElapsed = () => {
      const elapsedMs = getElapsedTimeMs(activeEntry.startTime, activeEntry.pausedSegments);
      const seconds = Math.floor(elapsedMs / 1000);
      setElapsedSeconds(seconds);

      if (settings?.targetAlertMinutes && alertedForRef.current !== alertKey) {
        if (seconds >= settings.targetAlertMinutes * 60) {
          addToast(`Target reached! ${settings.targetAlertMinutes} minutes elapsed.`, 'info', undefined, 10000);
          sendNotification('TimeDoco Target Reached', {
            body: `You have tracked ${settings.targetAlertMinutes} minutes.`,
          });
          alertedForRef.current = alertKey;
        }
      }
    };

    calculateElapsed();

    if (!activeEntry.isPaused) {
      const interval = setInterval(calculateElapsed, 1000);
      return () => clearInterval(interval);
    }
  }, [activeEntry, settings?.targetAlertMinutes, addToast]);

  const activeTimecode = activeEntry ? timecodes.find(t => t.id === activeEntry.timecodeId) : null;

  const handleStop = async () => {
    if (activeEntry) {
      const tagsArray = localTags.split(',').map(t => t.trim()).filter(t => t !== '').slice(0, 20);
      const tagsChanged = JSON.stringify(tagsArray) !== JSON.stringify(activeEntry.tags || []);
      if (localNote !== activeEntry.note || tagsChanged) {
        await updateActiveNote(activeEntry.id, localNote, tagsArray);
      }
      await stopTimer(activeEntry.id);
    }
  };

  return (
    <div className={`relative bg-white dark:bg-graphite p-6 rounded-panel shadow-md dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] border ${
      activeEntry && !activeEntry.isPaused
        ? 'border-signal/50 dark:border-signal/40 ring-1 ring-signal/20'
        : 'border-graphite/20 dark:border-white/15'
    } max-w-md w-full mx-auto flex flex-col items-center transition-all duration-200`}>
      {!activeEntry ? (
        <div className="w-full flex flex-col items-center gap-5">
          <div className="px-6 py-2.5 rounded-lg bg-stone/60 dark:bg-ink/60 border border-graphite/10 dark:border-white/10 shadow-inner">
            <span className="text-5xl font-mono font-medium tracking-wider tabular text-gray-400 dark:text-gray-500">
              00:00
            </span>
          </div>

          <div className="w-full relative z-20">
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 text-center">What are you working on?</label>
            <TimecodeSelector onSelect={setSelectedTimecodeId} selectedId={selectedTimecodeId} />
          </div>

          <div className="w-full space-y-2">
            <input
              type="text"
              maxLength={2000}
              placeholder="Add a note (optional)"
              className="w-full text-center text-sm px-3.5 py-2 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-all bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
              value={preStartNote}
              onChange={(e) => setPreStartNote(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                maxLength={500}
                placeholder="Tags (e.g. design, client)"
                className="w-full text-center text-xs px-3 py-1.5 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-all bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
                value={preStartTags}
                onChange={(e) => setPreStartTags(e.target.value)}
              />
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Est. mins (optional)"
                className="w-full text-center text-xs px-3 py-1.5 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-all bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
                value={preStartExpectedMinutes}
                onChange={(e) => setPreStartExpectedMinutes(e.target.value)}
              />
            </div>
          </div>

          <button
            disabled={!selectedTimecodeId}
            onClick={() => {
              if (!selectedTimecodeId) return;
              unlockAudioAlert();
              requestNotificationPermission();
              const tagsArray = preStartTags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 20);
              const expected = preStartExpectedMinutes ? Math.max(1, Number(preStartExpectedMinutes)) : null;
              startTimer(selectedTimecodeId, preStartNote, tagsArray, expected);
              setPreStartNote('');
              setPreStartTags('');
              setPreStartExpectedMinutes('');
            }}
            className="mt-1 w-16 h-16 rounded-full bg-signal hover:bg-amber-500 active:scale-95 text-ink flex items-center justify-center shadow-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
            aria-label="Start Timer (Cmd/Ctrl+Shift+S)"
            title="Start Timer (Cmd/Ctrl+Shift+S)"
          >
            <Play size={24} className="ml-1 text-ink fill-current" />
          </button>
        </div>
      ) : (
        <div className="w-full flex flex-col items-center gap-4">

          <div className="flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-signal-dim dark:text-signal mb-1">
              {activeEntry.isPaused ? 'PAUSED' : 'RECORDING'}
            </span>
            <div className="flex items-center gap-2 bg-stone/50 dark:bg-ink/40 px-3 py-1 rounded-full border border-graphite/10 dark:border-white/10">
              <div
                className="w-3 h-3 rounded-full shadow-sm"
                style={{ backgroundColor: activeTimecode?.color || '#cbd5e1' }}
              ></div>
              <span className="text-base font-semibold text-gray-800 dark:text-gray-200">
                {activeTimecode?.name || 'Unknown Timecode'}
              </span>
            </div>
          </div>

          <div className="px-6 py-2 rounded-xl bg-stone/70 dark:bg-ink/70 border border-graphite/15 dark:border-white/15 shadow-inner flex items-center gap-3">
            <div className={`w-3.5 h-3.5 rounded-full ${activeEntry.isPaused ? 'bg-verdigris' : 'bg-signal recording-dot'}`}></div>
            <div className="text-5xl sm:text-6xl font-mono font-semibold tracking-wider tabular text-graphite dark:text-stone">
              {formatElapsedSeconds(elapsedSeconds)}
            </div>
          </div>

          {activeEntry.expectedDurationMinutes ? (
            <div className="flex items-center gap-2 text-xs font-mono tabular -mt-1">
              <span className="text-gray-500 dark:text-gray-400">
                Est. {formatDurationShort(activeEntry.expectedDurationMinutes * 60)}
              </span>
              <span className="text-gray-300 dark:text-gray-600">•</span>
              {elapsedSeconds > activeEntry.expectedDurationMinutes * 60 ? (
                <span className="text-rust font-medium">
                  {formatDurationShort(elapsedSeconds - activeEntry.expectedDurationMinutes * 60)} over
                </span>
              ) : (
                <span className="text-verdigris dark:text-emerald-400 font-medium">
                  {formatDurationShort(activeEntry.expectedDurationMinutes * 60 - elapsedSeconds)} left
                </span>
              )}
            </div>
          ) : null}

          <div className="w-full mt-1 space-y-2">
            <input
              type="text"
              maxLength={2000}
              placeholder="Add a note..."
              className="w-full text-center text-sm px-3.5 py-2 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-all bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
              value={localNote}
              onChange={(e) => setLocalNote(e.target.value)}
            />
            <input
              type="text"
              maxLength={500}
              placeholder="Tags (e.g. design, review)"
              className="w-full text-center text-xs px-3 py-1.5 border border-graphite/20 dark:border-white/20 hover:border-graphite/30 dark:hover:border-white/30 focus:border-signal dark:focus:border-signal rounded-panel outline-none transition-all bg-white dark:bg-graphite text-graphite dark:text-stone placeholder-gray-400 dark:placeholder-gray-500 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
              value={localTags}
              onChange={(e) => setLocalTags(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-4 mt-2">
            {activeEntry.isPaused ? (
              <button
                onClick={() => resumeTimer(activeEntry.id)}
                className="w-14 h-14 rounded-full bg-verdigris text-white hover:bg-verdigris-dim active:scale-95 flex items-center justify-center transition-all shadow-md focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
                title="Resume"
                aria-label="Resume Timer"
              >
                <Play size={20} className="ml-1" />
              </button>
            ) : (
              <button
                onClick={() => pauseTimer(activeEntry.id)}
                className="w-14 h-14 rounded-full bg-stone dark:bg-gray-700 text-graphite dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 active:scale-95 flex items-center justify-center transition-all shadow-sm focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
                title="Pause"
                aria-label="Pause Timer"
              >
                <Pause size={20} />
              </button>
            )}

            <button
              onClick={handleStop}
              className="w-16 h-16 rounded-full bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-200 active:scale-95 text-stone dark:text-ink flex items-center justify-center shadow-lg transition-all focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite"
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
