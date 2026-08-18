import { useState, useEffect, Suspense, lazy, useRef, useCallback } from 'react';
import { TimeTrackerProvider } from './context/TimeTrackerContext';
import { ActiveTimer } from './components/ActiveTimer';
import { EntryList } from './components/EntryList';
import { ForgotToStopPrompt } from './components/ForgotToStopPrompt';
import { TemplateList } from './components/TemplateList';
import { BackupReminderBanner } from './components/BackupReminderBanner';
import { SettingsModal } from './components/SettingsModal';
const AnalysisView = lazy(() => import('./components/AnalysisView').then(module => ({ default: module.AnalysisView })));
const GroupingManagement = lazy(() => import('./components/GroupingManagement').then(module => ({ default: module.GroupingManagement })));
const TimesheetView = lazy(() => import('./components/TimesheetView').then(module => ({ default: module.TimesheetView })));
const ResourcesView = lazy(() => import('./components/ResourcesView').then(module => ({ default: module.ResourcesView })));
import { WeeklySummary } from './components/WeeklySummary';
import { IdleDetector } from './components/IdleDetector';
import { Settings, BarChart2, Clock, ListTree, CalendarDays, Sparkles } from 'lucide-react';
import { useTimeTracker } from './context/TimeTrackerContext';
import { ToastProvider, useToast } from './context/ToastContext';

import { getElapsedTimeMs, formatElapsedSeconds } from './utils/timeUtils';
import { GlobalActiveTimerBar } from './components/GlobalActiveTimerBar';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { Logo } from './components/ui/Logo';
import { Download, Save } from 'lucide-react';

// Extracted inner component so we can use TimeTrackerContext
const AppContent = () => {
  const { activeEntries, stopTimer, startTimer, timecodes, entries, settings, forgotToStopEntry, exportData } = useTimeTracker();
  const { addToast } = useToast();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);
  const [activeTab, setActiveTab] = useState<'tracker' | 'timesheet' | 'analysis' | 'management' | 'resources'>('tracker');
  const [showNewTimer, setShowNewTimer] = useState(false);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const { canInstall, promptInstall, installed } = useInstallPrompt();

  const wasInstalled = useRef(installed);

  useEffect(() => {
    if (installed && !wasInstalled.current) {
      addToast('Installed! Note: TimeDoco stores data locally on this device — use Backup/Export to move it to another device.', 'success', undefined, 8000);
    }
    wasInstalled.current = installed;
  }, [installed, addToast]);

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
      document.title = 'TimeDoco';
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
         document.title = 'TimeDoco';
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
        <div className="w-full max-w-3xl absolute top-4 right-4 flex justify-end gap-2">
          {canInstall && (
            <button
              onClick={promptInstall}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink transition-colors"
            >
              <Download size={14} /> Install App
            </button>
          )}
          <button
            onClick={() => exportData()}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors"
            aria-label="Backup data"
            title="Backup data"
          >
            <Save size={24} />
          </button>
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
          <Logo className="h-20 w-auto mx-auto mb-2" />
          <p className="text-gray-500 dark:text-gray-400 mb-6">100% Client-Side. Privacy First.</p>

          <div className="flex justify-center mb-4 w-full px-4 sm:px-0">
            <div className="bg-stone dark:bg-ink p-1 rounded-panel flex w-full sm:w-auto overflow-x-auto hide-scrollbar border border-graphite/10 dark:border-white/10 shadow-inner">
              <button
                onClick={() => setActiveTab('tracker')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-3 sm:px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                  activeTab === 'tracker'
                    ? 'bg-signal/10 text-signal-dim dark:text-signal border-b-2 border-signal rounded-none'
                    : 'text-graphite dark:text-stone hover:text-gray-900 dark:hover:text-white rounded-panel'
                }`}
                aria-label="Tracker"
                title="Tracker"
              >
                <Clock size={16} className="sm:mr-2" />
                <span className="hidden sm:inline">Tracker</span>
              </button>
              <button
                onClick={() => setActiveTab('timesheet')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-3 sm:px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                  activeTab === 'timesheet'
                    ? 'bg-signal/10 text-signal-dim dark:text-signal border-b-2 border-signal rounded-none'
                    : 'text-graphite dark:text-stone hover:text-gray-900 dark:hover:text-white rounded-panel'
                }`}
                aria-label="Timesheet"
                title="Timesheet"
              >
                <CalendarDays size={16} className="sm:mr-2" />
                <span className="hidden sm:inline">Timesheet</span>
              </button>
              <button
                onClick={() => setActiveTab('analysis')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-3 sm:px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                  activeTab === 'analysis'
                    ? 'bg-signal/10 text-signal-dim dark:text-signal border-b-2 border-signal rounded-none'
                    : 'text-graphite dark:text-stone hover:text-gray-900 dark:hover:text-white rounded-panel'
                }`}
                aria-label="Analysis"
                title="Analysis"
              >
                <BarChart2 size={16} className="sm:mr-2" />
                <span className="hidden sm:inline">Analysis</span>
              </button>
              <button
                onClick={() => setActiveTab('management')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-3 sm:px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                  activeTab === 'management'
                    ? 'bg-signal/10 text-signal-dim dark:text-signal border-b-2 border-signal rounded-none'
                    : 'text-graphite dark:text-stone hover:text-gray-900 dark:hover:text-white rounded-panel'
                }`}
                aria-label="Management"
                title="Management"
              >
                <ListTree size={16} className="sm:mr-2" />
                <span className="hidden sm:inline">Management</span>
              </button>
              <button
                onClick={() => setActiveTab('resources')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-3 sm:px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${
                  activeTab === 'resources'
                    ? 'bg-signal/10 text-signal-dim dark:text-signal border-b-2 border-signal rounded-none'
                    : 'text-graphite dark:text-stone hover:text-gray-900 dark:hover:text-white rounded-panel'
                }`}
                aria-label="Resources"
                title="Resources"
              >
                <Sparkles size={16} className="sm:mr-2" />
                <span className="hidden sm:inline">Resources</span>
              </button>
            </div>
          </div>
        </header>

        <main className={`w-full flex flex-col items-center ${activeTab === 'timesheet' || activeTab === 'management' ? 'max-w-5xl' : 'max-w-3xl'}`}>
          {activeTab === 'tracker' && (
            <>
              <h1 className="sr-only">TimeDoco — Time Tracker</h1>
              {activeEntries.map(entry => (
                <ActiveTimer key={entry.id} activeEntry={entry} />
              ))}
              {(activeEntries.length === 0 || showNewTimer) && (
                <ActiveTimer activeEntry={null} />
              )}
              {activeEntries.length > 0 && !showNewTimer && settings?.allowConcurrentTimers && (
                <button
                  onClick={() => setShowNewTimer(true)}
                  className="mb-8 px-4 py-2 text-sm font-medium text-graphite/60 dark:text-stone/60 bg-gray-50 dark:bg-gray-800/30 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-panel transition-colors border border-graphite/20 dark:border-white/20 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                >
                  + Start Another Timer
                </button>
              )}
              <TemplateList />
              <WeeklySummary />
              <EntryList />
            </>
          )}
          {activeTab === 'timesheet' && <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading timesheet...</div>}><TimesheetView /></Suspense>}
          {activeTab === 'analysis' && <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading analysis...</div>}><AnalysisView /></Suspense>}
          {activeTab === 'management' && <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading management...</div>}><GroupingManagement /></Suspense>}
          {activeTab === 'resources' && <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading resources...</div>}><ResourcesView /></Suspense>}
        </main>

        {isSettingsOpen && <SettingsModal onClose={handleCloseSettings} />}

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
