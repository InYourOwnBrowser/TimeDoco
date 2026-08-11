import { TimeTrackerProvider } from './context/TimeTrackerContext';
import { ActiveTimer } from './components/ActiveTimer';

function App() {
  return (
    <TimeTrackerProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col items-center pt-24 px-4 font-sans text-gray-900">
        <header className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 tracking-tight">Time Tracker</h1>
          <p className="text-gray-500">100% Client-Side. Privacy First.</p>
        </header>

        <main className="w-full max-w-3xl flex justify-center">
          <ActiveTimer />
        </main>
      </div>
    </TimeTrackerProvider>
  );
}

export default App;
