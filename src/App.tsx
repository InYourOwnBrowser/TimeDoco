import { useState } from 'react';
import { TimeTrackerProvider } from './context/TimeTrackerContext';
import { ActiveTimer } from './components/ActiveTimer';
import { EntryList } from './components/EntryList';
import { ForgotToStopPrompt } from './components/ForgotToStopPrompt';
import { BackupReminderBanner } from './components/BackupReminderBanner';
import { SettingsModal } from './components/SettingsModal';
import { AnalysisView } from './components/AnalysisView';
import { Settings, BarChart2, Clock } from 'lucide-react';

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'tracker' | 'analysis'>('tracker');

  return (
    <TimeTrackerProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col items-center pt-12 px-4 font-sans text-gray-900 pb-24 relative">
        <div className="w-full max-w-3xl absolute top-4 right-4 flex justify-end">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-full transition-colors"
            aria-label="Settings"
          >
            <Settings size={24} />
          </button>
        </div>

        <div className="w-full max-w-3xl mb-4">
          <BackupReminderBanner />
        </div>

        <div className="w-full max-w-3xl mb-8">
          <ForgotToStopPrompt />
        </div>

        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">Time Tracker</h1>
          <p className="text-gray-500 mb-6">100% Client-Side. Privacy First.</p>

          <div className="flex justify-center mb-4">
            <div className="bg-gray-200 p-1 rounded-lg inline-flex">
              <button
                onClick={() => setActiveTab('tracker')}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'tracker'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Clock size={16} className="mr-2" />
                Tracker
              </button>
              <button
                onClick={() => setActiveTab('analysis')}
                className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'analysis'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <BarChart2 size={16} className="mr-2" />
                Analysis
              </button>
            </div>
          </div>
        </header>

        <main className="w-full max-w-3xl flex flex-col items-center">
          {activeTab === 'tracker' ? (
            <>
              <ActiveTimer />
              <EntryList />
            </>
          ) : (
            <AnalysisView />
          )}
        </main>

        {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
      </div>
    </TimeTrackerProvider>
  );
}

export default App;
