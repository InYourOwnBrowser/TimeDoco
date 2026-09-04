import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { Modal } from './ui/Modal';

export const IdleDetector: React.FC = () => {
  const { activeEntries, settings, pauseTimer } = useTimeTracker();
  const [showPrompt, setShowPrompt] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  const lastActivityTimeRef = useRef<number>(Date.now());

  /**
   * When the idle period began, captured at the moment the prompt was raised.
   *
   * The activity listeners stay attached while the prompt is on screen, so by
   * the time the user has moved the mouse over to "No, pause timers" the last
   * activity time is ~now. Reading it there put the retroactive pause at the
   * moment of the click and billed the whole idle period — the exact thing the
   * feature exists to remove.
   */
  const idleStartedAtRef = useRef<number | null>(null);

  // Record activity
  const handleActivity = useCallback(() => {
    lastActivityTimeRef.current = Date.now();
  }, []);

  // Activity events that record last activity
  useEffect(() => {
    const activityEvents = ['mousemove', 'keydown', 'wheel', 'mousedown', 'touchstart'];

    // Use a wrapper to throttle
    let lastCall = 0;
    const throttledHandler = () => {
      const now = Date.now();
      if (now - lastCall >= 1000) {
        lastCall = now;
        handleActivity();
      }
    };

    activityEvents.forEach((event) => {
      window.addEventListener(event, throttledHandler, { passive: true });
    });

    return () => {
      activityEvents.forEach((event) => {
        window.removeEventListener(event, throttledHandler);
      });
    };
  }, [handleActivity]);

  useEffect(() => {
    const hasRunningTimers = activeEntries.some(entry => !entry.isPaused);
    const thresholdMinutes = settings?.idleThresholdMinutes;

    if (!hasRunningTimers || showPrompt || !thresholdMinutes || thresholdMinutes <= 0) {
      if (idleTimerRef.current !== null) {
        window.clearInterval(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    if (idleTimerRef.current === null) {
      idleTimerRef.current = window.setInterval(() => {
        const now = Date.now();
        const idleMs = now - lastActivityTimeRef.current;
        if (idleMs >= thresholdMinutes * 60 * 1000) {
          // Freeze the idle-start instant here, before the prompt goes up and
          // the user's move towards it counts as activity.
          idleStartedAtRef.current = lastActivityTimeRef.current;
          setShowPrompt(true);
        }
      }, 5000);
    }

    return () => {
      if (idleTimerRef.current !== null) {
        window.clearInterval(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [activeEntries, settings?.idleThresholdMinutes, showPrompt]);

  const handleKeepRunning = () => {
    setShowPrompt(false);
    idleStartedAtRef.current = null;
    handleActivity();
  };

  const handleStopWorking = async () => {
    setShowPrompt(false);

    // The instant the idle period started, not the instant this was clicked.
    const idleStartTime = new Date(idleStartedAtRef.current ?? lastActivityTimeRef.current);
    idleStartedAtRef.current = null;

    for (const entry of activeEntries) {
      if (!entry.isPaused) {
        const lastPauseEnd = entry.pausedSegments.length > 0
          ? new Date(entry.pausedSegments[entry.pausedSegments.length - 1].pauseEnd || entry.startTime)
          : new Date(entry.startTime);

        const effectivePauseStart = new Date(
          Math.max(idleStartTime.getTime(), lastPauseEnd.getTime(), new Date(entry.startTime).getTime())
        );

        await pauseTimer(entry.id, effectivePauseStart.toISOString());
      }
    }
  };

  if (!showPrompt) return null;

  return (
    <Modal onClose={handleKeepRunning} label="Still working?">
      <div className="bg-white dark:bg-graphite rounded-panel shadow-xl border border-graphite/20 dark:border-white/20 max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-xl font-semibold text-graphite dark:text-stone mb-2">Still working?</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          You've been idle for {settings?.idleThresholdMinutes} minutes. Are you still working on this task?
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={handleStopWorking}
            className="px-4 py-2 text-sm font-medium text-graphite dark:text-stone bg-white dark:bg-gray-800/30 border border-graphite/20 dark:border-white/20 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-panel transition-colors"
          >
            No, pause timers
          </button>
          <button
            onClick={handleKeepRunning}
            className="px-4 py-2 text-sm font-medium bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink rounded-panel transition-colors"
          >
            Yes, keep running
          </button>
        </div>
      </div>
    </Modal>
  );
};