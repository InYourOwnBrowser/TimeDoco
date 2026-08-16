import React, { useState, useRef } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { X, Upload, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Papa from 'papaparse';
import { Modal } from './ui/Modal';
import { parseISO } from 'date-fns';
import { HelpTooltip } from './ui/HelpTooltip';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { exportData, importData, settings, updateSettings, bulkAddManualEntries, addTimecode, timecodes, deletedEntries, restoreEntry, hardDeleteEntry, deletedTimecodes, restoreTimecode, hardDeleteTimecode, deletedGroups, restoreGroup, hardDeleteGroup, emptyTrash } = useTimeTracker();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [replaceConfirmText, setReplaceConfirmText] = useState('');
  const [activeTab, setActiveTab] = useState<'general' | 'data' | 'trash'>('general');

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

  const [importPreview, setImportPreview] = useState<{ groups: number, timecodes: number, entries: number } | null>(null);

  const handleImport = async () => {
    if (!fileInputRef.current?.files?.length) {
      setStatusMsg({ type: 'error', text: 'Please select a backup file first.' });
      return;
    }

    const file = fileInputRef.current.files[0];

    if (!importPreview) {
      // First click: Validate file and show preview
      try {
        setIsProcessing(true);
        setStatusMsg(null);

        const content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsText(file);
        });

        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries) || !Array.isArray(parsed.timecodes) || !Array.isArray(parsed.groups)) {
          throw new Error('Invalid TimeTag backup file structure.');
        }

        setImportPreview({
          groups: parsed.groups.length,
          timecodes: parsed.timecodes.length,
          entries: parsed.entries.length,
        });

      } catch (error: any) {
        setStatusMsg({ type: 'error', text: error.message || 'Failed to parse backup file. Is it a valid TimeTag JSON?' });
        if (fileInputRef.current) fileInputRef.current.value = '';
      } finally {
        setIsProcessing(false);
      }
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

    try {
      setIsProcessing(true);
      setStatusMsg(null);
      await importData(file, importMode);
      setStatusMsg({ type: 'success', text: 'Data imported successfully!' });

      // Reset file input and state
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setImportPreview(null);
      setShowReplaceConfirm(false);
      setReplaceConfirmText('');
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
        const entriesToBulkAdd: { startTime: string, endTime: string, timecodeId: string, note: string }[] = [];

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
            let startObj = new Date(startTime);
            let endObj = new Date(endTime);

            if (isNaN(startObj.getTime())) {
              startObj = parseISO(startTime);
            }
            if (isNaN(endObj.getTime())) {
              endObj = parseISO(endTime);
            }

            if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
              throw new Error('Invalid date');
            }

            const startISO = startObj.toISOString();
            const endISO = endObj.toISOString();

            entriesToBulkAdd.push({
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

        if (entriesToBulkAdd.length > 0) {
          await bulkAddManualEntries(entriesToBulkAdd);
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
      <div className="bg-stone dark:bg-ink rounded-panel shadow-inner border border-graphite/10 dark:border-white/10 w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-graphite/10 dark:border-white/10 flex justify-between items-center bg-stone dark:bg-ink">
          <h2 className="text-lg font-semibold font-sans text-graphite dark:text-stone">Settings & Data Management</h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-graphite dark:hover:text-stone transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 rounded-full p-1">
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-graphite/10 dark:border-white/10 shrink-0 bg-stone dark:bg-ink">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-2 text-sm font-medium text-center transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${activeTab === 'general' ? 'border-b-2 border-signal text-signal' : 'border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'}`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex-1 py-2 text-sm font-medium text-center transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${activeTab === 'data' ? 'border-b-2 border-signal text-signal' : 'border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'}`}
          >
            Data
          </button>
          <button
            onClick={() => setActiveTab('trash')}
            className={`flex-1 py-2 text-sm font-medium text-center transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ${activeTab === 'trash' ? 'border-b-2 border-signal text-signal' : 'border-b-2 border-transparent text-gray-500 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'}`}
          >
            Trash
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {statusMsg && (
            <div className={`mb-6 p-3 rounded-md flex items-start gap-2 ${
              statusMsg.type === 'error' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-800/50' : 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-100 dark:border-green-800/50'
            }`}>
              {statusMsg.type === 'error' ? <AlertTriangle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
              <span className="text-sm font-medium">{statusMsg.text}</span>
            </div>
          )}

          <div className="space-y-6">
          {activeTab === 'general' && (
            <>
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
                  <HelpTooltip text="Run more than one timer at once, e.g. tracking a call while a background task is still running." />
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
                  onChange={(e) => updateSettings({ weeklyTargetHours: e.target.value ? Math.max(0, Number(e.target.value)) : null })}
                  placeholder="e.g. 40"
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
                  Target Alert (Minutes)
                  <HelpTooltip text="Notifies you this many minutes before you hit your weekly target." />
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.targetAlertMinutes ?? ''}
                  onChange={(e) => updateSettings({ targetAlertMinutes: e.target.value ? Math.max(0, Number(e.target.value)) : null })}
                  placeholder="e.g. 25"
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
                  Idle Threshold (Minutes)
                  <HelpTooltip text="If your mouse/keyboard is inactive longer than this, the app will prompt to discard the idle time from the running timer." />
                </label>
                <input
                  type="number"
                  min="1"
                  value={settings?.idleThresholdMinutes ?? 15}
                  onChange={(e) => updateSettings({ idleThresholdMinutes: Math.max(1, Number(e.target.value)) })}
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Reminder Interval (Days)</label>
                <input
                  type="number"
                  min="1"
                  value={settings?.reminderIntervalDays ?? 7}
                  onChange={(e) => updateSettings({ reminderIntervalDays: Math.max(1, Number(e.target.value)) })}
                  className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
                  Rounding Rule
                  <HelpTooltip text="Rounds displayed/exported durations to the nearest interval. Doesn't change the raw start/end times you recorded." />
                </label>
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
            </>
          )}
          {activeTab === 'data' && (
            <>
            <section>
              <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-md p-3">
                <h4 className="text-sm font-semibold text-yellow-800 dark:text-yellow-400 flex items-center gap-1.5 mb-1">
                  <AlertTriangle size={16} /> Privacy Note
                </h4>
                <p className="text-xs text-yellow-700 dark:text-yellow-500">
                  While this app is local-only, your data is <strong>not encrypted at rest</strong> in your browser's local storage. Anyone with access to your device profile can read it.
                </p>
              </div>

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
                    onChange={() => setImportPreview(null)}
                    className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-700 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50 border border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <label className="flex items-center block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Import Mode
                    <HelpTooltip text="Merge keeps existing data and adds/updates anything newer in the file. Replace wipes current data first." />
                  </label>
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
                  <>
                    {importPreview && (
                      <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md border border-blue-200 dark:border-blue-800/30 mb-4 text-sm text-blue-800 dark:text-blue-200">
                        <p className="font-medium mb-1">Backup valid! Found:</p>
                        <ul className="list-disc pl-5">
                          <li>{importPreview.groups} groups</li>
                          <li>{importPreview.timecodes} timecodes</li>
                          <li>{importPreview.entries} entries</li>
                        </ul>
                      </div>
                    )}
                    <button
                      onClick={handleImport}
                      disabled={isProcessing}
                      className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
                    >
                      <Upload size={18} />
                      {importPreview ? 'Confirm Import Data' : 'Import Data'}
                    </button>
                  </>
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
            </>
          )}
          {activeTab === 'trash' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b dark:border-gray-700 pb-1">
                <h3 className="text-md font-semibold text-gray-800 dark:text-gray-200">Recently Deleted</h3>
                {(deletedEntries.length > 0 || deletedTimecodes.length > 0 || deletedGroups.length > 0) && (
                  <button
                    onClick={async () => {
                      if (window.confirm('Are you sure you want to permanently empty all items in the trash? This action cannot be undone.')) {
                        await emptyTrash();
                        setStatusMsg({ type: 'success', text: 'Trash emptied successfully.' });
                      }
                    }}
                    className="text-xs font-medium text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                  >
                    Empty Trash
                  </button>
                )}
              </div>

              {deletedEntries.length === 0 && deletedTimecodes.length === 0 && deletedGroups.length === 0 ? (
                <p className="text-sm text-gray-500">Trash is empty.</p>
              ) : (
                <div className="space-y-2">
                  {deletedEntries.map(e => (
                    <div key={e.id} className="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-2 rounded text-sm">
                      <span className="truncate flex-1 text-gray-700 dark:text-gray-300">Entry: {e.note || 'No note'}</span>
                      <div className="flex gap-2 shrink-0 ml-2">
                        <button onClick={() => restoreEntry(e.id)} className="text-blue-600 dark:text-blue-400 hover:underline">Restore</button>
                        <button onClick={() => window.confirm('Permanently delete this entry?') && hardDeleteEntry(e.id)} className="text-red-600 dark:text-red-400 hover:underline">Delete</button>
                      </div>
                    </div>
                  ))}
                  {deletedTimecodes.map(tc => (
                    <div key={tc.id} className="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-2 rounded text-sm">
                      <span className="truncate flex-1 text-gray-700 dark:text-gray-300">Timecode: {tc.name}</span>
                      <div className="flex gap-2 shrink-0 ml-2">
                        <button onClick={() => restoreTimecode(tc.id)} className="text-blue-600 dark:text-blue-400 hover:underline">Restore</button>
                        <button onClick={() => window.confirm('Permanently delete this timecode?') && hardDeleteTimecode(tc.id)} className="text-red-600 dark:text-red-400 hover:underline">Delete</button>
                      </div>
                    </div>
                  ))}
                  {deletedGroups.map(g => (
                    <div key={g.id} className="flex justify-between items-center bg-gray-50 dark:bg-gray-700/50 p-2 rounded text-sm">
                      <span className="truncate flex-1 text-gray-700 dark:text-gray-300">Group: {g.name}</span>
                      <div className="flex gap-2 shrink-0 ml-2">
                        <button onClick={() => restoreGroup(g.id)} className="text-blue-600 dark:text-blue-400 hover:underline">Restore</button>
                        <button onClick={() => window.confirm('Permanently delete this group?') && hardDeleteGroup(g.id)} className="text-red-600 dark:text-red-400 hover:underline">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
