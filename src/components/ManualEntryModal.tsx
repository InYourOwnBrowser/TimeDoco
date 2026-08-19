import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { differenceInSeconds } from 'date-fns';
import { X, AlertCircle } from 'lucide-react';
import { checkOverlap } from '../utils/timeUtils';
import { Modal } from './ui/Modal';
import { useToast } from '../context/ToastContext';
import { TimecodeSelector } from './TimecodeSelector';

interface ManualEntryModalProps {
  onClose: () => void;
}

export const ManualEntryModal: React.FC<ManualEntryModalProps> = ({ onClose }) => {
  const { addManualEntry, entries, settings, timecodes } = useTimeTracker();
  const { addToast } = useToast();
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timecodeId, setTimecodeId] = useState('');
  const [note, setNote] = useState('');
  const [tagsStr, setTagsStr] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const isDirty = startTime !== '' || endTime !== '' || timecodeId !== '' || note !== '' || tagsStr !== '' || breakMinutes !== '' || manualAmount !== '';

  useEffect(() => {
    if (!startTime || !endTime) {
      setWarning(null);
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
      setWarning(null);
      return;
    }

    const overlapping = checkOverlap(start, end, entries, undefined, timecodeId, settings?.allowConcurrentTimers);

    if (overlapping) {
      setWarning('Warning: This entry overlaps with an existing time entry.');
    } else if (differenceInSeconds(end, start) > 12 * 3600) {
      setWarning('Warning: This entry duration exceeds 12 hours.');
    } else {
      setWarning(null);
    }
  }, [startTime, endTime, entries, timecodeId, settings?.allowConcurrentTimers]);

  const handleSave = async () => {
    setError(null);

    if (!timecodeId) {
      setError('Please select a timecode.');
      return;
    }

    if (!startTime || !endTime) {
      setError('Start and End times are required.');
      return;
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (end <= start) {
      setError('End time must be after start time.');
      return;
    }

    const breakMins = Math.max(0, parseInt(breakMinutes, 10) || 0);
    if (breakMins * 60 >= differenceInSeconds(end, start)) {
      setError('Break time cannot exceed the entry duration.');
      return;
    }
    const pausedSegments = breakMins > 0
      ? [{ pauseStart: start.toISOString(), pauseEnd: new Date(start.getTime() + breakMins * 60000).toISOString() }]
      : [];

    if (warning) {
      if (!window.confirm(`${warning}\n\nSave anyway?`)) {
        return;
      }
    }

    const tagsArray = tagsStr.split(',').map(t => t.trim()).filter(t => t !== '');

    await addManualEntry({
      timecodeId,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      note,
      tags: tagsArray,
      pausedSegments,
      manualAmount: manualAmount ? parseFloat(manualAmount) : null,
    });

    addToast('Entry added successfully', 'success');
    onClose();
  };

  return (
    <Modal onClose={onClose} isDirty={isDirty}>
      <div className="bg-stone dark:bg-graphite rounded-panel shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col border border-graphite/10 dark:border-white/10">
        <div className="flex justify-between items-center p-4 border-b border-graphite/10 dark:border-white/10">
          <h2 className="text-lg font-semibold text-graphite dark:text-stone">Add Manual Entry</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Timecode</label>
            <div className="w-full z-10 relative">
              <TimecodeSelector selectedId={timecodeId} onSelect={setTimecodeId} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Start Time</label>
              <input
                type="datetime-local"
                step="1"
                value={startTime}
                onChange={(e) => { setStartTime(e.target.value); setError(null); }}
                className="w-full px-3 py-2 border border-graphite/10 dark:border-white/10 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">End Time</label>
              <input
                type="datetime-local"
                step="1"
                value={endTime}
                onChange={(e) => { setEndTime(e.target.value); setError(null); }}
                className="w-full px-3 py-2 border border-graphite/10 dark:border-white/10 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Break (minutes)</label>
            <input
              type="number"
              min="0"
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2 border border-graphite/10 dark:border-white/10 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone"
            />
          </div>

          {timecodeId && !timecodes.find(t => t.id === timecodeId)?.hourlyRate && (
            <div>
              <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">
                Fixed Amount ({settings?.currencySymbol || '$'}) — optional
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                placeholder="e.g. 150.00"
                className="w-full px-3 py-2 border border-graphite/10 dark:border-white/10 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                For non-time costs (e.g. materials, a flat fee). Overrides hourly-rate calculation on reports.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-graphite/10 dark:border-white/10 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Tags (comma separated)</label>
            <input
              type="text"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="e.g. design, meeting, high-priority"
              className="w-full px-3 py-2 border border-graphite/10 dark:border-white/10 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-stone dark:bg-graphite text-graphite dark:text-stone"
            />
          </div>

          {error && (
            <div className="flex items-center text-rust text-sm mt-2">
              <AlertCircle className="w-4 h-4 mr-1" />
              {error}
            </div>
          )}

          {warning && (
            <div className="flex items-center text-signal-dim dark:text-signal text-sm mt-2 bg-signal/10 p-2 rounded">
              <AlertCircle className="w-4 h-4 mr-1 flex-shrink-0" />
              {warning}
            </div>
          )}
        </div>

        <div className="bg-gray-50 dark:bg-gray-800/30 px-4 py-3 sm:px-6 flex flex-wrap flex-row-reverse gap-2">
          <button
            onClick={handleSave}
            className="w-full inline-flex justify-center rounded-panel border border-transparent px-4 py-2 bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink text-base font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal sm:w-auto sm:text-sm transition-colors"
          >
            Add Entry
          </button>
          <button
            onClick={onClose}
            className="mt-3 sm:mt-0 w-full inline-flex justify-center rounded-panel border border-graphite/10 dark:border-white/10 px-4 py-2 bg-stone dark:bg-graphite text-graphite dark:text-stone text-base font-medium hover:bg-gray-50 dark:hover:bg-gray-800/50 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal sm:w-auto sm:text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
