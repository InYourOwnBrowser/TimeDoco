import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { differenceInDays } from 'date-fns';
import { X, AlertCircle } from 'lucide-react';

export const BackupReminderBanner: React.FC = () => {
  const { settings, exportData, entries, timecodes, groups } = useTimeTracker();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!settings) return;

    const hasData = entries.length > 0 || timecodes.length > 0 || groups.length > 0;
    if (!hasData) {
      setIsVisible(false);
      return;
    }

    let shouldShow = false;
    if (!settings.lastBackupDate) {
      shouldShow = true;
    } else {
      const daysSince = differenceInDays(new Date(), new Date(settings.lastBackupDate));
      if (daysSince >= settings.reminderIntervalDays) {
        shouldShow = true;
      }
    }

    // Check if dismissed in this session
    const dismissalData = localStorage.getItem('backupReminderDismissed');
    let isDismissed = false;
    if (dismissalData) {
      try {
        const { timestamp } = JSON.parse(dismissalData);
        // Only keep dismissed if less than 24 hours ago
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          isDismissed = true;
        } else {
          localStorage.removeItem('backupReminderDismissed');
        }
      } catch {
        localStorage.removeItem('backupReminderDismissed');
      }
    }
    if (shouldShow && !isDismissed) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [settings]);

  const handleDismiss = () => {
    localStorage.setItem('backupReminderDismissed', JSON.stringify({ timestamp: Date.now() }));
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="w-full bg-signal/10 dark:bg-signal/20 border-b border-signal/20 dark:border-signal/30 px-4 py-3 sm:px-6 lg:px-8 mb-4 rounded-md shadow-sm">
      <div className="flex items-center justify-between flex-wrap">
        <div className="w-0 flex-1 flex items-center">
          <span className="flex p-2 rounded-lg bg-signal/20 dark:bg-signal/30">
            <AlertCircle className="h-5 w-5 text-signal dark:text-signal" aria-hidden="true" />
          </span>
          <p className="ml-3 font-medium text-signal dark:text-signal truncate">
            <span>It has been a while since your last backup. We recommend exporting your data soon.</span>
          </p>
        </div>
        <div className="order-2 flex-shrink-0 sm:order-3 sm:ml-3 flex items-center gap-2">
          <button
            onClick={() => {
              exportData();
              handleDismiss();
            }}
            className="px-3 py-1.5 text-sm font-medium text-stone dark:text-ink bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 rounded-md transition-colors"
          >
            Export Now
          </button>
          <button
            type="button"
            className="-mr-1 flex p-2 rounded-md hover:bg-signal/20 dark:hover:bg-signal/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:-mr-2 transition-colors"
            onClick={handleDismiss}
          >
            <span className="sr-only">Dismiss</span>
            <X className="h-5 w-5 text-signal dark:text-signal" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
