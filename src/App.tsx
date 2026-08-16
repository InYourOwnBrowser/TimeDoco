import { useState, useEffect, Suspense, lazy } from 'react';
import { TimeTrackerProvider } from './context/TimeTrackerContext';
import { ActiveTimer } from './components/ActiveTimer';
import { EntryList } from './components/EntryList';
import { ForgotToStopPrompt } from './components/ForgotToStopPrompt';
import { TemplateList } from './components/TemplateList';
import { BackupReminderBanner } from './components/BackupReminderBanner';
import { SettingsModal } from './components/SettingsModal';
const AnalysisView = lazy(() => import('./components/AnalysisView').then(module => ({ default: module.AnalysisView })));
const GroupingManagement = lazy(() => import('./components/GroupingManagement').then(module => ({ default: module.GroupingManagement })));
import { WeeklySummary } from './components/WeeklySummary';
import { IdleDetector } from './components/IdleDetector';
import { Settings, BarChart2, Clock, ListTree } from 'lucide-react';
import { useTimeTracker } from './context/TimeTrackerContext';
import { ToastProvider, useToast } from './context/ToastContext';

import { getElapsedTimeMs, formatElapsedSeconds } from './utils/timeUtils';
import { GlobalActiveTimerBar } from './components/GlobalActiveTimerBar';

// Extracted inner component so we can use TimeTrackerContext
const AppContent = () => {
  const { activeEntries, stopTimer, startTimer, timecodes, entries, settings, forgotToStopEntry } = useTimeTracker();
  const { addToast } = useToast();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'tracker' | 'analysis' | 'management'>('tracker');
  const [showNewTimer, setShowNewTimer] = useState(false);
  const [isFallbackMode, setIsFallbackMode] = useState(false);

  // Listen for IndexedDB fallback mode globally
  useEffect(() => {
    const handleFallbackMode = () => {
      setIsFallbackMode(true);
      addToast('Storage error detected. App is running in memory fallback mode. Your data will not be saved after you close this page.', 'error', undefined, 10000);
    };
    window.addEventListener('idb-fallback-mode', handleFallbackMode);
    return () => window.removeEventListener('idb-fallback-mode', handleFallbackMode);
  }, [addToast]);

  // Calculate elapsed time for document title
  useEffect(() => {
    if (activeEntries.length === 0) {
      document.title = 'TimeTag';
      return;
    }

    // Pick the most recently started entry (last in the array usually, or sort by start time)
    const primaryEntry = [...activeEntries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
    const activeTimecode = timecodes.find(t => t.id === primaryEntry.timecodeId);

    const updateTitle = () => {
      const elapsedMs = getElapsedTimeMs(primaryEntry.startTime, primaryEntry.pausedSegments);
      const elapsed = Math.floor(elapsedMs / 1000);

      if (activeTimecode) {
        const timeStr = formatElapsedSeconds(elapsed);
        let prefix = primaryEntry.isPaused ? '⏸️' : '🔴';
        if (activeEntries.length > 1) {
          prefix = `[${activeEntries.length}] ${prefix}`;
        }
        document.title = `${prefix} ${timeStr} - ${activeTimecode.name}`;
      } else {
         document.title = 'TimeTag';
      }
    };

    updateTitle();

    // Only set interval if the primary entry is running
    if (!primaryEntry.isPaused) {
      const interval = setInterval(updateTitle, 500); // 500ms to ensure timely updates
      return () => clearInterval(interval);
    }
  }, [activeEntries, timecodes]);

  // Reset new timer form when a timer starts or concurrent is disabled
  useEffect(() => {
    setShowNewTimer(false);
  }, [activeEntries.length, settings?.allowConcurrentTimers]);

  useEffect(() => {
    const root = window.document.documentElement;
    const theme = settings?.theme || 'system';

    root.classList.remove('light', 'dark');

    let activeTheme = theme;
    if (theme === 'system') {
      activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    root.classList.add(activeTheme);

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', activeTheme === 'dark' ? '#111827' : '#f9fafb');
    }
  }, [settings?.theme]);

  // Keyboard shortcut to start/stop the most recent timer (Ctrl+Shift+S or Cmd+Shift+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();

        if (activeEntries && activeEntries.length > 0) {
          const mostRecentActive = [...activeEntries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
          stopTimer(mostRecentActive.id);
        } else {
          // Find most recent timecode used
          const sortedEntries = [...entries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
          const recentTimecodeId = sortedEntries.length > 0 ? sortedEntries[0].timecodeId : null;

          if (recentTimecodeId) {
            // Make sure it's not archived
            const tc = timecodes.find(t => t.id === recentTimecodeId);
            if (tc && !tc.archived) {
              startTimer(recentTimecodeId);
              return;
            }
          }

          // Fallback to the first available non-archived timecode
          const unarchived = timecodes.filter(t => !t.archived);
          if (unarchived.length > 0) {
            startTimer(unarchived[0].id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeEntries, entries, timecodes, startTimer, stopTimer]);

  return (
      <div className="min-h-screen bg-stone dark:bg-ink flex flex-col items-center pt-12 px-4 font-sans text-gray-900 dark:text-gray-100 pb-24 relative">
        {isFallbackMode && (
          <div className="w-full bg-red-600 text-white text-center py-2 px-4 font-medium text-sm shadow-sm sticky top-0 z-50">
            ⚠️ Storage Error: App is running in memory fallback mode. Your data will not be saved after you close this page.
          </div>
        )}
        <div className="w-full max-w-3xl absolute top-4 right-4 flex justify-end">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors"
            aria-label="Settings"
          >
            <Settings size={24} />
          </button>
        </div>

        {!forgotToStopEntry && (
          <div className="w-full max-w-3xl mb-4">
            <BackupReminderBanner />
          </div>
        )}

        <div className="w-full max-w-3xl mb-8">
          <ForgotToStopPrompt />
        </div>

        <header className="mb-8 text-center">
          <h1 className="text-3xl font-sans font-semibold text-graphite dark:text-stone mb-2 tracking-tight">TimeTag</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">100% Client-Side. Privacy First.</p>

          <div className="flex justify-center mb-4">
            <div className="bg-stone dark:bg-ink p-1 rounded-panel inline-flex border border-graphite/10 dark:border-white/10 shadow-inner">
              <button
                onClick={() => setActiveTab('tracker')}
                className={`flex items-center px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                  activeTab === 'tracker'
                    ? 'bg-signal/10 text-signal border-b-2 border-signal rounded-none'
                    : 'text-graphite dark:text-stone hover:text-gray-900 dark:hover:text-white rounded-panel'
                }`}
              >
                <Clock size={16} className="mr-2" />
                Tracker
              </button>
              <button
                onClick={() => setActiveTab('analysis')}
                className={`flex items-center px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                  activeTab === 'analysis'
                    ? 'bg-signal/10 text-signal border-b-2 border-signal rounded-none'
                    : 'text-graphite dark:text-stone hover:text-gray-900 dark:hover:text-white rounded-panel'
                }`}
              >
                <BarChart2 size={16} className="mr-2" />
                Analysis
              </button>
              <button
                onClick={() => setActiveTab('management')}
                className={`flex items-center px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                  activeTab === 'management'
                    ? 'bg-signal/10 text-signal border-b-2 border-signal rounded-none'
                    : 'text-graphite dark:text-stone hover:text-gray-900 dark:hover:text-white rounded-panel'
                }`}
              >
                <ListTree size={16} className="mr-2" />
                Management
              </button>
            </div>
          </div>
        </header>

        <main className="w-full max-w-3xl flex flex-col items-center">
          {activeTab === 'tracker' && (
            <>
              {activeEntries.map(entry => (
                <ActiveTimer key={entry.id} activeEntry={entry} />
              ))}
              {(activeEntries.length === 0 || showNewTimer) && (
                <ActiveTimer activeEntry={null} />
              )}
              {activeEntries.length > 0 && !showNewTimer && settings?.allowConcurrentTimers && (
                <button
                  onClick={() => setShowNewTimer(true)}
                  className="mb-8 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors border border-blue-200 dark:border-blue-800"
                >
                  + Start Another Timer
                </button>
              )}
              <TemplateList />
              <WeeklySummary />
              <EntryList />
            </>
          )}
          {activeTab === 'analysis' && <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading analysis...</div>}><AnalysisView /></Suspense>}
          {activeTab === 'management' && <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading management...</div>}><GroupingManagement /></Suspense>}
        </main>

        {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}

        <IdleDetector />

        {/* Render persistent global active timer bar when not on tracker tab */ }
        {activeTab !== 'tracker' && <GlobalActiveTimerBar />}
        </div>
  );
};

function App() {
  return (
    <ToastProvider>
      <TimeTrackerProvider>
        <AppContent />
      </TimeTrackerProvider>
    </ToastProvider>
  );
}

export default App;
