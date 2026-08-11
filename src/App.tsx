import { useState } from 'react';
import { TimeTrackerProvider } from './context/TimeTrackerContext';
import { ActiveTimer } from './components/ActiveTimer';
import { EntryList } from './components/EntryList';
import { ForgotToStopPrompt } from './components/ForgotToStopPrompt';
import { BackupReminderBanner } from './components/BackupReminderBanner';
import { SettingsModal } from './components/SettingsModal';
import { Settings } from 'lucide-react';

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

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

        <header className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">Time Tracker</h1>
          <p className="text-gray-500">100% Client-Side. Privacy First.</p>
        </header>

        <main className="w-full max-w-3xl flex flex-col items-center">
          <ActiveTimer />
          <EntryList />
        </main>

        {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
      </div>
    </TimeTrackerProvider>
  );
}

export default App;
