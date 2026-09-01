import { useState, useEffect, Suspense, lazy, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TimeTrackerProvider } from './context/TimeTrackerContext';
import { BlogIndex } from './components/BlogIndex';
import { BlogPost } from './components/BlogPost';
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
import { OverrunDetector } from './components/OverrunDetector';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Settings, BarChart2, Clock, ListTree, CalendarDays, Sparkles } from 'lucide-react';
import { useTimeTracker } from './context/TimeTrackerContext';
import { ToastProvider, useToast } from './context/ToastContext';

import { getElapsedTimeMs, formatElapsedSeconds } from './utils/timeUtils';
import { GlobalActiveTimerBar } from './components/GlobalActiveTimerBar';
import { useInstallPrompt } from './hooks/useInstallPrompt';
import { useNamedDownload } from './hooks/useNamedDownload';
import { IOSInstallModal } from './components/IOSInstallModal';
import { Logo } from './components/ui/Logo';
import { Download, Save } from 'lucide-react';
import { SocialLinks } from './components/SocialLinks';
import { logError } from './utils/errorLog';

// Extracted inner component so we can use TimeTrackerContext
const AppContent = () => {
  useEffect(() => {
    const handleShowInstallModal = () => setShowIOSInstallModal(true);
    window.addEventListener('show-ios-install-modal', handleShowInstallModal);
    return () => window.removeEventListener('show-ios-install-modal', handleShowInstallModal);
  }, []);

  useEffect(() => {
    const onError = (e: ErrorEvent) => logError(e.error ?? new Error(e.message), 'window.onerror');
    const onRejection = (e: PromiseRejectionEvent) => logError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), 'unhandledrejection');
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  const { activeEntries, stopTimer, startTimer, timecodes, entries, settings, forgotToStopEntry, getBackupBlob, markBackupSaved } = useTimeTracker();
  const { triggerDownload, SaveAsDialog } = useNamedDownload();
  const { addToast } = useToast();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);
  const [activeTab, setActiveTab] = useState<'tracker' | 'timesheet' | 'analysis' | 'management' | 'resources'>('tracker');
  const [showNewTimer, setShowNewTimer] = useState(false);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const { canInstall, promptInstall, installed, needsManualInstall } = useInstallPrompt();
  const [showIOSInstallModal, setShowIOSInstallModal] = useState(false);
  const [isOverrunPromptActive, setIsOverrunPromptActive] = useState(false);

  const handleInstallClick = useCallback(() => {
    if (needsManualInstall) {
      setShowIOSInstallModal(true);
    } else {
      void promptInstall();
    }
  }, [needsManualInstall, promptInstall]);

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

  // Prevent accidental navigation/closure when in fallback mode
  useEffect(() => {
    if (!isFallbackMode) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Storage error detected. App is running in memory fallback mode. Data will be lost if you close this page.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isFallbackMode]);

  // Calculate elapsed time for document title
  useEffect(() => {
    let flashOn = false;

    const updateTitle = () => {
      if (activeEntries.length === 0) {
        if (isOverrunPromptActive && document.hidden && flashOn) {
          document.title = '⏰ Past estimate! · TimeDoco';
        } else {
          document.title = 'TimeDoco';
        }
        return;
      }

      // Prioritize running entries over paused entries
      const runningEntry = activeEntries.find(e => !e.isPaused);
      const primaryEntry = runningEntry || [...activeEntries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
      const activeTimecode = timecodes.find(t => t.id === primaryEntry.timecodeId);

      if (isOverrunPromptActive && document.hidden && flashOn) {
        document.title = '⏰ Past estimate! · TimeDoco';
        return;
      }

      if (activeTimecode) {
        const elapsedMs = getElapsedTimeMs(primaryEntry.startTime, primaryEntry.pausedSegments);
        const elapsed = Math.floor(elapsedMs / 1000);
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

    const anyRunning = activeEntries.some(e => !e.isPaused);
    if (anyRunning || isOverrunPromptActive) {
      const interval = setInterval(() => {
        flashOn = !flashOn;
        updateTitle();
      }, 500);
      return () => clearInterval(interval);
    }
  }, [activeEntries, timecodes, isOverrunPromptActive]);

  // Reset new timer form when a timer starts or concurrent is disabled
  useEffect(() => {
    setShowNewTimer(false);
  }, [activeEntries.length, settings?.allowConcurrentTimers]);

  useEffect(() => {
    const root = window.document.documentElement;
    const theme = settings?.theme || 'dark';

    root.classList.remove('light', 'dark');

    let activeTheme = theme;
    if (theme === 'system') {
      activeTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    root.classList.add(activeTheme);

    // Mirror the choice where the pre-hydration script can read it. IndexedDB
    // cannot be read synchronously before paint, so without this a user whose
    // explicit theme contradicts their OS preference sees the wrong one flash
    // on every load.
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Private mode or blocked storage: the boot script falls back to the OS
      // preference, which is what it did before.
    }

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
          void stopTimer(mostRecentActive.id);
        } else {
          // Find most recent timecode used
          const sortedEntries = [...entries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
          const recentTimecodeId = sortedEntries.length > 0 ? sortedEntries[0].timecodeId : null;

          if (recentTimecodeId) {
            // Make sure it's not archived
            const tc = timecodes.find(t => t.id === recentTimecodeId);
            if (tc && !tc.archived) {
              void startTimer(recentTimecodeId);
              return;
            }
          }

          // Fallback to the first available non-archived timecode
          const unarchived = timecodes.filter(t => !t.archived);
          if (unarchived.length > 0) {
            void startTimer(unarchived[0].id);
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
          <div className="w-full bg-red-600 text-white text-center py-2 px-4 font-medium text-sm shadow-sm sticky top-0 z-50 flex items-center justify-center gap-3">
            <span>⚠️ Storage Error: App is running in memory fallback mode. Your data will not be saved after you close this page.</span>
            <button
              onClick={() => {
                const dateStr = new Date().toISOString().split('T')[0];
                triggerDownload(getBackupBlob, `timedoco-fallback-backup-${dateStr}`, 'json', markBackupSaved);
              }}
              className="px-2.5 py-1 text-xs font-semibold bg-white text-red-700 hover:bg-gray-100 rounded-panel transition-colors flex items-center gap-1 shadow-sm"
            >
              <Save size={14} /> Export Backup
            </button>
          </div>
        )}
        <div className="w-full max-w-3xl absolute top-4 right-4 flex justify-end gap-2 items-center">
          {canInstall && (
            <button
              onClick={handleInstallClick}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-panel bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
            >
              <Download size={14} /> Install App
            </button>
          )}
          <button
            onClick={() => {
              const dateStr = new Date().toISOString().split('T')[0];
              triggerDownload(getBackupBlob, `timedoco-backup-${dateStr}`, 'json', markBackupSaved);
            }}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-800/60 rounded-panel transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
            aria-label="Backup data"
            title="Backup data"
          >
            <Save size={20} />
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-800/60 rounded-panel transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
            aria-label="Settings"
            title="Settings"
          >
            <Settings size={20} />
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
          <p className="text-gray-600 dark:text-gray-400 mb-6">Track time. Bill clients. Own your data.</p>

          <div className="flex justify-center mb-4 w-full px-4 sm:px-0">
            <div className="bg-white/80 dark:bg-graphite/90 backdrop-blur-md p-1.5 rounded-panel flex w-full sm:w-auto overflow-x-auto hide-scrollbar border border-graphite/20 dark:border-white/15 shadow-sm gap-1">
              <button
                onClick={() => setActiveTab('tracker')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-4 py-2 text-sm font-medium transition-all rounded-panel focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-ink ${
                  activeTab === 'tracker'
                    ? 'bg-signal/15 text-signal-dim dark:text-signal border border-signal/40 font-semibold shadow-xs'
                    : 'border border-transparent text-graphite/70 dark:text-stone/70 hover:text-graphite dark:hover:text-stone hover:bg-stone/50 dark:hover:bg-gray-800/50'
                }`}
                aria-label="Tracker"
                title="Tracker"
              >
                <Clock size={16} className="sm:mr-2 text-signal" />
                <span className="hidden sm:inline">Tracker</span>
              </button>
              <button
                onClick={() => setActiveTab('timesheet')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-4 py-2 text-sm font-medium transition-all rounded-panel focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-ink ${
                  activeTab === 'timesheet'
                    ? 'bg-signal/15 text-signal-dim dark:text-signal border border-signal/40 font-semibold shadow-xs'
                    : 'border border-transparent text-graphite/70 dark:text-stone/70 hover:text-graphite dark:hover:text-stone hover:bg-stone/50 dark:hover:bg-gray-800/50'
                }`}
                aria-label="Timesheet"
                title="Timesheet"
              >
                <CalendarDays size={16} className="sm:mr-2" />
                <span className="hidden sm:inline">Timesheet</span>
              </button>
              <button
                onClick={() => setActiveTab('analysis')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-4 py-2 text-sm font-medium transition-all rounded-panel focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-ink ${
                  activeTab === 'analysis'
                    ? 'bg-signal/15 text-signal-dim dark:text-signal border border-signal/40 font-semibold shadow-xs'
                    : 'border border-transparent text-graphite/70 dark:text-stone/70 hover:text-graphite dark:hover:text-stone hover:bg-stone/50 dark:hover:bg-gray-800/50'
                }`}
                aria-label="Analysis"
                title="Analysis"
              >
                <BarChart2 size={16} className="sm:mr-2" />
                <span className="hidden sm:inline">Analysis</span>
              </button>
              <button
                onClick={() => setActiveTab('management')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-4 py-2 text-sm font-medium transition-all rounded-panel focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-ink ${
                  activeTab === 'management'
                    ? 'bg-signal/15 text-signal-dim dark:text-signal border border-signal/40 font-semibold shadow-xs'
                    : 'border border-transparent text-graphite/70 dark:text-stone/70 hover:text-graphite dark:hover:text-stone hover:bg-stone/50 dark:hover:bg-gray-800/50'
                }`}
                aria-label="Management"
                title="Management"
              >
                <ListTree size={16} className="sm:mr-2" />
                <span className="hidden sm:inline">Management</span>
              </button>
              <button
                onClick={() => setActiveTab('resources')}
                className={`flex-1 sm:flex-none flex items-center justify-center sm:justify-start px-4 py-2 text-sm font-medium transition-all rounded-panel focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-ink ${
                  activeTab === 'resources'
                    ? 'bg-signal/15 text-signal-dim dark:text-signal border border-signal/40 font-semibold shadow-xs'
                    : 'border border-transparent text-graphite/70 dark:text-stone/70 hover:text-graphite dark:hover:text-stone hover:bg-stone/50 dark:hover:bg-gray-800/50'
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
                  className="mb-8 px-4 py-2 text-sm font-medium text-graphite/80 dark:text-stone/80 bg-white dark:bg-gray-800/30 hover:bg-gray-100 dark:hover:bg-gray-800/50 rounded-panel transition-colors border border-graphite/20 dark:border-white/20 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
                >
                  + Start Another Timer
                </button>
              )}
              <TemplateList />
              <WeeklySummary />
              <EntryList />
            </>
          )}
          {activeTab === 'timesheet' && <ErrorBoundary><Suspense fallback={<div className="p-8 text-center text-gray-500">Loading timesheet...</div>}><TimesheetView /></Suspense></ErrorBoundary>}
          {activeTab === 'analysis' && <ErrorBoundary><Suspense fallback={<div className="p-8 text-center text-gray-500">Loading analysis...</div>}><AnalysisView /></Suspense></ErrorBoundary>}
          {activeTab === 'management' && <ErrorBoundary><Suspense fallback={<div className="p-8 text-center text-gray-500">Loading management...</div>}><GroupingManagement /></Suspense></ErrorBoundary>}
          {activeTab === 'resources' && <ErrorBoundary><Suspense fallback={<div className="p-8 text-center text-gray-500">Loading resources...</div>}><ResourcesView /></Suspense></ErrorBoundary>}
        </main>

        <footer className="mt-12 mb-4 flex justify-center">
          <SocialLinks />
        </footer>

        {isSettingsOpen && <SettingsModal onClose={handleCloseSettings} />}
        {showIOSInstallModal && <IOSInstallModal onClose={() => setShowIOSInstallModal(false)} />}

        <IdleDetector />
        <OverrunDetector onPromptStateChange={setIsOverrunPromptActive} />

        {/* Render persistent global active timer bar when not on tracker tab */ }
        {activeTab !== 'tracker' && <GlobalActiveTimerBar />}

        <SaveAsDialog />
        </div>
  );
};

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL ? import.meta.env.BASE_URL.replace(/\/$/, '') : ''}>
      <ToastProvider>
        <TimeTrackerProvider>
          <Routes>
            <Route path="/blog" element={<BlogIndex />} />
            <Route path="/blog/" element={<BlogIndex />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/blog/:slug/" element={<BlogPost />} />
            <Route path="*" element={<AppContent />} />
          </Routes>
        </TimeTrackerProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
