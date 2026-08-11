import { TimeTrackerProvider } from './context/TimeTrackerContext';
import { ActiveTimer } from './components/ActiveTimer';
import { EntryList } from './components/EntryList';
import { ForgotToStopPrompt } from './components/ForgotToStopPrompt';

function App() {
  return (
    <TimeTrackerProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col items-center pt-12 px-4 font-sans text-gray-900 pb-24">

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
      </div>
    </TimeTrackerProvider>
  );
}

export default App;
