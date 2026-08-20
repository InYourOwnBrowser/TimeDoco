import React from 'react';
import { X, Share, SquarePlus } from 'lucide-react';
import { Modal } from './ui/Modal';

interface IOSInstallModalProps {
  onClose: () => void;
}

// iOS never fires `beforeinstallprompt`, so there is no programmatic way to
// trigger the install flow the way we can on Android/desktop. This walks the
// user through the manual Share -> "Add to Home Screen" flow instead.
export const IOSInstallModal: React.FC<IOSInstallModalProps> = ({ onClose }) => {
  return (
    <Modal onClose={onClose}>
      <div className="bg-white dark:bg-graphite rounded-panel shadow-xl w-full max-w-sm overflow-hidden flex flex-col border border-graphite/20 dark:border-white/20">
        <div className="flex justify-between items-center p-4 border-b border-graphite/20 dark:border-white/20">
          <h2 className="text-lg font-semibold text-graphite dark:text-stone">Install TimeDoco</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            iOS doesn't let apps trigger an install prompt directly, but you can add TimeDoco to your Home Screen in a few taps — it'll open full-screen, just like a native app.
          </p>

          <ol className="space-y-4">
            <li className="flex gap-3 items-start">
              <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-graphite dark:bg-stone text-stone dark:text-ink text-sm font-semibold">1</span>
              <p className="text-sm text-graphite dark:text-stone pt-0.5">
                Tap the <Share size={14} className="inline -mt-0.5 mx-0.5" aria-hidden="true" /> <strong>Share</strong> icon in your browser's toolbar.
              </p>
            </li>
            <li className="flex gap-3 items-start">
              <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-graphite dark:bg-stone text-stone dark:text-ink text-sm font-semibold">2</span>
              <p className="text-sm text-graphite dark:text-stone pt-0.5">
                Scroll down and tap <SquarePlus size={14} className="inline -mt-0.5 mx-0.5" aria-hidden="true" /> <strong>Add to Home Screen</strong>.
              </p>
            </li>
            <li className="flex gap-3 items-start">
              <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-graphite dark:bg-stone text-stone dark:text-ink text-sm font-semibold">3</span>
              <p className="text-sm text-graphite dark:text-stone pt-0.5">
                Tap <strong>Add</strong> in the top-right corner.
              </p>
            </li>
          </ol>

          <p className="text-xs text-gray-500 dark:text-gray-500">
            On an iPhone or iPad, this option is in the Share sheet — it looks different from browser to browser (Safari, Chrome, etc.) but the "Add to Home Screen" action is the one you want.
          </p>
        </div>
      </div>
    </Modal>
  );
};
