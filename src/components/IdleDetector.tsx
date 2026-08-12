import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';

export const IdleDetector: React.FC = () => {
  const { activeEntries, settings, pauseTimer } = useTimeTracker();
  const [showPrompt, setShowPrompt] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  // Restart the idle timer when there is activity
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }

    // Only detect idle if there are running, unpaused entries and the threshold is set
    const hasRunningTimers = activeEntries.some(entry => !entry.isPaused);
    const thresholdMinutes = settings?.idleThresholdMinutes;

    if (hasRunningTimers && thresholdMinutes && thresholdMinutes > 0) {
      idleTimerRef.current = window.setTimeout(() => {
        setShowPrompt(true);
      }, thresholdMinutes * 60 * 1000);
    }
  }, [activeEntries, settings?.idleThresholdMinutes]);

  // Activity events that reset the timer
  useEffect(() => {
    // Only bind events if we have running entries to track for idleness
    const hasRunningTimers = activeEntries.some(entry => !entry.isPaused);
    if (!hasRunningTimers || showPrompt) {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
      return;
    }

    resetIdleTimer();

    const activityEvents = ['mousemove', 'keydown', 'wheel', 'mousedown', 'touchstart'];
    const handleActivity = () => {
      // Throttle slightly so we aren't clearing timeouts a hundred times a second on mousemove
      resetIdleTimer();
    };

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
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
      }
    };
  }, [activeEntries, settings?.idleThresholdMinutes, showPrompt, resetIdleTimer]);

  const handleKeepRunning = () => {
    setShowPrompt(false);
    resetIdleTimer();
  };

  const handleStopWorking = async () => {
    setShowPrompt(false);

    // The user was idle for `idleThresholdMinutes` before the prompt appeared.
    // They stopped working, which means they likely stopped working exactly when they went idle.
    // To represent this, we can pause the currently running timers.
    // (A more advanced implementation would edit their endTime backward,
    // but pausing is safer since they can edit the duration later or resume if they want).
    for (const entry of activeEntries) {
      if (!entry.isPaused) {
        await pauseTimer(entry.id);
      }
    }
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Still working?</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          You've been idle for {settings?.idleThresholdMinutes} minutes. Are you still working on this task?
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={handleStopWorking}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            No, pause timers
          </button>
          <button
            onClick={handleKeepRunning}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Yes, keep running
          </button>
        </div>
      </div>
    </div>
  );
};