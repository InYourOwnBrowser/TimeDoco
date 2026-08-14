import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { differenceInDays } from 'date-fns';
import { X, AlertCircle } from 'lucide-react';

export const BackupReminderBanner: React.FC = () => {
  const { settings, exportData } = useTimeTracker();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!settings) return;

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
    <div className="w-full bg-blue-50 dark:bg-blue-900/50 border-b border-blue-100 dark:border-blue-800/50 px-4 py-3 sm:px-6 lg:px-8 mb-4 rounded-md shadow-sm">
      <div className="flex items-center justify-between flex-wrap">
        <div className="w-0 flex-1 flex items-center">
          <span className="flex p-2 rounded-lg bg-blue-100 dark:bg-blue-800/50">
            <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          </span>
          <p className="ml-3 font-medium text-blue-800 dark:text-blue-200 truncate">
            <span>It has been a while since your last backup. We recommend exporting your data soon.</span>
          </p>
        </div>
        <div className="order-2 flex-shrink-0 sm:order-3 sm:ml-3 flex items-center gap-2">
          <button
            onClick={() => {
              exportData();
              handleDismiss();
            }}
            className="px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 dark:text-blue-200 dark:bg-blue-800/60 dark:hover:bg-blue-700/80 rounded-md transition-colors"
          >
            Export Now
          </button>
          <button
            type="button"
            className="-mr-1 flex p-2 rounded-md hover:bg-blue-100 dark:hover:bg-blue-800/50 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:-mr-2 transition-colors"
            onClick={handleDismiss}
          >
            <span className="sr-only">Dismiss</span>
            <X className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
