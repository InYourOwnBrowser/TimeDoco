import React, { useState, useRef } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { X, Upload, Download, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import Papa from 'papaparse';
import { Modal } from './ui/Modal';
import { Panel } from './ui/Panel';
import { parseISO } from 'date-fns';
import { HelpTooltip } from './ui/HelpTooltip';
import { useToast } from '../context/ToastContext';
import { validateBackupPayload, MAX_IMPORT_FILE_BYTES } from '../utils/importValidation';
import { formatErrorLogForClipboard } from '../utils/errorLog';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { exportData, importData, wipeAllData, settings, updateSettings, bulkAddManualEntries, addTimecode, timecodes, deletedEntries, restoreEntry, hardDeleteEntry, deletedTimecodes, restoreTimecode, hardDeleteTimecode, deletedGroups, restoreGroup, hardDeleteGroup, emptyTrash } = useTimeTracker();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [replaceConfirmText, setReplaceConfirmText] = useState('');
  const [activeTab, setActiveTab] = useState<'general' | 'data' | 'trash'>('general');
  const [justSaved, setJustSaved] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);

  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [wipeAcknowledged, setWipeAcknowledged] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const WIPE_CONFIRM_PHRASE = 'DELETE ALL DATA';

  const handleWipeAllData = async () => {
    if (!wipeAcknowledged || wipeConfirmText !== WIPE_CONFIRM_PHRASE) return;
    setIsWiping(true);
    try {
      await wipeAllData();
      addToast('All data has been permanently deleted.', 'success');
      setShowWipeConfirm(false);
      setWipeConfirmText('');
      setWipeAcknowledged(false);
      onClose();
    } catch {
      addToast('Failed to delete data. Please try again.', 'error');
    } finally {
      setIsWiping(false);
    }
  };

  const MAX_LOGO_BYTES = 1024 * 1024; // 1MB — keeps backups/exports lean, since this gets embedded in every export
  const ALLOWED_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type)) {
      addToast('Invalid file type — please upload a PNG, JPEG, or WEBP image.', 'error');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      addToast('Logo image is too large — please use a file under 1MB.', 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 300;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          handleUpdateSettings({ userLogoBase64: dataUrl });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        const isJpeg = file.type === 'image/jpeg';
        const resizedDataUrl = isJpeg
          ? canvas.toDataURL('image/jpeg', 0.85)
          : canvas.toDataURL('image/png');

        handleUpdateSettings({ userLogoBase64: resizedDataUrl });
      };
      img.onerror = () => {
        handleUpdateSettings({ userLogoBase64: dataUrl });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUpdateSettings = async (updates: any) => {
    await updateSettings(updates);
    setJustSaved(true);
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => setJustSaved(false), 1500);
  };

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

    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setStatusMsg({ type: 'error', text: 'Backup file size exceeds the 20MB limit.' });
      return;
    }

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
        validateBackupPayload(parsed);

        setImportPreview({
          groups: parsed.groups.length,
          timecodes: parsed.timecodes.length,
          entries: parsed.entries.length,
        });

      } catch (error: any) {
        setStatusMsg({ type: 'error', text: error.message || 'Failed to parse backup file. Is it a valid TimeDoco JSON?' });
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
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setStatusMsg({ type: 'error', text: 'CSV file size exceeds the 20MB limit.' });
      return;
    }
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
      <div className="bg-white dark:bg-graphite rounded-panel shadow-xl border border-graphite/20 dark:border-white/20 w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-graphite/20 dark:border-white/20 flex justify-between items-center bg-white dark:bg-graphite">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold font-sans text-graphite dark:text-stone">Settings & Data Management</h2>
            {justSaved && <span className="text-xs font-medium text-verdigris dark:text-emerald-400 transition-opacity duration-300">Saved</span>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 dark:text-gray-400 hover:text-graphite dark:hover:text-stone transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite rounded-full p-1">
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-graphite/20 dark:border-white/20 shrink-0 bg-white dark:bg-graphite">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-2 text-sm font-medium text-center transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite ${activeTab === 'general' ? 'border-b-2 border-signal text-signal-dim dark:text-signal font-semibold' : 'border-b-2 border-transparent text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'}`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex-1 py-2 text-sm font-medium text-center transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite ${activeTab === 'data' ? 'border-b-2 border-signal text-signal-dim dark:text-signal font-semibold' : 'border-b-2 border-transparent text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'}`}
          >
            Data
          </button>
          <button
            onClick={() => setActiveTab('trash')}
            className={`flex-1 py-2 text-sm font-medium text-center transition-colors focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 ring-offset-stone dark:ring-offset-graphite ${activeTab === 'trash' ? 'border-b-2 border-signal text-signal-dim dark:text-signal font-semibold' : 'border-b-2 border-transparent text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone'}`}
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

          <div className="space-y-4">
          {activeTab === 'general' && (
            <>
            <Panel className="p-5">
              <h3 className="text-md font-semibold text-graphite dark:text-stone mb-3">Appearance</h3>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-graphite dark:text-stone">Theme</label>
                <select
                  value={settings?.theme || 'system'}
                  onChange={(e) => handleUpdateSettings({ theme: e.target.value as 'light' | 'dark' | 'system' })}
                  className="px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System</option>
                </select>
              </div>
            </Panel>

            <Panel className="p-5">
              <h3 className="text-md font-semibold text-graphite dark:text-stone mb-3">Behavior</h3>
              <div className="flex flex-col mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings?.allowConcurrentTimers || false}
                    onChange={(e) => handleUpdateSettings({ allowConcurrentTimers: e.target.checked })}
                    className="w-4 h-4 text-signal rounded border-graphite/20 dark:border-white/20 focus:ring-signal"
                  />
                  <span className="text-sm font-medium text-graphite dark:text-stone">Allow Multiple Concurrent Timers</span>
                  <HelpTooltip text="Run more than one timer at once, e.g. tracking a call while a background task is still running." />
                </label>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 pl-6">
                  When disabled, starting a new timer automatically stops any existing active timer.
                </p>
              </div>
            </Panel>

            <Panel className="p-5">
              <h3 className="text-md font-semibold text-graphite dark:text-stone mb-3">Report Details</h3>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-graphite dark:text-stone flex items-center">
                  Your Name
                  <HelpTooltip text="Shown as 'Prepared By' on PDF reports." />
                </label>
                <input
                  type="text"
                  value={settings?.preparerName ?? ''}
                  onChange={(e) => handleUpdateSettings({ preparerName: e.target.value })}
                  placeholder="Jane Smith"
                  className="w-48 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-graphite dark:text-stone">Your Company</label>
                <input
                  type="text"
                  value={settings?.preparerCompany ?? ''}
                  onChange={(e) => handleUpdateSettings({ preparerCompany: e.target.value })}
                  placeholder="Acme Freelancing LLC"
                  className="w-48 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-graphite dark:text-stone flex items-center">
                  Currency Symbol
                  <HelpTooltip text="Used wherever earnings/rates are shown, including PDF reports." />
                </label>
                <input
                  type="text"
                  maxLength={5}
                  value={settings?.currencySymbol ?? ''}
                  onChange={(e) => handleUpdateSettings({ currencySymbol: e.target.value })}
                  placeholder="$"
                  className="w-16 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone text-center"
                />
              </div>
                <div className="mb-4">
                  <label className="text-sm font-medium text-graphite dark:text-stone flex items-center mb-2">
                    Your Logo
                    <HelpTooltip text="Shown alongside the TimeDoco logo at the top of PDF reports. PNG, JPEG, or WEBP, under 1MB." />
                  </label>
                  {settings?.userLogoBase64 ? (
                    <div className="flex items-center gap-3">
                      <img src={settings.userLogoBase64} alt="Your logo" className="h-12 max-w-[160px] object-contain bg-white rounded border border-graphite/20 p-1" />
                      <button onClick={() => handleUpdateSettings({ userLogoBase64: null })} className="text-sm text-rust hover:underline">Remove</button>
                    </div>
                  ) : (
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleLogoUpload}
                      className="text-sm text-gray-600 dark:text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-graphite file:text-stone dark:file:bg-stone dark:file:text-ink hover:file:opacity-90 file:cursor-pointer cursor-pointer"
                    />
                  )}
                </div>
              <div className="mb-2">
                <label className="text-sm font-medium text-graphite dark:text-stone flex items-center mb-2">
                  Custom Report Fields
                  <HelpTooltip text="Extra label/value pairs shown at the top of every PDF report — e.g. Tax Registration Number, Business Number." />
                </label>
                {(settings?.customFields || []).map((field, i) => (
                  <div key={field.id} className="flex gap-2 mb-2">
                    <input
                      type="text" value={field.label} placeholder="Label"
                      onChange={(e) => {
                        const updated = [...(settings?.customFields || [])];
                        updated[i] = { ...updated[i], label: e.target.value };
                        handleUpdateSettings({ customFields: updated });
                      }}
                      className="w-32 px-2 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone"
                    />
                    <input
                      type="text" value={field.value} placeholder="Value"
                      onChange={(e) => {
                        const updated = [...(settings?.customFields || [])];
                        updated[i] = { ...updated[i], value: e.target.value };
                        handleUpdateSettings({ customFields: updated });
                      }}
                      className="flex-1 px-2 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone"
                    />
                    <button onClick={() => handleUpdateSettings({ customFields: (settings?.customFields || []).filter((_, j) => j !== i) })} className="text-gray-500 hover:text-rust" aria-label="Remove field">
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => handleUpdateSettings({ customFields: [...(settings?.customFields || []), { id: crypto.randomUUID(), label: '', value: '' }] })}
                  className="text-sm text-signal-dim dark:text-signal hover:underline"
                >
                  + Add Field
                </button>
              </div>
            </Panel>

            <Panel className="p-5">
              <h3 className="text-md font-semibold text-graphite dark:text-stone mb-3">Tax</h3>
              <div className="mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings?.taxEnabled || false}
                    onChange={(e) => handleUpdateSettings({ taxEnabled: e.target.checked })}
                    className="w-4 h-4 text-signal rounded border-graphite/20 dark:border-white/20 focus:ring-signal"
                  />
                  <span className="text-sm font-medium text-graphite dark:text-stone">Enable Tax</span>
                  <HelpTooltip text="Adds before/after-tax totals to earnings and PDF reports." />
                </label>
              </div>
              {settings?.taxEnabled && (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-medium text-graphite dark:text-stone">Tax Label</label>
                    <input
                      type="text"
                      value={settings?.taxLabel ?? ''}
                      onChange={(e) => handleUpdateSettings({ taxLabel: e.target.value })}
                      placeholder="Tax"
                      className="w-32 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                    />
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-medium text-graphite dark:text-stone">Tax Rate (%)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={settings?.taxRate ?? ''}
                      onChange={(e) => handleUpdateSettings({ taxRate: e.target.value === '' ? null : parseFloat(e.target.value) })}
                      placeholder="15"
                      className="w-24 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone text-right"
                    />
                  </div>
                  <div className="mb-4">
                    <label className="text-sm font-medium text-graphite dark:text-stone flex items-center mb-2">
                      Your hourly rates are
                      <HelpTooltip text="Exclusive: tax is added on top of your rate. Inclusive: your rate already includes tax." />
                    </label>
                    <div className="flex gap-4 text-sm text-graphite dark:text-stone">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" checked={!settings?.taxInclusive} onChange={() => handleUpdateSettings({ taxInclusive: false })} className="text-signal focus:ring-signal" />
                        Exclusive of tax
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" checked={!!settings?.taxInclusive} onChange={() => handleUpdateSettings({ taxInclusive: true })} className="text-signal focus:ring-signal" />
                        Inclusive of tax
                      </label>
                    </div>
                  </div>
                </>
              )}
            </Panel>

            <Panel className="p-5">
              <h3 className="text-md font-semibold text-graphite dark:text-stone mb-3">Weekly Target Hours</h3>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-graphite dark:text-stone">Weekly Target Hours</label>
                <input
                  type="number"
                  min="0"
                  value={settings?.weeklyTargetHours ?? ''}
                  onChange={(e) => handleUpdateSettings({ weeklyTargetHours: e.target.value ? Math.max(0, Number(e.target.value)) : null })}
                  placeholder="e.g. 40"
                  className="w-24 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-graphite dark:text-stone flex items-center">
                  Target Alert (Minutes)
                  <HelpTooltip text="Notifies you this many minutes before you hit your weekly target." />
                </label>
                <input
                  type="number"
                  min="0"
                  value={settings?.targetAlertMinutes ?? ''}
                  onChange={(e) => handleUpdateSettings({ targetAlertMinutes: e.target.value ? Math.max(0, Number(e.target.value)) : null })}
                  placeholder="e.g. 25"
                  className="w-24 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-graphite dark:text-stone flex items-center">
                  Idle Threshold (Minutes)
                  <HelpTooltip text="If your mouse/keyboard is inactive longer than this, the app will prompt to discard the idle time from the running timer. Leave blank to disable." />
                </label>
                <input
                  type="number"
                  min="1"
                  value={settings?.idleThresholdMinutes ?? ''}
                  onChange={(e) => handleUpdateSettings({ idleThresholdMinutes: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
                  placeholder="Off"
                  className="w-24 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                />
              </div>
              <div className="flex items-center justify-between mb-4">
                <label className="text-sm font-medium text-graphite dark:text-stone">Reminder Interval (Days)</label>
                <input
                  type="number"
                  min="1"
                  value={settings?.reminderIntervalDays ?? 7}
                  onChange={(e) => handleUpdateSettings({ reminderIntervalDays: Math.max(1, Number(e.target.value)) })}
                  className="w-24 px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                />
              </div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-graphite dark:text-stone flex items-center">
                  Rounding Rule
                  <HelpTooltip text="Rounds displayed/exported durations to the nearest interval. Doesn't change the raw start/end times you recorded." />
                </label>
                <select
                  value={settings?.roundingRule ?? 'none'}
                  onChange={(e) => handleUpdateSettings({ roundingRule: e.target.value as 'none' | '5min' | '10min' | '15min' })}
                  className="px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                >
                  <option value="none">None</option>
                  <option value="5min">Nearest 5 Minutes</option>
                  <option value="10min">Nearest 10 Minutes</option>
                  <option value="15min">Nearest 15 Minutes</option>
                </select>
              </div>
            </Panel>
            </>
          )}
          {activeTab === 'data' && (
            <div className="space-y-4">
            <Panel className="p-5">
              <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-md p-3">
                <h4 className="text-sm font-semibold text-yellow-800 dark:text-yellow-400 flex items-center gap-1.5 mb-1">
                  <AlertTriangle size={16} /> Privacy Note
                </h4>
                <p className="text-xs text-yellow-700 dark:text-yellow-500">
                  While this app is local-only, your data is <strong>not encrypted at rest</strong> in your browser's local storage. Anyone with access to your device profile can read it.
                </p>
              </div>

              <h3 className="text-md font-semibold text-graphite dark:text-stone mb-3">Export Data</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Download all your tracked time, groups, and settings as a secure local JSON file.
              </p>

              {settings?.lastBackupDate && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                  Last backup: {new Date(settings.lastBackupDate).toLocaleDateString()}
                </p>
              )}

              <button
                onClick={handleExport}
                disabled={isProcessing}
                className="w-full flex items-center justify-center gap-2 bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 text-graphite dark:text-stone px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50 transition-colors"
              >
                <Download size={18} />
                Export Backup File
              </button>
            </Panel>

            <Panel className="p-5">
              <h3 className="text-md font-semibold text-graphite dark:text-stone mb-3">Import / Restore Data</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Restore your data from a previously exported backup file.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Select Backup File</label>
                  <input
                    type="file"
                    accept=".json"
                    ref={fileInputRef}
                    onChange={() => setImportPreview(null)}
                    className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-stone dark:file:bg-gray-800/30 file:text-graphite dark:file:text-stone hover:file:bg-gray-200 dark:hover:file:bg-gray-800/50 border border-graphite/20 dark:border-white/20 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <label className="flex items-center block text-sm font-medium text-graphite dark:text-stone mb-2">
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
                        className="text-signal focus:ring-signal border-graphite/20 dark:border-white/20 bg-white dark:bg-graphite"
                      />
                      <span className="text-sm text-graphite dark:text-stone">Merge (Safer)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="replace"
                        checked={importMode === 'replace'}
                        onChange={() => setImportMode('replace')}
                        className="text-signal focus:ring-signal border-graphite/20 dark:border-white/20 bg-white dark:bg-graphite"
                      />
                      <span className="text-sm text-rust dark:text-orange-300 font-medium">Replace All</span>
                    </label>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
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
                      className="w-full text-sm p-2 border border-red-300 dark:border-red-700 rounded bg-white dark:bg-graphite text-graphite dark:text-stone mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rust"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowReplaceConfirm(false);
                          setReplaceConfirmText('');
                          setStatusMsg(null);
                        }}
                        className="flex-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors border border-graphite/20 dark:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleImport}
                        disabled={isProcessing || replaceConfirmText !== 'REPLACE'}
                        className="flex-1 flex items-center justify-center gap-2 bg-rust text-white px-3 py-2 rounded hover:bg-rust/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rust disabled:opacity-50 transition-colors"
                      >
                        <Upload size={16} />
                        Confirm Replace
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {importPreview && (
                      <div className="bg-stone dark:bg-gray-800/30 p-3 rounded-md border border-graphite/20 dark:border-white/20 mb-4 text-sm text-graphite dark:text-stone">
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
                      className="w-full flex items-center justify-center gap-2 bg-graphite hover:bg-ink dark:bg-stone dark:hover:bg-gray-300 text-stone dark:text-ink px-4 py-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50 transition-colors"
                    >
                      <Upload size={18} />
                      {importPreview ? 'Confirm Import Data' : 'Import Data'}
                    </button>
                  </>
                )}
              </div>
            </Panel>

            <Panel className="p-5">
              <h3 className="text-md font-semibold text-graphite dark:text-stone mb-3">Import CSV Data</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Import time entries from a generic CSV file. Ensure it has "Start Time", "End Time", and "Timecode" columns.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-graphite dark:text-stone mb-1">Select CSV File</label>
                  <input
                    type="file"
                    accept=".csv"
                    ref={csvInputRef}
                    className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-stone dark:file:bg-gray-800/30 file:text-graphite dark:file:text-stone hover:file:bg-gray-200 dark:hover:file:bg-gray-800/50 border border-graphite/20 dark:border-white/20 rounded cursor-pointer"
                  />
                </div>

                <button
                  onClick={handleImportCSV}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-center gap-2 bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 text-graphite dark:text-stone px-4 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:opacity-50 transition-colors"
                >
                  <Upload size={18} />
                  Import CSV
                </button>
              </div>
            </Panel>

            <Panel className="p-5 border-2 border-rust/40">
              <h3 className="text-md font-semibold text-rust dark:text-orange-300 flex items-center gap-1.5 mb-3">
                <AlertTriangle size={18} /> Danger Zone
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Permanently delete every group, timecode, entry, and setting stored in this browser.
                This cannot be undone — export a backup first if you might need this data again.
              </p>

              {!showWipeConfirm ? (
                <button
                  onClick={() => setShowWipeConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 bg-white dark:bg-graphite border border-rust text-rust dark:text-orange-300 px-4 py-2 rounded hover:bg-rust/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rust transition-colors"
                >
                  <Trash2 size={18} /> Delete All Data Permanently
                </button>
              ) : (
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-md border border-red-200 dark:border-red-800/30 space-y-3">
                  <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                    This will permanently erase all app data from this device. There is no undo.
                  </p>
                  <button
                    onClick={handleExport}
                    className="w-full flex items-center justify-center gap-2 text-sm bg-white dark:bg-graphite border border-graphite/20 dark:border-white/20 text-graphite dark:text-stone px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <Download size={14} /> Export a backup first
                  </button>

                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wipeAcknowledged}
                      onChange={(e) => setWipeAcknowledged(e.target.checked)}
                      className="mt-0.5 text-rust focus:ring-rust border-graphite/20 dark:border-white/20 bg-white dark:bg-graphite"
                    />
                    <span className="text-sm text-graphite dark:text-stone">
                      I understand this permanently deletes all data and cannot be undone.
                    </span>
                  </label>

                  <div>
                    <label className="block text-sm text-red-700 dark:text-red-400 font-medium mb-1">
                      Type <strong>{WIPE_CONFIRM_PHRASE}</strong> to confirm.
                    </label>
                    <input
                      type="text"
                      value={wipeConfirmText}
                      onChange={(e) => setWipeConfirmText(e.target.value)}
                      placeholder={WIPE_CONFIRM_PHRASE}
                      className="w-full text-sm p-2 border border-red-300 dark:border-red-700 rounded bg-white dark:bg-graphite text-graphite dark:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rust"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowWipeConfirm(false); setWipeConfirmText(''); setWipeAcknowledged(false); }}
                      className="flex-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors border border-graphite/20 dark:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleWipeAllData}
                      disabled={isWiping || !wipeAcknowledged || wipeConfirmText !== WIPE_CONFIRM_PHRASE}
                      className="flex-1 flex items-center justify-center gap-2 bg-rust text-white px-3 py-2 rounded hover:bg-rust/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rust disabled:opacity-50 transition-colors"
                    >
                      <Trash2 size={16} /> Permanently Delete Everything
                    </button>
                  </div>
                </div>
              )}
            </Panel>
            </div>
          )}
          {activeTab === 'trash' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b border-graphite/20 dark:border-white/20 pb-1">
                <h3 className="text-md font-semibold text-graphite dark:text-stone">Recently Deleted</h3>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      const logText = formatErrorLogForClipboard();
                      if (!logText.trim()) {
                        addToast('Error log is empty.', 'info');
                        return;
                      }
                      navigator.clipboard.writeText(logText);
                      addToast('Error log copied to clipboard.', 'success');
                    }}
                    className="text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone transition-colors"
                  >
                    Copy Error Log
                  </button>
                  {(deletedEntries.length > 0 || deletedTimecodes.length > 0 || deletedGroups.length > 0) && (
                    <button
                      onClick={async () => {
                        if (window.confirm('Are you sure you want to permanently empty all items in the trash? This action cannot be undone.')) {
                          await emptyTrash();
                          setStatusMsg({ type: 'success', text: 'Trash emptied successfully.' });
                        }
                      }}
                      className="text-xs font-medium text-rust dark:text-orange-300 hover:text-rust/80 transition-colors"
                    >
                      Empty Trash
                    </button>
                  )}
                </div>
              </div>

              {deletedEntries.length === 0 && deletedTimecodes.length === 0 && deletedGroups.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">Trash is empty.</p>
              ) : (
                <div className="space-y-2">
                  {deletedEntries.map(e => (
                    <div key={e.id} className="flex justify-between items-center bg-stone dark:bg-gray-800/30 p-2 rounded text-sm border border-graphite/20 dark:border-white/20">
                      <span className="truncate flex-1 text-graphite dark:text-stone">Entry: {e.note || 'No note'}</span>
                      <div className="flex gap-2 shrink-0 ml-2">
                        <button onClick={() => restoreEntry(e.id)} className="text-signal-dim dark:text-signal hover:underline">Restore</button>
                        <button onClick={() => window.confirm('Permanently delete this entry?') && hardDeleteEntry(e.id)} className="text-rust dark:text-orange-300 hover:underline">Delete</button>
                      </div>
                    </div>
                  ))}
                  {deletedTimecodes.map(tc => (
                    <div key={tc.id} className="flex justify-between items-center bg-stone dark:bg-gray-800/30 p-2 rounded text-sm border border-graphite/20 dark:border-white/20">
                      <span className="truncate flex-1 text-graphite dark:text-stone">Timecode: {tc.name}</span>
                      <div className="flex gap-2 shrink-0 ml-2">
                        <button onClick={() => restoreTimecode(tc.id)} className="text-signal-dim dark:text-signal hover:underline">Restore</button>
                        <button onClick={() => window.confirm('Permanently delete this timecode?') && hardDeleteTimecode(tc.id)} className="text-rust dark:text-orange-300 hover:underline">Delete</button>
                      </div>
                    </div>
                  ))}
                  {deletedGroups.map(g => (
                    <div key={g.id} className="flex justify-between items-center bg-stone dark:bg-gray-800/30 p-2 rounded text-sm border border-graphite/20 dark:border-white/20">
                      <span className="truncate flex-1 text-graphite dark:text-stone">Group: {g.name}</span>
                      <div className="flex gap-2 shrink-0 ml-2">
                        <button onClick={() => restoreGroup(g.id)} className="text-signal-dim dark:text-signal hover:underline">Restore</button>
                        <button onClick={() => window.confirm('Permanently delete this group?') && hardDeleteGroup(g.id)} className="text-rust dark:text-orange-300 hover:underline">Delete</button>
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
