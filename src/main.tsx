import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      {/* Registers the service worker, and asks before swapping the build out
          from under whatever the user is in the middle of. */}
      <PwaUpdatePrompt />
    </ErrorBoundary>
  </StrictMode>,
)
