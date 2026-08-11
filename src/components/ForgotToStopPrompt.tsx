import React, { useState } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { differenceInSeconds } from 'date-fns';
import { AlertCircle, X } from 'lucide-react';
import { EntryEditModal } from './EntryEditModal';

export const ForgotToStopPrompt: React.FC = () => {
  const { forgotToStopEntry, dismissForgotToStop } = useTimeTracker();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  if (!forgotToStopEntry) return null;

  const start = new Date(forgotToStopEntry.startTime);
  const now = new Date();
  const hoursElapsed = Math.floor(differenceInSeconds(now, start) / 3600);

  return (
    <>
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 w-full max-w-3xl mx-auto mt-4 rounded shadow-sm flex items-start justify-between">
        <div className="flex">
          <div className="flex-shrink-0">
            <AlertCircle className="h-5 w-5 text-yellow-400" aria-hidden="true" />
          </div>
          <div className="ml-3">
            <p className="text-sm text-yellow-700">
              This timer has been running for {hoursElapsed} hours — did you forget to stop it?
              {' '}
              <button
                onClick={() => setIsEditModalOpen(true)}
                className="font-medium underline text-yellow-700 hover:text-yellow-600 focus:outline-none"
              >
                Click here to edit
              </button>
            </p>
          </div>
        </div>
        <div className="ml-auto pl-3">
          <div className="-mx-1.5 -my-1.5">
            <button
              type="button"
              onClick={dismissForgotToStop}
              className="inline-flex bg-yellow-50 rounded-md p-1.5 text-yellow-500 hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-yellow-50 focus:ring-yellow-600"
            >
              <span className="sr-only">Dismiss</span>
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {isEditModalOpen && (
        <EntryEditModal
          entry={forgotToStopEntry}
          onClose={() => setIsEditModalOpen(false)}
        />
      )}
    </>
  );
};
