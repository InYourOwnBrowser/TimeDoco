import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

if ('serviceWorker' in navigator) {
  // Offline support is a bonus, not a requirement — but a rejection here is
  // worth a line in the console rather than an unhandled one.
  navigator.serviceWorker.register('/sw.js', { scope: '/app/' })
    .catch((error) => console.error('Service worker registration failed', error));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
