import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { settleDeferredWrites } from '../hooks/useDeferredWrite';

/**
 * Registers the service worker, and asks before replacing the running build.
 *
 * Nothing used to send the waiting worker its cue, so an update installed and
 * then sat there until every tab was closed — which, for an installed PWA, can
 * be never. The other half of the problem is what happens if it takes over on
 * its own: activation cleans up the previous build's precache, and a tab still
 * running that build then asks for chunks nothing serves any more. Reloading
 * mid-session is its own hazard, too. `SettingField` writes on blur, Enter,
 * unmount or an idle pause, so a reload the user did not ask for can land
 * inside a debounce window and take the edit with it.
 *
 * So the choice is deliberate: install in the background, then let the user
 * pick the moment. Declining leaves the current build running and working.
 */

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

// registerSW is a side effect on the document, not on this component: React 19
// mounts effects twice under StrictMode, and two registrations race each other
// over the same worker.
let registration: { updateSW: UpdateServiceWorker; onNeedRefresh: Set<() => void> } | null = null;

const ensureRegistered = (onNeedRefresh: () => void): (() => void) => {
  if (!registration) {
    const listeners = new Set<() => void>();
    const updateSW = registerSW({
      onNeedRefresh: () => listeners.forEach((listener) => listener()),
      onRegisterError: (error: unknown) => {
        // Offline support is a bonus, not a requirement — but a rejection here
        // is worth a line in the console rather than an unhandled one.
        console.error('Service worker registration failed', error);
      },
    });
    registration = { updateSW, onNeedRefresh: listeners };
  }
  registration.onNeedRefresh.add(onNeedRefresh);
  const subscribed = registration;
  return () => subscribed.onNeedRefresh.delete(onNeedRefresh);
};

export const PwaUpdatePrompt = () => {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateRef = useRef<UpdateServiceWorker | null>(null);

  useEffect(() => {
    const unsubscribe = ensureRegistered(() => setNeedsRefresh(true));
    updateRef.current = registration?.updateSW ?? null;
    return unsubscribe;
  }, []);

  if (!needsRefresh) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] w-[min(28rem,calc(100vw-2rem))] bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 rounded-panel shadow-lg p-4 flex items-start gap-3"
    >
      <div className="flex-1 text-sm text-graphite dark:text-stone">
        <p className="font-semibold">A new version of TimeDoco is ready.</p>
        <p className="text-graphite/70 dark:text-stone/70 mt-0.5">
          Reloading applies it. Anything you are part-way through typing is saved first — finish it if you would rather wait.
        </p>
      </div>
      <div className="flex flex-col gap-2 shrink-0">
        <button
          onClick={() => {
            setUpdating(true);
            // The banner above promises pending typing is saved first, and this
            // is the only place that can keep that promise: the worker takes
            // over and the registration reloads on `controlling`, and React
            // runs no effect cleanup for a reload — so the note on a running
            // timer and every `SettingField` mid-debounce would go down with
            // the page. Same helper the stale-chunk recovery uses; it was the
            // only caller, and this path was the one that needed it most.
            //
            // The reload is still the worker's to do once it has taken over.
            void settleDeferredWrites().then(() => updateRef.current?.(true));
          }}
          disabled={updating}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-panel bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink transition-colors disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
        >
          <RefreshCw size={14} className={updating ? 'animate-spin' : undefined} />
          {updating ? 'Reloading…' : 'Reload'}
        </button>
        <button
          onClick={() => setNeedsRefresh(false)}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-panel border border-graphite/20 dark:border-white/20 text-graphite/80 dark:text-stone/80 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
          aria-label="Dismiss update notice"
        >
          <X size={14} />
          Later
        </button>
      </div>
    </div>
  );
};
