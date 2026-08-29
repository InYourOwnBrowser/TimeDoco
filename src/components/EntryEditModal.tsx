import React, { useState, useEffect } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { format, parseISO, differenceInSeconds } from 'date-fns';
import { X, AlertCircle } from 'lucide-react';
import { calculateTotalPausedSeconds, checkOverlap, formatDurationShort } from '../utils/timeUtils';
import type { Entry, PauseSegment } from '../types';
import { Modal } from './ui/Modal';
import { useToast } from '../context/ToastContext';
import { TimecodeSelector } from './TimecodeSelector';

interface EntryEditModalProps {
  entry: Entry;
  onClose: () => void;
}

export const EntryEditModal: React.FC<EntryEditModalProps> = ({ entry, onClose }) => {
  const { updateEntry, entries, settings } = useTimeTracker();
  const { addToast } = useToast();
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timecodeId, setTimecodeId] = useState(entry.timecodeId);
  const [note, setNote] = useState(entry.note);
  const [tagsStr, setTagsStr] = useState((entry.tags || []).join(', '));

  const recordedSegments = entry.pausedSegments || [];

  // The exact recorded break, measured the same way every duration on this
  // entry is: clamped to the entry and with overlapping segments merged, so a
  // pause recorded twice is not subtracted twice.
  const recordedBreakSeconds = calculateTotalPausedSeconds(
    parseISO(entry.startTime),
    entry.endTime ? parseISO(entry.endTime) : new Date(),
    recordedSegments,
  );

  // The field only holds whole minutes, so it cannot round-trip the recorded
  // break exactly. That is why an untouched field is never written back below.
  const initialBreakMinutes = Math.round(recordedBreakSeconds / 60).toString();

  const recordedPeriodsLabel = `${recordedSegments.length} recorded pause ${recordedSegments.length === 1 ? 'period' : 'periods'}`;

  const [breakMinutes, setBreakMinutes] = useState(!entry.isRunning ? initialBreakMinutes : '');
  const [manualAmount, setManualAmount] = useState(entry.manualAmount != null ? entry.manualAmount.toString() : '');
  const [isFixedCost, setIsFixedCost] = useState(entry.manualAmount != null);
  const [fixedCostDate, setFixedCostDate] = useState(
    entry.startTime ? format(parseISO(entry.startTime), 'yyyy-MM-dd') : new Date().toISOString().split('T')[0]
  );
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const initialStartTime = format(parseISO(entry.startTime), "yyyy-MM-dd'T'HH:mm:ss");
  const initialEndTime = entry.endTime ? format(parseISO(entry.endTime), "yyyy-MM-dd'T'HH:mm:ss") : '';
  const initialManualAmount = entry.manualAmount != null ? entry.manualAmount.toString() : '';
  const initialIsFixedCost = entry.manualAmount != null;
  const initialFixedCostDate = entry.startTime ? format(parseISO(entry.startTime), 'yyyy-MM-dd') : '';

  const isDirty = startTime !== initialStartTime ||
    endTime !== initialEndTime ||
    timecodeId !== entry.timecodeId ||
    note !== entry.note ||
    tagsStr !== (entry.tags || []).join(', ') ||
    (!entry.isRunning && breakMinutes !== initialBreakMinutes) ||
    manualAmount !== initialManualAmount ||
    isFixedCost !== initialIsFixedCost ||
    (isFixedCost && fixedCostDate !== initialFixedCostDate);

  useEffect(() => {
    // Initialize formats for datetime-local inputs
    setStartTime(initialStartTime);
    if (entry.endTime) {
      setEndTime(initialEndTime);
    }
  }, [entry, initialStartTime, initialEndTime]);

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

    const overlapping = checkOverlap(start, end, entries, entry.id, timecodeId, settings?.allowConcurrentTimers);

    if (overlapping) {
      setWarning('Warning: This entry overlaps with an existing time entry.');
    } else if (differenceInSeconds(end, start) > 12 * 3600) {
      setWarning('Warning: This entry duration exceeds 12 hours.');
    } else {
      setWarning(null);
    }
  }, [startTime, endTime, entries, entry.id, timecodeId, settings?.allowConcurrentTimers]);

  const handleSave = async () => {
    setError(null);

    if (!timecodeId) {
      setError('Please select a timecode.');
      return;
    }

    if (isFixedCost) {
      if (!fixedCostDate) {
        setError('Please select a date.');
        return;
      }
      if (!manualAmount || parseFloat(manualAmount) <= 0) {
        setError('Please enter a fixed amount.');
        return;
      }

      const instant = new Date(`${fixedCostDate}T12:00:00`);

      await updateEntry(entry.id, {
        timecodeId,
        note,
        tags: tagsStr.split(',').map(t => t.trim()).filter(t => t !== '').slice(0, 20),
        startTime: instant.toISOString(),
        endTime: instant.toISOString(),
        pausedSegments: [],
        manualAmount: parseFloat(manualAmount),
      });

      addToast('Changes saved', 'success');
      onClose();
      return;
    }

    if (!startTime) {
      setError('Start time is required.');
      return;
    }

    const start = new Date(startTime);
    let end: Date | undefined;

    if (endTime) {
      end = new Date(endTime);
      if (end <= start) {
        setError('End time must be after start time.');
        return;
      }
    } else if (!entry.isRunning) {
        setError('End time is required for completed entries.');
        return;
    }

    if (warning) {
      if (!window.confirm(`${warning}\n\nSave anyway?`)) {
        return;
      }
    }

    const updates: Partial<Entry> = {
      timecodeId,
      note,
      tags: tagsStr.split(',').map(t => t.trim()).filter(t => t !== '').slice(0, 20),
      startTime: start.toISOString(),
      manualAmount: isFixedCost ? (manualAmount ? parseFloat(manualAmount) : null) : null,
    };

    if (end) {
      updates.endTime = end.toISOString();
    }

    if (!entry.isRunning && end) {
      // Only rewrite the pause history when the break field was actually
      // edited. Writing it on every save collapsed a real pause timeline into
      // one block, and rounded the break to whole minutes while doing it — so
      // correcting a note could move the entry's duration by up to 30 seconds.
      const breakEdited = breakMinutes !== initialBreakMinutes;
      const replacementSegments: PauseSegment[] | null = breakEdited
        ? (() => {
            const breakMins = Math.max(0, parseInt(breakMinutes, 10) || 0);
            return breakMins > 0
              ? [{ pauseStart: start.toISOString(), pauseEnd: new Date(start.getTime() + breakMins * 60000).toISOString() }]
              : [];
          })()
        : null;

      const effectiveSegments = replacementSegments ?? recordedSegments;
      // Validate against the segments that will actually apply, clamped to the
      // new window: shrinking an entry can push a preserved pause past its end.
      if (calculateTotalPausedSeconds(start, end, effectiveSegments) >= differenceInSeconds(end, start)) {
        setError('Break time cannot exceed the entry duration.');
        return;
      }

      if (replacementSegments && recordedSegments.length > 1) {
        const confirmed = window.confirm(
          `This entry has ${recordedSegments.length} recorded pause periods. ` +
          'Saving a break time replaces them with a single block.\n\nContinue?'
        );
        if (!confirmed) return;
      }

      if (replacementSegments) {
        updates.pausedSegments = replacementSegments;
      }
    }

    await updateEntry(entry.id, updates);
    addToast('Changes saved', 'success');
    onClose();
  };

  return (
    <Modal onClose={onClose} isDirty={isDirty}>
      <div className="bg-white dark:bg-graphite rounded-panel shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col border border-graphite/20 dark:border-white/20">
        <div className="flex justify-between items-center p-4 border-b border-graphite/20 dark:border-white/20">
          <h2 className="text-lg font-semibold text-graphite dark:text-stone">Edit Time Entry</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">
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

          {timecodeId && (
            <div className="flex rounded-md border border-graphite/20 dark:border-white/20 overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => { setIsFixedCost(false); setError(null); }}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${!isFixedCost ? 'bg-signal text-ink font-semibold' : 'bg-white dark:bg-graphite text-graphite dark:text-stone hover:bg-gray-100 dark:hover:bg-gray-800'}`}
              >
                Time Entry
              </button>
              <button
                type="button"
                onClick={() => { setIsFixedCost(true); setError(null); }}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${isFixedCost ? 'bg-signal text-ink font-semibold' : 'bg-white dark:bg-graphite text-graphite dark:text-stone hover:bg-gray-100 dark:hover:bg-gray-800'}`}
              >
                Flat Fee
              </button>
            </div>
          )}

          {isFixedCost ? (
            <div>
              <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Date</label>
              <input
                type="date"
                value={fixedCostDate}
                onChange={(e) => { setFixedCostDate(e.target.value); setError(null); }}
                className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Start Time</label>
                <input
                  type="datetime-local"
                  step="1"
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); setError(null); }}
                  className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">End Time {entry.isRunning && '(Optional)'}</label>
                <input
                  type="datetime-local"
                  step="1"
                  value={endTime}
                  onChange={(e) => { setEndTime(e.target.value); setError(null); }}
                  className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                />
              </div>
            </div>
          )}

          {!isFixedCost && !entry.isRunning && (
            <div>
              <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Break (minutes)</label>
              <input
                type="number"
                min="0"
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
              />
              {recordedSegments.length > 0 && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {breakMinutes !== initialBreakMinutes
                    ? `Replaces the ${recordedPeriodsLabel} below with a single break.`
                    : `From ${recordedPeriodsLabel}${recordedBreakSeconds > 0 ? ` totalling ${formatDurationShort(recordedBreakSeconds)}` : ''}. Left alone, they are kept exactly as recorded.`}
                </p>
              )}
            </div>
          )}

          {timecodeId && (
            <div>
              <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">
                Fixed Amount ({settings?.currencySymbol || '$'}){isFixedCost ? ' *' : ' — optional'}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                placeholder="e.g. 150.00"
                required={isFixedCost}
                className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
              />
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                For non-time costs (e.g. materials, a flat fee). Overrides hourly-rate calculation on reports.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Note</label>
            <textarea
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Tags (comma separated)</label>
            <input
              type="text"
              value={tagsStr}
              maxLength={500}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="e.g. design, meeting, high-priority"
              className="w-full px-3 py-2 border border-graphite/20 dark:border-white/20 rounded-md shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-signal sm:text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
            />
          </div>

          {error && (
            <div className="flex items-center text-rust dark:text-orange-300 text-sm mt-2">
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

        {entry.pausedSegments && entry.pausedSegments.length > 0 && (
          <div className="p-4 border-t border-graphite/20 dark:border-white/20">
            <h4 className="text-sm font-medium text-graphite dark:text-stone mb-2">Pause History</h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {entry.pausedSegments.map((segment, idx) => (
                <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 bg-stone dark:bg-gray-800/50 p-2 rounded flex justify-between border border-graphite/10 dark:border-white/10">
                  <span>
                    <span className="font-semibold text-graphite dark:text-stone">Paused:</span> {format(parseISO(segment.pauseStart), 'MMM d, h:mm:ss a')}
                  </span>
                  <span>
                    {segment.pauseEnd ? (
                      <><span className="font-semibold text-graphite dark:text-stone">Resumed:</span> {format(parseISO(segment.pauseEnd), 'MMM d, h:mm:ss a')}</>
                    ) : (
                      <span className="font-semibold text-signal-dim dark:text-signal">Ongoing</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {entry.editHistory && entry.editHistory.length > 0 && (
          <div className="p-4 border-t border-graphite/20 dark:border-white/20">
            <h4 className="text-sm font-medium text-graphite dark:text-stone mb-2">Edit History</h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {entry.editHistory.map((change, idx) => (
                <div key={idx} className="text-xs text-gray-600 dark:text-gray-400 bg-stone dark:bg-gray-800/50 p-2 rounded border border-graphite/10 dark:border-white/10">
                  <span className="font-semibold text-graphite dark:text-stone">{change.field}</span> changed at {format(new Date(change.editedAt), 'MMM d, h:mm a')}:
                  <div className="mt-1 flex flex-col gap-1">
                    <div className="text-rust dark:text-orange-300 line-through truncate" title={String(change.oldValue)}>{String(change.oldValue) || '(empty)'}</div>
                    <div className="text-verdigris dark:text-emerald-400 truncate" title={String(change.newValue)}>{String(change.newValue) || '(empty)'}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-stone dark:bg-gray-800/30 px-4 py-3 sm:px-6 flex flex-wrap flex-row-reverse gap-2 border-t border-graphite/20 dark:border-white/20">
          <button
            onClick={handleSave}
            className="w-full inline-flex justify-center rounded-panel border border-transparent px-4 py-2 bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink text-base font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal sm:w-auto sm:text-sm transition-colors"
          >
            Save Changes
          </button>
          <button
            onClick={onClose}
            className="mt-3 sm:mt-0 w-full inline-flex justify-center rounded-panel border border-graphite/20 dark:border-white/20 px-4 py-2 bg-white dark:bg-graphite text-graphite dark:text-stone text-base font-medium hover:bg-gray-100 dark:hover:bg-gray-800/50 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-signal sm:w-auto sm:text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
