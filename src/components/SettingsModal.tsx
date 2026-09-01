import React, { useState, useRef } from 'react';
import { useTimeTracker } from '../context/TimeTrackerContext';
import { useNamedDownload } from '../hooks/useNamedDownload';
import { checkPersistence, requestPersistence, storageEstimate, type PersistenceState } from '../utils/storagePersistence';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { Shield, ShieldAlert, ShieldOff } from 'lucide-react';
import { X, Upload, Download, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import Papa from 'papaparse';
import { Modal } from './ui/Modal';
import { Panel } from './ui/Panel';
import { HelpTooltip } from './ui/HelpTooltip';
import { useToast } from '../context/ToastContext';
import { validateBackupPayload, verifyBackupFile, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ENTRIES, parseCSVDate } from '../utils/importValidation';
import { findOverlappingCandidates } from '../utils/timeUtils';
import { formatErrorLogForClipboard } from '../utils/errorLog';

// A group the CSV named but the user does not have yet gets the app's default
// group colour; they can recolour it from the grouping panel.
const CSV_IMPORT_GROUP_COLOR = '#3E7368';

interface SettingsModalProps {
  onClose: () => void;
}

/**
 * Skip counts as a sentence, commonest reason first.
 *
 * The point is that a user can act on it: a run of unreadable dates means the
 * format dropdown is wrong, where "malformed" means nothing and leaves them
 * with a file they believe is broken.
 */
const describeSkips = (reasons: Map<string, number>): string => {
  const parts = [...reasons.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${reason}`);
  if (parts.length === 0) return 'no reason recorded';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { getBackupBlob, markBackupSaved, importData, wipeAllData, settings, updateSettings, bulkAddManualEntries, addGroup, addTimecode, entries, timecodes, groups, deletedEntries, restoreEntry, hardDeleteEntry, deletedTimecodes, restoreTimecode, hardDeleteTimecode, deletedGroups, restoreGroup, hardDeleteGroup, emptyTrash } = useTimeTracker();
  const { triggerDownload, SaveAsDialog } = useNamedDownload();
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [csvDateFormat, setCsvDateFormat] = useState<'iso' | 'dmy' | 'mdy'>('iso');
  const [statusMsg, setStatusMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showReplaceConfirm, setShowReplaceConfirm] = useState(false);
  const [replaceConfirmText, setReplaceConfirmText] = useState('');
  const [activeTab, setActiveTab] = useState<'general' | 'data' | 'trash'>('general');
  const [justSaved, setJustSaved] = useState(false);
  const [persistenceState, setPersistenceState] = useState<PersistenceState>('unsupported');
  const [storageUsage, setStorageUsage] = useState<{ usage: number; quota: number } | null>(null);
  const { needsManualInstall } = useInstallPrompt();
  const saveTimeoutRef = useRef<number | null>(null);

  React.useEffect(() => {
    const loadStorageInfo = async () => {
      setPersistenceState(await checkPersistence());
      setStorageUsage(await storageEstimate());
    };
    void loadStorageInfo();
  }, []);

  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);


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
          // No canvas available to resize with. The file already passed the
          // MIME allowlist and decoded successfully, so storing it unresized
          // is safe — it is a real raster image jsPDF can embed.
          void handleUpdateSettings({ userLogoBase64: dataUrl });
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        const isJpeg = file.type === 'image/jpeg';
        const resizedDataUrl = isJpeg
          ? canvas.toDataURL('image/jpeg', 0.85)
          : canvas.toDataURL('image/png');

        void handleUpdateSettings({ userLogoBase64: resizedDataUrl });
      };
      img.onerror = () => {
        // Storing the un-rasterised source here would later make
        // doc.addImage(logo, 'PNG', ...) throw and break PDF export entirely.
        addToast('Could not read this image — please try a different logo file.', 'error');
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      addToast('Could not read that file — please try again.', 'error');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleUpdateSettings = async (updates: any) => {
    // The "Saved" chip is a claim about storage, so it waits on storage. A
    // failed write raises its own error toast; showing "Saved" beside it told
    // the user their preference had been kept when it had not.
    if (!(await updateSettings(updates))) return;
    setJustSaved(true);
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => setJustSaved(false), 1500);
  };

  const handleExport = () => {
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      triggerDownload(
        getBackupBlob,
        `timedoco-backup-${dateStr}`,
        'json',
        () => {
          void markBackupSaved();
          setStatusMsg({ type: 'success', text: 'Data exported successfully!' });
        }
      );
    } catch {
      setStatusMsg({ type: 'error', text: 'Failed to export data.' });
    }
  };

  const [importPreview, setImportPreview] = useState<{ groups: number, timecodes: number, entries: number, skipped: number } | null>(null);

  // The preview is validated against the selected mode, so switching mode
  // invalidates it: a merge preview says nothing about whether a replace import
  // would be accepted.
  React.useEffect(() => {
    setImportPreview(null);
    setShowReplaceConfirm(false);
    setReplaceConfirmText('');
  }, [importMode]);

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

        // The same size, parse, checksum and schema-version checks importData
        // runs. Skipping them here meant a hand-edited or future-format backup
        // showed a clean green preview and then failed on the real import.
        const parsed = await verifyBackupFile(file);
        // Validate exactly as importData will, or the preview passes a file the
        // import then rejects (and vice versa). Merge mode is the only one that
        // accepts a reference to a locally-stored timecode, and "locally stored"
        // there means every timecode in the database, trashed ones included.
        const knownTimecodeIds = importMode === 'merge'
          ? new Set([...timecodes, ...deletedTimecodes].map(t => t.id))
          : undefined;
        // The running-timer rule is judged against the setting that will be in
        // force after the import, and against the timers already running here —
        // the same inputs importData uses, so the two verdicts agree.
        validateBackupPayload(
          parsed,
          knownTimecodeIds,
          importMode === 'merge'
            ? {
                allowConcurrentTimers: settings?.allowConcurrentTimers ?? false,
                existingRunningCount: (() => {
                  const incomingIds = new Set<string>(
                    Array.isArray(parsed.entries) ? parsed.entries.map((e: any) => e?.id) : []
                  );
                  return entries.filter((e) => e.isRunning && !e.deletedAt && !incomingIds.has(e.id)).length;
                })(),
              }
            : undefined
        );

        // Merge mode drops incoming entries that overlap time already stored,
        // so the raw file count is not the number that will be imported. The
        // same `findOverlappingCandidates` pass importData uses gives the
        // number the user will actually get.
        let skipped = 0;
        if (importMode === 'merge') {
          const incoming: any[] = parsed.entries;
          const incomingIds = new Set(incoming.map((e: any) => e?.id));
          const untouchedLocal = entries.filter((e) => !incomingIds.has(e.id) && !e.deletedAt);
          const liveIncoming = incoming.filter((e: any) => !e?.deletedAt);
          skipped = findOverlappingCandidates(
            liveIncoming,
            untouchedLocal,
            settings?.allowConcurrentTimers ?? false
          ).size;
        }

        setImportPreview({
          groups: parsed.groups.length,
          timecodes: parsed.timecodes.length,
          entries: parsed.entries.length - skipped,
          skipped,
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
        // Declared outside the try: pass 2 creates timecodes before it writes
        // any entries, so a throw from the entry write would otherwise strand
        // them in the database with nothing referencing them, and every retry
        // would strand another set.
        const createdTimecodes: string[] = [];
        const createdGroups: string[] = [];

        /**
         * Remove the timecodes and groups this import created, for a run that
         * imported nothing. They are new by construction — nothing outside this
         * import can reference them yet — so hard-deleting them cannot orphan
         * anything.
         *
         * `hardDeleteTimecode` is guarded: it reports its own failure and
         * resolves either way, so the count comes from its return value.
         * Incrementing on every call instead claimed a cleanup that may not
         * have happened.
         */
        const rollbackCreatedTimecodes = async (): Promise<string> => {
          let rolledBack = 0;
          let failed = 0;
          for (const id of createdTimecodes) {
            if (await hardDeleteTimecode(id)) rolledBack++;
            else failed++;
          }
          createdTimecodes.length = 0;
          // Groups go after the timecodes that were filed under them, so a
          // failed timecode delete does not leave one stranded in no group.
          for (const id of createdGroups) {
            await hardDeleteGroup(id);
          }
          createdGroups.length = 0;
          if (rolledBack === 0 && failed === 0) return '';
          const removed = rolledBack > 0
            ? ` No entries were imported; ${rolledBack} ${rolledBack === 1 ? 'timecode' : 'timecodes'} created by this import ${rolledBack === 1 ? 'was' : 'were'} removed.`
            : ' No entries were imported.';
          // A failed rollback leaves the timecode live and empty, not trashed:
          // hardDeleteTimecode is a permanent delete, not a soft one.
          const leftover = failed > 0
            ? ` ${failed} could not be removed — delete ${failed === 1 ? 'it' : 'them'} from the timecode list.`
            : '';
          return removed + leftover;
        };

        try {
          if (results.data.length > MAX_IMPORT_ENTRIES) {
            setStatusMsg({ type: 'error', text: `CSV contains ${results.data.length} rows, exceeding the limit of ${MAX_IMPORT_ENTRIES}.` });
            return;
          }

          // Skips are tallied by reason, not just counted. "12 rows were
          // malformed" tells a user nothing they can act on; "9 with an
          // unreadable date or time" points straight at the date-format
          // dropdown, which is the setting that most often causes it.
          const skipReasons = new Map<string, number>();
          let skippedCount = 0;
          const skip = (reason: string, count = 1) => {
            if (count <= 0) return;
            skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + count);
            skippedCount += count;
          };

          // Two-pass approach:
          // Pass 1: Validate row fields, dates, amounts, tags, and check overlap in-memory BEFORE creating any timecodes or writing entries.
          type PreparedCandidate = {
            id: string;
            timecodeName: string;
            /** From the optional Group column; '' when the CSV does not say. */
            groupName: string;
            startTime: string;
            endTime: string;
            note: string;
            tags: string[];
            manualAmount: number | null;
          };

          const candidates: PreparedCandidate[] = [];

          for (const row of results.data as any[]) {
            try {
              let startTimeRaw = row['Start Time'] || row.startTime || row.start || row['Start'];
              let endTimeRaw = row['End Time'] || row.endTime || row.end || row['End'];
              const dateRaw = (row['Date'] || row.date || row.Date || '').trim();
              const timecodeName = (row['Timecode'] || row.timecode || row.name || '').trim();
              // Optional, and the column TimeDoco's own detailed CSV export
              // writes. It is what tells two identically named timecodes apart.
              const groupName = (row['Group'] || row.group || '').trim();
              const note = (row['Note'] || row.note || '').trim();
              const tagsRaw = row['Tags'] || row.tags || '';
              const amountRaw = row['Amount'] || row.amount || row.manualAmount || row['Manual Amount'];

              if (!startTimeRaw || !endTimeRaw || !timecodeName) {
                skip('missing a start time, end time or timecode');
                continue;
              }

              if (dateRaw && startTimeRaw && !startTimeRaw.includes('-') && !startTimeRaw.includes('/')) {
                startTimeRaw = `${dateRaw} ${startTimeRaw}`;
              }
              if (dateRaw && endTimeRaw && !endTimeRaw.includes('-') && !endTimeRaw.includes('/')) {
                endTimeRaw = `${dateRaw} ${endTimeRaw}`;
              }

              if (timecodeName.length > 100 || groupName.length > 100) {
                skip('a timecode or group name over 100 characters');
                continue;
              }

              if (note.length > 2000) {
                skip('a note over 2,000 characters');
                continue;
              }

              const startObj = parseCSVDate(startTimeRaw, csvDateFormat);
              const endObj = parseCSVDate(endTimeRaw, csvDateFormat);

              if (isNaN(startObj.getTime()) || isNaN(endObj.getTime())) {
                // Almost always the date-format dropdown, so say which it is.
                skip(`an unreadable date or time for the ${csvDateFormat.toUpperCase()} format`);
                continue;
              }

              if (endObj <= startObj) {
                skip('an end time at or before its start');
                continue;
              }

              let tags: string[] = [];
              if (Array.isArray(tagsRaw)) {
                tags = tagsRaw.filter((t: any) => typeof t === 'string').map(t => t.trim()).filter(Boolean);
              } else if (typeof tagsRaw === 'string' && tagsRaw.trim()) {
                tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
              }
              if (tags.length > 20 || tags.join(', ').length > 500) {
                skip('too many tags');
                continue;
              }

              const durationRaw = row['Duration (h, billed)'] ?? row['Duration (h, worked)'] ?? row['Duration (h)'] ?? row.duration ?? row['Duration'];
              const isDurationEmpty = durationRaw === undefined || durationRaw === null || String(durationRaw).trim() === '';

              let manualAmount: number | null = null;
              if (isDurationEmpty && amountRaw !== undefined && amountRaw !== null && String(amountRaw).trim() !== '') {
                const parsedAmt = parseFloat(String(amountRaw));
                if (!isNaN(parsedAmt) && isFinite(parsedAmt)) {
                  manualAmount = parsedAmt;
                } else {
                  skip('an unreadable amount');
                  continue;
                }
              }

              candidates.push({
                id: crypto.randomUUID(),
                timecodeName,
                groupName,
                startTime: startObj.toISOString(),
                endTime: endObj.toISOString(),
                note,
                tags,
                manualAmount,
              });
            } catch (error) {
              console.warn('Skipping malformed CSV row:', row, error);
              skip('a malformed row');
            }
          }

          if (candidates.length === 0) {
            setStatusMsg({ type: 'error', text: 'Failed to import any entries. Check the CSV format and date settings.' });
            return;
          }

          // Timecode names are only unique within a group, so a name on its own
          // does not identify one: "Design" can sit under both Acme and Globex.
          // Resolving by name and taking the first match billed the imported
          // hours to whichever of them IndexedDB happened to return first — an
          // order that is arbitrary and differs between devices. So resolve on
          // group + name where the CSV gives a group, and refuse to guess where
          // a name it needs matches more than one timecode.
          //
          // Trashed timecodes are in the set, the same ones the JSON import
          // resolves against: matching live timecodes only created a second,
          // identically named timecode whenever the CSV referred to one that
          // happened to be in the trash.
          const UNGROUPED_KEY = 'ungrouped';
          const groupNameById = new Map<string, string>();
          [...groups, ...deletedGroups].forEach(g => groupNameById.set(g.id, g.name.trim().toLowerCase()));
          const groupKeyOf = (groupId: string | null | undefined) =>
            (groupId ? groupNameById.get(groupId) : null) || UNGROUPED_KEY;

          const allTimecodes = [...timecodes, ...deletedTimecodes];
          const byName = new Map<string, typeof allTimecodes>();
          const byGroupAndName = new Map<string, typeof allTimecodes>();
          const addTo = (map: Map<string, typeof allTimecodes>, key: string, tc: typeof allTimecodes[number]) => {
            const existing = map.get(key);
            if (existing) existing.push(tc);
            else map.set(key, [tc]);
          };
          for (const tc of allTimecodes) {
            const name = tc.name.trim().toLowerCase();
            addTo(byName, name, tc);
            addTo(byGroupAndName, `${groupKeyOf(tc.groupId)}|${name}`, tc);
          }

          /**
           * The timecodes a row could mean. A row naming a group is matched on
           * group + name; one that does not falls back to the name alone, which
           * only identifies a timecode when the name is unique across groups.
           */
          const matchesFor = (candidate: PreparedCandidate) => {
            const name = candidate.timecodeName.toLowerCase();
            if (candidate.groupName) {
              return byGroupAndName.get(`${candidate.groupName.toLowerCase()}|${name}`) || [];
            }
            return byName.get(name) || [];
          };

          // Assign temporary or existing timecode IDs for overlap check
          const candidateEntriesForCheck = candidates.map(c => {
            const matches = matchesFor(c);
            const existingId = matches.length === 1 ? matches[0].id : undefined;
            return {
              id: c.id,
              timecodeId: existingId || `temp-${c.groupName.toLowerCase()}|${c.timecodeName.toLowerCase()}`,
              startTime: c.startTime,
              endTime: c.endTime,
              duration: 0,
              note: c.note,
              tags: c.tags,
              isRunning: false,
              isPaused: false,
              pausedSegments: [],
              editHistory: [],
              createdAt: c.startTime,
              updatedAt: c.startTime,
            };
          });

          // Fetch full list of entries from tracker context state if needed or we use current entries from tracker
          // Since we are inside component, we can access entries from useTimeTracker:
          const rejectedIndices = findOverlappingCandidates(
            candidateEntriesForCheck,
            entries,
            settings?.allowConcurrentTimers ?? false
          );

          const survivingCandidates = candidates.filter((_, idx) => !rejectedIndices.has(idx));
          skip('overlapping an entry you already have', rejectedIndices.size);

          if (survivingCandidates.length === 0) {
            setStatusMsg({ type: 'error', text: 'Failed to import any entries. All rows overlapped existing entries.' });
            return;
          }

          // Nothing has been written yet, and nothing is written past here if a
          // name the CSV needs could mean more than one timecode. Guessing puts
          // the hours on the wrong client's invoice with nothing on screen to
          // say a choice was made, so stop and name what is ambiguous instead.
          const groupLabelById = new Map<string, string>();
          [...groups, ...deletedGroups].forEach(g => groupLabelById.set(g.id, g.name));
          const ambiguous = new Map<string, string[]>();
          for (const c of survivingCandidates) {
            const matches = matchesFor(c);
            if (matches.length < 2) continue;
            const label = c.groupName ? `"${c.timecodeName}" in "${c.groupName}"` : `"${c.timecodeName}"`;
            if (!ambiguous.has(label)) {
              ambiguous.set(label, matches.map(tc => (tc.groupId && groupLabelById.get(tc.groupId)) || 'Ungrouped'));
            }
          }

          if (ambiguous.size > 0) {
            const detail = Array.from(ambiguous.entries())
              .map(([label, groupNames]) => `${label} (${groupNames.join(', ')})`)
              .join('; ');
            setStatusMsg({
              type: 'error',
              text: `Import stopped: ${ambiguous.size === 1 ? 'a timecode name in' : `${ambiguous.size} timecode names in`} this CSV ` +
                `${ambiguous.size === 1 ? 'matches' : 'match'} more than one of your timecodes, so ${ambiguous.size === 1 ? 'its' : 'their'} ` +
                `rows could be billed against the wrong one — ${detail}. ` +
                'Add a Group column naming the group each row belongs to, or rename the timecodes so they differ. ' +
                'Nothing was imported.',
            });
            return;
          }

          // A CSV row that resolves to a trashed timecode reuses that record
          // rather than silently creating a duplicate of it. Restoring one also
          // brings back the entries trashed with it, so the user decides.
          const resolved = new Map<string, typeof allTimecodes[number]>();
          for (const c of survivingCandidates) {
            const matches = matchesFor(c);
            if (matches.length === 1) resolved.set(c.id, matches[0]);
          }
          const trashedMatches = Array.from(new Set(resolved.values())).filter(tc => tc.deletedAt);
          let reuseTrashed = false;
          if (trashedMatches.length > 0) {
            reuseTrashed = window.confirm(
              `${trashedMatches.length === 1 ? 'A timecode' : `${trashedMatches.length} timecodes`} in this CSV ` +
              `${trashedMatches.length === 1 ? 'matches one' : 'match ones'} currently in the trash ` +
              `(${trashedMatches.map(tc => tc.name).join(', ')}).\n\n` +
              'OK restores them and files the imported rows against them — which also restores any entries ' +
              'trashed alongside them.\nCancel creates new timecodes with the same names instead.'
            );
          }

          const restoredTimecodes: string[] = [];
          if (reuseTrashed) {
            for (const tc of trashedMatches) {
              if (await restoreTimecode(tc.id)) restoredTimecodes.push(tc.id);
            }
          }

          // Pass 2: Create required timecodes and add surviving entries. Each
          // row uses the timecode it resolved to above, so a row is never
          // re-matched by name here and never lands somewhere the ambiguity
          // check did not vet.
          const restoredIds = new Set(restoredTimecodes);
          const groupIdByName = new Map<string, string>();
          groups.forEach(g => groupIdByName.set(g.name.trim().toLowerCase(), g.id));
          const createdTimecodeByKey = new Map<string, string>();
          const entriesToBulkAdd: { startTime: string; endTime: string; timecodeId: string; note: string; tags: string[]; manualAmount: number | null }[] = [];

          for (const item of survivingCandidates) {
            const match = resolved.get(item.id);
            // A trashed match the user declined to restore is not usable, so
            // the row gets a new timecode of the same name instead.
            const usable = match && (!match.deletedAt || (reuseTrashed && restoredIds.has(match.id)));

            let timecodeId: string;
            if (usable) {
              timecodeId = match!.id;
            } else {
              // Rows sharing a name (and a group, where the CSV names one) share
              // the timecode created for them rather than getting one each.
              const key = `${item.groupName.toLowerCase()}|${item.timecodeName.toLowerCase()}`;
              const already = createdTimecodeByKey.get(key);
              if (already) {
                timecodeId = already;
              } else {
                let groupId: string | undefined;
                const wantedGroup = item.groupName.trim().toLowerCase();
                if (wantedGroup && wantedGroup !== UNGROUPED_KEY) {
                  groupId = groupIdByName.get(wantedGroup);
                  if (!groupId) {
                    const group = await addGroup(item.groupName.trim(), CSV_IMPORT_GROUP_COLOR);
                    groupId = group.id;
                    groupIdByName.set(wantedGroup, group.id);
                    createdGroups.push(group.id);
                  }
                }
                const tc = await addTimecode(item.timecodeName, undefined, groupId, undefined, { deferRefresh: true });
                createdTimecodeByKey.set(key, tc.id);
                createdTimecodes.push(tc.id);
                timecodeId = tc.id;
              }
            }

            entriesToBulkAdd.push({
              startTime: item.startTime,
              endTime: item.endTime,
              timecodeId,
              note: item.note,
              tags: item.tags,
              manualAmount: item.manualAmount,
            });
          }

          const result = await bulkAddManualEntries(entriesToBulkAdd);
          let importedCount = result ? result.added : entriesToBulkAdd.length;
          if (result && result.skipped > 0) {
            skip('rejected on write as overlapping', result.skipped);
          }

          if (importedCount > 0 && skippedCount === 0) {
            setStatusMsg({ type: 'success', text: `Successfully imported all ${importedCount} entries from CSV.` });
          } else if (importedCount > 0 && skippedCount > 0) {
            setStatusMsg({ type: 'error', text: `Imported ${importedCount} entries, skipped ${skippedCount} rows — ${describeSkips(skipReasons)}.` });
          } else {
            // Nothing was written, and `bulkAddManualEntries` resolves rather
            // than throwing when its own overlap pass rejects every row — so
            // the catch below never ran and the timecodes this import created
            // were left behind, empty, with nothing referencing them.
            const cleanup = await rollbackCreatedTimecodes();
            setStatusMsg({
              type: 'error',
              text: 'Failed to import any entries. Check the CSV format, and that its rows do not overlap entries you already have.' + cleanup,
            });
          }
        } catch (err: any) {
          const cleanup = await rollbackCreatedTimecodes();
          setStatusMsg({ type: 'error', text: `CSV Import Error: ${err.message || 'An unexpected error occurred.'}${cleanup}` });
        } finally {
          setIsProcessing(false);
          if (csvInputRef.current) csvInputRef.current.value = '';
        }
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
                  value={settings?.theme || 'dark'}
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
              <div className="flex flex-col mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings?.overrunAudioAlertEnabled !== false}
                    onChange={(e) => handleUpdateSettings({ overrunAudioAlertEnabled: e.target.checked })}
                    className="w-4 h-4 text-signal rounded border-graphite/20 dark:border-white/20 focus:ring-signal"
                  />
                  <span className="text-sm font-medium text-graphite dark:text-stone">Play Sound When Estimate Is Passed</span>
                  <HelpTooltip text="Plays a short chime the moment a running timer passes its estimated duration." />
                </label>
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
                        void handleUpdateSettings({ customFields: updated });
                      }}
                      className="w-32 px-2 py-1.5 text-sm border border-graphite/20 dark:border-white/20 rounded bg-white dark:bg-graphite text-graphite dark:text-stone"
                    />
                    <input
                      type="text" value={field.value} placeholder="Value"
                      onChange={(e) => {
                        const updated = [...(settings?.customFields || [])];
                        updated[i] = { ...updated[i], value: e.target.value };
                        void handleUpdateSettings({ customFields: updated });
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
              <div className="mb-2">
                <label className="text-sm font-medium text-graphite dark:text-stone flex items-center mb-1">
                  Default Report Footer
                  <HelpTooltip text="Appears at the bottom of generated PDF reports — payment details, terms, bank info, etc." />
                </label>
                <textarea
                  value={settings?.reportFooterText ?? ''}
                  onChange={(e) => handleUpdateSettings({ reportFooterText: e.target.value })}
                  placeholder="Default report footer — payment details, terms, etc."
                  rows={3}
                  className="w-full px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone resize-y"
                />
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
                  Timer Alert (Minutes)
                  <HelpTooltip text="Notifies you when any single timer has been running for this many minutes." />
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
              {(settings?.roundingRule ?? 'none') !== 'none' && (
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-graphite dark:text-stone flex items-center">
                    Apply Rounding
                    <HelpTooltip text="Rounding each entry separately compounds: ten 7-minute entries at 15-minute rounding each round to zero and bill nothing. Rounding a wider bucket keeps the difference to at most one interval." />
                  </label>
                  <select
                    value={settings?.roundingScope ?? 'day'}
                    onChange={(e) => handleUpdateSettings({ roundingScope: e.target.value as 'entry' | 'day' | 'timecode' | 'invoice' })}
                    className="px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                  >
                    <option value="entry">To each entry</option>
                    <option value="day">To each day's total</option>
                    <option value="timecode">To each timecode's total</option>
                    <option value="invoice">To the report total</option>
                  </select>
                </div>
              )}
              {(settings?.roundingRule ?? 'none') !== 'none' &&
                (settings?.roundingScope === 'timecode' || settings?.roundingScope === 'invoice') && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 -mt-1 mb-2">
                    These two totals are measured over a reporting period, so they apply on the report in
                    Analysis &amp; Export. Every other view — the entry list, the timesheet and the weekly
                    summary — covers whatever span happens to be on screen rather than a period you chose,
                    so it rounds each day's total instead. That keeps them showing one figure for a day
                    however far back you scroll.
                  </p>
                )}
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
                  <br/><br/>
                  Your data can be deleted by browser storage pressure, clearing site data manually, or (on Safari) a week of not opening the app. <a href="https://timedoco.com/faq" className="underline hover:text-yellow-800 dark:hover:text-yellow-300">Read more</a>
                </p>
              </div>


              <div className="mb-6">
                <h3 className="text-md font-semibold text-graphite dark:text-stone mb-2">Storage Protection</h3>

                {persistenceState === 'persisted' && (
                  <div className="flex items-start gap-3 bg-signal/10 dark:bg-signal/20 border border-signal/20 rounded-md p-3">
                    <Shield className="text-signal-dim dark:text-signal mt-0.5 shrink-0" size={18} />
                    <div>
                      <h4 className="text-sm font-semibold text-graphite dark:text-stone">Protected</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Your browser has agreed to keep TimeDoco's data even when storage runs low.
                      </p>
                    </div>
                  </div>
                )}

                {persistenceState === 'best-effort' && (
                  <div className="flex items-start gap-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-md p-3">
                    <ShieldAlert className="text-yellow-800 dark:text-yellow-400 mt-0.5 shrink-0" size={18} />
                    <div className="w-full">
                      <h4 className="text-sm font-semibold text-yellow-800 dark:text-yellow-400">Best-effort</h4>
                      <p className="text-xs text-yellow-700 dark:text-yellow-500 mt-1">
                        Your browser may delete TimeDoco's data if the device runs low on space.
                      </p>
                      <div className="mt-3 flex gap-2 flex-wrap">
                        <button
                          onClick={async () => {
                            const result = await requestPersistence();
                            setPersistenceState(result);
                          }}
                          className="text-xs px-3 py-1.5 bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 rounded hover:bg-yellow-300 dark:hover:bg-yellow-700 transition-colors"
                        >
                          Request protection
                        </button>
                        {needsManualInstall && (
                          <button
                            onClick={() => {
                              // Trigger an event or state to show the install modal.
                              // Actually, SettingsModal doesn't know about showIOSInstallModal in App.tsx.
                              // Since we need to trigger it, maybe we dispatch an event.
                              window.dispatchEvent(new CustomEvent('show-ios-install-modal'));
                            }}
                            className="text-xs px-3 py-1.5 bg-signal/10 dark:bg-signal/20 text-signal-dim dark:text-signal rounded hover:bg-signal/20 transition-colors"
                          >
                            Show iOS Install Guide
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {persistenceState === 'unsupported' && (
                  <div className="flex items-start gap-3 bg-gray-50 dark:bg-graphite border border-gray-200 dark:border-gray-700 rounded-md p-3">
                    <ShieldOff className="text-gray-500 mt-0.5 shrink-0" size={18} />
                    <div>
                      <h4 className="text-sm font-semibold text-graphite dark:text-stone">Unsupported</h4>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        Your browser does not support checking storage protection. Rely on regular backups.
                      </p>
                    </div>
                  </div>
                )}

                {storageUsage && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                    Using {(storageUsage.usage / 1024 / 1024).toFixed(2)} MB of ~{(storageUsage.quota / 1024 / 1024).toFixed(0)} MB available
                  </p>
                )}
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
                        <p className="font-medium mb-1">Backup valid! Will import:</p>
                        <ul className="list-disc pl-5">
                          <li>{importPreview.groups} groups</li>
                          <li>{importPreview.timecodes} timecodes</li>
                          <li>{importPreview.entries} entries</li>
                        </ul>
                        {importPreview.skipped > 0 && (
                          <p className="mt-2 text-gray-600 dark:text-gray-400">
                            {importPreview.skipped} {importPreview.skipped === 1 ? 'entry' : 'entries'} will be skipped
                            because {importPreview.skipped === 1 ? 'it overlaps' : 'they overlap'} time you already have.
                          </p>
                        )}
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
                Add an optional "Group" column where a timecode name is used by more than one group — without it, a name
                that matches two timecodes stops the import rather than guessing which client to bill.
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

                <div>
                  <label className="block text-sm font-medium text-graphite dark:text-stone mb-1 flex items-center">
                    Date Format in CSV
                    <HelpTooltip text="Choose how dates and times in your CSV are formatted so day and month values are parsed accurately." />
                  </label>
                  <select
                    value={csvDateFormat}
                    onChange={(e) => setCsvDateFormat(e.target.value as 'iso' | 'dmy' | 'mdy')}
                    className="w-full px-3 py-1.5 border border-graphite/20 dark:border-white/20 rounded outline-none focus-visible:ring-2 focus-visible:ring-signal text-sm bg-white dark:bg-graphite text-graphite dark:text-stone"
                  >
                    <option value="iso">ISO 8601 / Standard (YYYY-MM-DD)</option>
                    <option value="dmy">Day/Month/Year (DD/MM/YYYY)</option>
                    <option value="mdy">Month/Day/Year (MM/DD/YYYY)</option>
                  </select>
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
                      // The success toast has to wait for the write. The
                      // clipboard rejects when the document is not focused or
                      // permission is refused, and a user told the log was
                      // copied pastes an empty bug report.
                      navigator.clipboard.writeText(logText).then(
                        () => addToast('Error log copied to clipboard.', 'success'),
                        () => addToast('Could not copy — your browser blocked clipboard access.', 'error'),
                      );
                    }}
                    className="text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-graphite dark:hover:text-stone transition-colors"
                  >
                    Copy Error Log
                  </button>
                  {(deletedEntries.length > 0 || deletedTimecodes.length > 0 || deletedGroups.length > 0) && (
                    <button
                      onClick={async () => {
                        if (window.confirm('Are you sure you want to permanently empty all items in the trash? This action cannot be undone.')) {
                          if (await emptyTrash()) {
                            setStatusMsg({ type: 'success', text: 'Trash emptied successfully.' });
                          }
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
      <SaveAsDialog />
    </Modal>
  );
};
