import React, { useState, useRef } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { X, Upload, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Papa from 'papaparse';
import { Modal } from './ui/Modal';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { exportData, importData, settings, updateSettings, addManualEntry, addTimecode, timecodes } = useTimeTracker();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [replaceConfirmText, setReplaceConfirmText] = useState('');

  const handleExport = async () => {
    try {
      setIsProcessing(true);
      await exportData();
      setStatusMsg({ type: 'success', text: 'Data exported successfully!' });
    } catch {
      setStatusMsg({ type: 'error', text: 'Failed to export data.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!fileInputRef.current?.files?.length) {
      setStatusMsg({ type: 'error', text: 'Please select a backup file first.' });
      return;
    }

    if (importMode === 'replace' && !showReplaceConfirm) {
      setShowReplaceConfirm(true);
      return;
    }

    if (importMode === 'replace' && replaceConfirmText !== 'REPLACE') {
      setStatusMsg({ type: 'error', text: 'Please type REPLACE to confirm.' });
      return;
    }

    const file = fileInputRef.current.files[0];

    try {
      setIsProcessing(true);
      setStatusMsg(null);
      await importData(file, importMode);
      setStatusMsg({ type: 'success', text: 'Data imported successfully!' });

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      setStatusMsg({ type: 'error', text: error.message || 'Failed to import data.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImportCSV = async () => {
    if (!csvInputRef.current?.files?.length) {
      setStatusMsg({ type: 'error', text: 'Please select a CSV file first.' });
      return;
    }

    const file = csvInputRef.current.files[0];
    setIsProcessing(true);
    setStatusMsg(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        let importedCount = 0;
        let skippedCount = 0;
        const localTimecodes = [...timecodes];
        for (const row of results.data as any[]) {
          try {
            const startTime = row['Start Time'] || row.startTime || row.start;
            const endTime = row['End Time'] || row.endTime || row.end;
            const timecodeName = row['Timecode'] || row.timecode || row.name;
            const note = row['Note'] || row.note || '';

            if (!startTime || !endTime || !timecodeName) {
              skippedCount++;
              continue;
            }

            let tc = localTimecodes.find(t => t.name.toLowerCase() === timecodeName.toLowerCase());
            if (!tc) {
              tc = await addTimecode(timecodeName);
              localTimecodes.push(tc);
            }

            // Validating the date parsed successfully to prevent RangeError inside addManualEntry
            const startISO = new Date(startTime).toISOString();
            const endISO = new Date(endTime).toISOString();

            await addManualEntry({
              startTime: startISO,
              endTime: endISO,
              timecodeId: tc.id,
              note
            });
            importedCount++;
          } catch (error) {
            console.warn('Skipping malformed CSV row:', row, error);
            skippedCount++;
          }
        }

        if (importedCount > 0 && skippedCount === 0) {
          setStatusMsg({ type: 'success', text: `Successfully imported all ${importedCount} entries from CSV.` });
        } else if (importedCount > 0 && skippedCount > 0) {
          setStatusMsg({ type: 'error', text: `Imported ${importedCount} entries, skipped ${skippedCount} malformed rows.` }); // Note: Using 'error' styled toast to indicate partial failure visually
        } else {
          setStatusMsg({ type: 'error', text: 'Failed to import any entries. Please check the CSV format.' });
        }

        setIsProcessing(false);
        if (csvInputRef.current) csvInputRef.current.value = '';
      },
      error: (error) => {
        setStatusMsg({ type: 'error', text: `CSV Parse Error: ${error.message}` });
        setIsProcessing(false);
      }
    });
  };

  return (
    <Modal onClose={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Settings & Data Management</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {statusMsg && (
            <div className={`mb-6 p-3 rounded-md flex items-start gap-2 ${
              statusMsg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-green-50 text-green-700 border border-green-100'
            }`}>
              {statusMsg.type === 'error' ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
              <span className="text-sm font-medium">{statusMsg.text}</span>
            </div>
          )}

          <div className="space-y-6">
            <section>
              <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3 border-b dark:border-gray-700 pb-1">Appearance</h3>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Theme</label>
                <select
                  value={settings?.theme || 'system'}
                  onChange={(e) => updateSettings({ theme: e.target.value as 'light' | 'dark' | 'system' })}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System</option>
                </select>
              </div>
            </section>

            <section>
              <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3 border-b dark:border-gray-700 pb-1">Behavior</h3>
              <div className="flex flex-col mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings?.allowConcurrentTimers || false}
                    onChange={(e) => updateSettings({ allowConcurrentTimers: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Allow Multiple Concurrent Timers</span>
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 pl-6">
                  When disabled, starting a new timer automatically stops any existing active timer.
                </p>
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Weekly Target Hours</label>
                <input
                  type="number"
                  min="0"
                  value={settings?.weeklyTargetHours ?? ''}
                  onChange={(e) => updateSettings({ weeklyTargetHours: e.target.value ? Number(e.target.value) : null })}
                  placeholder="e.g. 40"
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Idle Threshold (Minutes)</label>
                <input
                  type="number"
                  min="1"
                  value={settings?.idleThresholdMinutes ?? 15}
                  onChange={(e) => updateSettings({ idleThresholdMinutes: Number(e.target.value) })}
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Reminder Interval (Days)</label>
                <input
                  type="number"
                  min="1"
                  value={settings?.reminderIntervalDays ?? 7}
                  onChange={(e) => updateSettings({ reminderIntervalDays: Number(e.target.value) })}
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Rounding Rule</label>
                <select
                  value={settings?.roundingRule ?? 'none'}
                  onChange={(e) => updateSettings({ roundingRule: e.target.value as 'none' | '5min' | '10min' | '15min' })}
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="none">None</option>
                  <option value="5min">Nearest 5 Minutes</option>
                  <option value="10min">Nearest 10 Minutes</option>
                  <option value="15min">Nearest 15 Minutes</option>
                </select>
              </div>
            </section>

            <section>
              <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3 border-b dark:border-gray-700 pb-1">Export Data</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Download all your tracked time, groups, and settings as a secure local JSON file.
              </p>

              {settings?.lastBackupDate && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Last backup: {new Date(settings.lastBackupDate).toLocaleDateString()}
                </p>
              )}

              <button
                onClick={handleExport}
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
              >
                <Download size={18} />
                Export Backup File
              </button>
            </section>

            <section>
              <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3 border-b dark:border-gray-700 pb-1">Import / Restore Data</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Restore your data from a previously exported backup file.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Select Backup File</label>
                  <input
                    type="file"
                    accept=".json"
                    ref={fileInputRef}
                    className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Import Mode</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="merge"
                        checked={importMode === 'merge'}
                        onChange={() => setImportMode('merge')}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Merge (Safer)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="replace"
                        checked={importMode === 'replace'}
                        onChange={() => setImportMode('replace')}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 text-red-600 dark:text-red-400 font-medium">Replace All</span>
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {importMode === 'merge'
                      ? 'Adds missing records and overwrites matching ones. Keeps newer data intact.'
                      : 'WARNING: Completely wipes current data and replaces it with the backup file.'}
                  </p>
                </div>

                {importMode === 'replace' && showReplaceConfirm ? (
                  <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-md border border-red-200 dark:border-red-800/30 mb-4">
                    <p className="text-sm text-red-700 dark:text-red-400 font-medium mb-2">
                      Type <strong>REPLACE</strong> below to confirm wiping all current data.
                    </p>
                    <input
                      type="text"
                      value={replaceConfirmText}
                      onChange={(e) => setReplaceConfirmText(e.target.value)}
                      placeholder="REPLACE"
                      className="w-full text-sm p-2 border border-red-300 dark:border-red-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white mb-3"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowReplaceConfirm(false);
                          setReplaceConfirmText('');
                          setStatusMsg(null);
                        }}
                        className="flex-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors border border-gray-300 dark:border-gray-600"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleImport}
                        disabled={isProcessing || replaceConfirmText !== 'REPLACE'}
                        className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white px-3 py-2 rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 transition-colors"
                      >
                        <Upload size={16} />
                        Confirm Replace
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleImport}
                    disabled={isProcessing}
                    className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                  >
                    <Upload size={18} />
                    Import Data
                  </button>
                )}
              </div>
            </section>

            <section>
              <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200 mb-3 border-b dark:border-gray-700 pb-1">Import CSV Data</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Import time entries from a generic CSV file. Ensure it has "Start Time", "End Time", and "Timecode" columns.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Select CSV File</label>
                  <input
                    type="file"
                    accept=".csv"
                    ref={csvInputRef}
                    className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                  />
                </div>

                <button
                  onClick={handleImportCSV}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                >
                  <Upload size={18} />
                  Import CSV
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </Modal>
  );
};
