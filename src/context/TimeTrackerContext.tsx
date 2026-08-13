import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Group, Timecode, Entry, Settings } from '../types';
import * as db from '../db';
import { differenceInSeconds } from 'date-fns';
import { calculateDuration } from '../utils/timeUtils';
import { useToast } from './ToastContext';

interface TimeTrackerContextType {
  groups: Group[];
  timecodes: Timecode[];
  activeEntries: Entry[];
  startTimer: (timecodeId: string) => Promise<void>;
  stopTimer: (entryId: string) => Promise<void>;
  pauseTimer: (entryId: string, pauseStartTime?: string) => Promise<void>;
  resumeTimer: (entryId: string) => Promise<void>;
  addGroup: (name: string, color: string) => Promise<Group>;
  updateGroup: (id: string, updates: Partial<Group>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  addTimecode: (name: string, color?: string, groupId?: string, hourlyRate?: number) => Promise<Timecode>;
  updateTimecode: (id: string, updates: Partial<Timecode>) => Promise<void>;
  deleteTimecode: (id: string) => Promise<void>;
  mergeTimecodes: (sourceId: string, destId: string) => Promise<void>;
  updateActiveNote: (entryId: string, note: string) => Promise<void>;
  refreshData: () => Promise<void>;
  entries: Entry[];
  updateEntry: (id: string, updates: Partial<Entry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  splitEntry: (entryId: string, splitTime: string, newTimecodeId?: string) => Promise<void>;
  addManualEntry: (entryData: { startTime: string, endTime: string, timecodeId: string, note: string }) => Promise<void>;
  forgotToStopEntry: Entry | null;
  dismissForgotToStop: () => void;
  settings: Settings | null;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  exportData: () => Promise<void>;
  importData: (file: File, mode: 'merge' | 'replace') => Promise<void>;
  lastStoppedEntry: Entry | null;
  undoStopTimer: (entry: Entry) => Promise<void>;
clearLastStoppedEntry: () => void;
  deletedGroups: Group[];
  deletedTimecodes: Timecode[];
  deletedEntries: Entry[];
  restoreGroup: (id: string) => Promise<void>;
  restoreTimecode: (id: string) => Promise<void>;
  restoreEntry: (id: string) => Promise<void>;
  hardDeleteGroup: (id: string) => Promise<void>;
  hardDeleteTimecode: (id: string) => Promise<void>;
  hardDeleteEntry: (id: string) => Promise<void>;
}

const TimeTrackerContext = createContext<TimeTrackerContextType | undefined>(undefined);

export const TimeTrackerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { addToast } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [deletedGroups, setDeletedGroups] = useState<Group[]>([]);
  const [timecodes, setTimecodes] = useState<Timecode[]>([]);
  const [deletedTimecodes, setDeletedTimecodes] = useState<Timecode[]>([]);
  const [activeEntries, setActiveEntries] = useState<Entry[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [deletedEntries, setDeletedEntries] = useState<Entry[]>([]);
  const [forgotToStopEntry, setForgotToStopEntry] = useState<Entry | null>(null);
  const [dismissedForgotToStopId, setDismissedForgotToStopId] = useState<string | null>(() => {
    return localStorage.getItem('dismissedForgotToStopId');
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lastStoppedEntry, setLastStoppedEntry] = useState<Entry | null>(null);

  const clearLastStoppedEntry = useCallback(() => {
    setLastStoppedEntry(null);
  }, []);

  const undoStopTimer = async (entryToUndo: Entry) => {
    if (!entryToUndo) return;

    // Remove endTime and duration, set isRunning back to true
    const updatedEntry: Entry = {
      ...entryToUndo,
      endTime: null,
      duration: 0,
      isRunning: true,
      updatedAt: new Date().toISOString(),
    };

    await db.putEntry(updatedEntry);
    setLastStoppedEntry(null);
    await refreshData();
  };

  const refreshData = useCallback(async () => {
    const loadedGroups = await db.getGroups();
    const loadedTimecodes = await db.getTimecodes();
    const loadedEntries = await db.getEntries();
    const loadedActiveEntries = await db.getActiveEntries();
    let loadedSettings = await db.getSettings();

    if (!loadedSettings) {
      loadedSettings = {
        id: 'user-settings',
        lastBackupDate: null,
        reminderIntervalDays: 7,
        roundingRule: 'none',
        idleThresholdMinutes: 15,
        weeklyTargetHours: null,
        allowConcurrentTimers: false,
      };
      await db.putSettings(loadedSettings);
    }

    setGroups(loadedGroups.filter(g => !g.deletedAt));
    setDeletedGroups(loadedGroups.filter(g => g.deletedAt));
    setTimecodes(loadedTimecodes.filter(t => !t.deletedAt));
    setDeletedTimecodes(loadedTimecodes.filter(t => t.deletedAt));
    // Sort entries descending by startTime for the list
    setEntries(loadedEntries.filter(e => !e.deletedAt).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()));
    setDeletedEntries(loadedEntries.filter(e => e.deletedAt));
    setActiveEntries(loadedActiveEntries);
    setSettings(loadedSettings);

    // "Forgot-to-stop" Detection
    if (loadedActiveEntries.length > 0) {
      let foundForgot = false;
      for (const entry of loadedActiveEntries) {
        if (entry.id === dismissedForgotToStopId) continue;
        const start = new Date(entry.startTime);
        const now = new Date();
        const hoursElapsed = differenceInSeconds(now, start) / 3600;

        if (hoursElapsed > 10 || (hoursElapsed > 0 && start.getDate() !== now.getDate())) {
          setForgotToStopEntry(entry);
          foundForgot = true;
          break;
        }
      }
      if (!foundForgot) setForgotToStopEntry(null);
    } else {
      setForgotToStopEntry(null);
    }
  }, [dismissedForgotToStopId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const startTimer = async (timecodeId: string) => {
    const isConcurrentAllowed = settings?.allowConcurrentTimers ?? false;
    const currentActive = await db.getActiveEntries();

    if (!isConcurrentAllowed) {
      // Stop all running timers
      for (const entry of currentActive) {
        await stopTimerById(entry.id);
      }
    } else {
      // Stop timer for the exact same timecode if it exists to prevent duplicates
      for (const entry of currentActive) {
        if (entry.timecodeId === timecodeId) {
          await stopTimerById(entry.id);
        }
      }
    }

    const now = new Date().toISOString();
    const newEntry: Entry = {
      id: crypto.randomUUID(),
      timecodeId,
      startTime: now,
      endTime: null,
      duration: 0,
      note: '',
      isRunning: true,
      isPaused: false,
      pausedSegments: [],
      editHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.putEntry(newEntry);
    await refreshData();
    addToast('Timer started', 'success');
  };

  const stopTimerById = async (entryId: string) => {
    const entry = await db.getEntry(entryId);
    if (!entry || !entry.isRunning) return;
    const now = new Date();
    const endTimeIso = now.toISOString();

    // Close open pause segment if paused
    let newPausedSegments = [...entry.pausedSegments];
    if (entry.isPaused && newPausedSegments.length > 0) {
      newPausedSegments[newPausedSegments.length - 1] = {
        ...newPausedSegments[newPausedSegments.length - 1],
        pauseEnd: endTimeIso,
      };
    }

    const start = new Date(entry.startTime);
    const duration = calculateDuration(start, now, newPausedSegments);

    const updatedEntry: Entry = {
      ...entry,
      endTime: endTimeIso,
      duration,
      isRunning: false,
      isPaused: false,
      pausedSegments: newPausedSegments,
      updatedAt: endTimeIso,
    };
    await db.putEntry(updatedEntry);
  };

  const stopTimer = async (entryId: string) => {
    const entry = await db.getEntry(entryId);
    await stopTimerById(entryId);
    if (entry) {
      setLastStoppedEntry(entry);
      addToast('Timer stopped', 'success', { label: 'Undo', onClick: () => undoStopTimer(entry) }, 5000);
    }
    await refreshData();
  };

  const pauseTimer = async (entryId: string, pauseStartTime?: string) => {
    const entry = await db.getEntry(entryId);
    if (!entry || !entry.isRunning || entry.isPaused) return;
    const now = new Date().toISOString();
    const startOfPause = pauseStartTime || now;
    const updatedEntry: Entry = {
      ...entry,
      isPaused: true,
      pausedSegments: [...entry.pausedSegments, { pauseStart: startOfPause }],
      updatedAt: now,
    };
    await db.putEntry(updatedEntry);
    await refreshData();
    addToast('Timer paused', 'info');
  };

  const resumeTimer = async (entryId: string) => {
    const entry = await db.getEntry(entryId);
    if (!entry || !entry.isRunning || !entry.isPaused) return;
    const now = new Date().toISOString();
    const newPausedSegments = [...entry.pausedSegments];
    if (newPausedSegments.length > 0) {
      newPausedSegments[newPausedSegments.length - 1] = {
        ...newPausedSegments[newPausedSegments.length - 1],
        pauseEnd: now,
      };
    }
    const updatedEntry: Entry = {
      ...entry,
      isPaused: false,
      pausedSegments: newPausedSegments,
      updatedAt: now,
    };
    await db.putEntry(updatedEntry);
    await refreshData();
    addToast('Timer resumed', 'success');
  };

  const updateActiveNote = async (entryId: string, note: string) => {
    const entry = await db.getEntry(entryId);
    if (!entry || !entry.isRunning) return;
    const now = new Date().toISOString();
    const updatedEntry: Entry = {
      ...entry,
      note,
      updatedAt: now,
    };
    await db.putEntry(updatedEntry);
    await refreshData();
  };

  const addGroup = async (name: string, color: string): Promise<Group> => {
    const newGroup: Group = {
      id: crypto.randomUUID(),
      name,
      color,
      archived: false,
    };
    await db.putGroup(newGroup);
    await refreshData();
    return newGroup;
  };

  const updateGroup = async (id: string, updates: Partial<Group>) => {
    const groupToUpdate = groups.find((g) => g.id === id);
    if (!groupToUpdate) return;
    const updatedGroup = { ...groupToUpdate, ...updates };
    await db.putGroup(updatedGroup);
    await refreshData();
  };

  const deleteGroup = async (id: string) => {
    const group = await db.getGroup(id);
    if (group) {
      await db.putGroup({ ...group, deletedAt: new Date().toISOString() });
    }
    await refreshData();
  };

  const hardDeleteGroup = async (id: string) => {
    // Cascading: set groupId to null for all timecodes in this group
    const timecodesToUpdate = [...timecodes, ...deletedTimecodes].filter((tc) => tc.groupId === id);
    for (const tc of timecodesToUpdate) {
      await db.putTimecode({ ...tc, groupId: null });
    }
    await db.deleteGroup(id);
    await refreshData();
  };

  const restoreGroup = async (id: string) => {
    const group = await db.getGroup(id);
    if (group) {
      group.deletedAt = undefined;
      await db.putGroup(group);
    }
    await refreshData();
  };

  const addTimecode = async (name: string, color?: string, groupId?: string, hourlyRate?: number): Promise<Timecode> => {
    const newTimecode: Timecode = {
      id: crypto.randomUUID(),
      name,
      groupId: groupId || null,
      color,
      hourlyRate: hourlyRate ?? null,
      archived: false,
    };
    await db.putTimecode(newTimecode);
    await refreshData();
    return newTimecode;
  };

  const updateTimecode = async (id: string, updates: Partial<Timecode>) => {
    const tcToUpdate = timecodes.find((t) => t.id === id);
    if (!tcToUpdate) return;
    const updatedTimecode = { ...tcToUpdate, ...updates };
    await db.putTimecode(updatedTimecode);
    await refreshData();
  };

  const dismissForgotToStop = () => {
    if (forgotToStopEntry) {
      const id = forgotToStopEntry.id;
      setDismissedForgotToStopId(id);
      localStorage.setItem('dismissedForgotToStopId', id);
      setForgotToStopEntry(null);
    }
  };

  const updateEntry = async (id: string, updates: Partial<Entry>) => {
    const entryToUpdate = await db.getEntry(id);
    if (!entryToUpdate) return;

    const now = new Date().toISOString();
    const newEditHistory = [...entryToUpdate.editHistory];

    const fieldsToTrack: (keyof Entry)[] = ['startTime', 'endTime', 'timecodeId', 'note'];
    fieldsToTrack.forEach(field => {
      if (updates[field] !== undefined && updates[field] !== entryToUpdate[field]) {
        newEditHistory.push({
          field,
          oldValue: entryToUpdate[field],
          newValue: updates[field],
          editedAt: now,
        });
      }
    });

    let newDuration = entryToUpdate.duration;
    let newIsRunning = entryToUpdate.isRunning;
    let newIsPaused = entryToUpdate.isPaused;
    let newPausedSegments = [...entryToUpdate.pausedSegments];

    const finalStartTime = updates.startTime || entryToUpdate.startTime;
    const finalEndTime = updates.endTime !== undefined ? updates.endTime : entryToUpdate.endTime;

    if (finalEndTime) {
      // It's being closed or updated
      newIsRunning = false;
      if (newIsPaused && newPausedSegments.length > 0) {
        newPausedSegments[newPausedSegments.length - 1] = {
          ...newPausedSegments[newPausedSegments.length - 1],
          pauseEnd: finalEndTime,
        };
        newIsPaused = false;
      }

      const start = new Date(finalStartTime);
      const end = new Date(finalEndTime);
      newDuration = calculateDuration(start, end, newPausedSegments);
    }

    const finalEntry: Entry = {
      ...entryToUpdate,
      ...updates,
      duration: newDuration,
      isRunning: newIsRunning,
      isPaused: newIsPaused,
      pausedSegments: newPausedSegments,
      editHistory: newEditHistory,
      updatedAt: now,
    };

    await db.putEntry(finalEntry);

    if (forgotToStopEntry && forgotToStopEntry.id === id && updates.endTime) {
      setForgotToStopEntry(null);
      setDismissedForgotToStopId(null);
      localStorage.removeItem('dismissedForgotToStopId');
    } else if (dismissedForgotToStopId === id && updates.endTime) {
      // Clear it from storage if the user addresses it without the banner active
      setDismissedForgotToStopId(null);
      localStorage.removeItem('dismissedForgotToStopId');
    }

    await refreshData();
  };

  const addManualEntry = async (entryData: { startTime: string, endTime: string, timecodeId: string, note: string }) => {
    const now = new Date().toISOString();
    const duration = differenceInSeconds(new Date(entryData.endTime), new Date(entryData.startTime));

    const newEntry: Entry = {
      id: crypto.randomUUID(),
      timecodeId: entryData.timecodeId,
      startTime: entryData.startTime,
      endTime: entryData.endTime,
      duration: duration > 0 ? duration : 0,
      note: entryData.note,
      isRunning: false,
      isPaused: false,
      pausedSegments: [],
      editHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    await db.putEntry(newEntry);
    await refreshData();
  };


  const mergeTimecodes = async (sourceId: string, destId: string) => {
    // 1. Update all entries referencing sourceId to point to destId
    const entriesToUpdate = entries.filter((e) => e.timecodeId === sourceId);
    for (const entry of entriesToUpdate) {
      await db.putEntry({ ...entry, timecodeId: destId, updatedAt: new Date().toISOString() });
    }

    // 2. Update active entries as well, if any are running on the source timecode
    const currentActive = await db.getActiveEntries();
    for (const entry of currentActive) {
      if (entry.timecodeId === sourceId) {
        await db.putEntry({ ...entry, timecodeId: destId, updatedAt: new Date().toISOString() });
      }
    }

    // 3. Delete the source timecode
    await db.deleteTimecode(sourceId);

    // 4. Refresh everything
    await refreshData();
  };

  const deleteTimecode = async (id: string) => {
    // Cascading: soft-delete all entries associated with this timecode
    const entriesToDelete = [...entries, ...deletedEntries].filter((e) => e.timecodeId === id && !e.deletedAt);
    const now = new Date().toISOString();
    for (const entry of entriesToDelete) {
      await db.putEntry({ ...entry, deletedAt: now });
    }
    const tc = await db.getTimecode(id);
    if (tc) {
      await db.putTimecode({ ...tc, deletedAt: now });
    }
    await refreshData();
  };

  const hardDeleteTimecode = async (id: string) => {
    const entriesToDelete = [...entries, ...deletedEntries].filter((e) => e.timecodeId === id);
    for (const entry of entriesToDelete) {
      await db.deleteEntry(entry.id);
    }
    await db.deleteTimecode(id);
    await refreshData();
  };

  const restoreTimecode = async (id: string) => {
    const tc = await db.getTimecode(id);
    if (tc) {
      tc.deletedAt = undefined;
      await db.putTimecode(tc);
    }
    await refreshData();
  };

  const updateSettings = async (updates: Partial<Settings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...updates };
    await db.putSettings(newSettings);
    await refreshData();
  };


  const splitEntry = async (entryId: string, splitTime: string, newTimecodeId?: string) => {
    const entry = await db.getEntry(entryId);
    if (!entry || !entry.endTime) return; // Can only split completed entries

    const splitDate = new Date(splitTime);
    const startDate = new Date(entry.startTime);
    const endDate = new Date(entry.endTime);

    if (splitDate <= startDate || splitDate >= endDate) return;

    // Filter paused segments for both halves
    const pausedSegments1: any[] = [];
    const pausedSegments2: any[] = [];

    for (const seg of entry.pausedSegments) {
      const pStart = new Date(seg.pauseStart);
      const pEnd = seg.pauseEnd ? new Date(seg.pauseEnd) : endDate;

      if (pEnd <= splitDate) {
        pausedSegments1.push(seg);
      } else if (pStart >= splitDate) {
        pausedSegments2.push(seg);
      } else {
        // Segment crosses the split time
        pausedSegments1.push({ pauseStart: seg.pauseStart, pauseEnd: splitDate.toISOString() });
        pausedSegments2.push({ pauseStart: splitDate.toISOString(), pauseEnd: seg.pauseEnd });
      }
    }

    const duration1 = calculateDuration(startDate, splitDate, pausedSegments1);
    const duration2 = calculateDuration(splitDate, endDate, pausedSegments2);

    const now = new Date().toISOString();

    const entry1: Entry = {
      ...entry,
      endTime: splitDate.toISOString(),
      duration: duration1,
      pausedSegments: pausedSegments1,
      updatedAt: now,
    };

    const entry2: Entry = {
      ...entry,
      id: crypto.randomUUID(),
      timecodeId: newTimecodeId || entry.timecodeId,
      startTime: splitDate.toISOString(),
      duration: duration2,
      pausedSegments: pausedSegments2,
      createdAt: now,
      updatedAt: now,
      editHistory: [],
    };

    await db.putEntry(entry1);
    await db.putEntry(entry2);
    await refreshData();
  };

  const deleteEntry = async (id: string) => {
    const entry = await db.getEntry(id);
    if (entry) {
      await db.putEntry({ ...entry, deletedAt: new Date().toISOString() });
      await refreshData();
    }
  };

  const hardDeleteEntry = async (id: string) => {
    await db.deleteEntry(id);
    await refreshData();
  };

  const restoreEntry = async (id: string) => {
    const entry = await db.getEntry(id);
    if (entry) {
      entry.deletedAt = undefined;
      await db.putEntry(entry);
      await refreshData();
    }
  };

  const exportData = async () => {
    const allGroups = await db.getGroups();
    const allTimecodes = await db.getTimecodes();
    const allEntries = await db.getEntries();
    const currentSettings = await db.getSettings();

    const dataToExport = {
      schemaVersion: 1,
      groups: allGroups,
      timecodes: allTimecodes,
      entries: allEntries,
      settings: currentSettings,
    };

    const payloadString = JSON.stringify(dataToExport);

    // Compute checksum
    let checksum = '';
    try {
      const msgUint8 = new TextEncoder().encode(payloadString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      checksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback simple hash if subtle crypto is not available (e.g., non-https local dev)
      let hash = 0;
      for (let i = 0; i < payloadString.length; i++) {
        const char = payloadString.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      checksum = hash.toString(16);
    }

    const finalExport = {
      ...dataToExport,
      checksum,
    };

    const blob = new Blob([JSON.stringify(finalExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    a.download = `timetracker-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);

    if (currentSettings) {
      await updateSettings({ lastBackupDate: new Date().toISOString() });
    }
  };

  const importData = async (file: File, mode: 'merge' | 'replace') => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string;
          const parsed = JSON.parse(content);

          if (parsed.schemaVersion !== 1) {
            throw new Error('Unsupported schema version');
          }

          if (!parsed.checksum) {
            throw new Error('No checksum found in backup file');
          }

          const { checksum, ...dataToVerify } = parsed;
          const payloadString = JSON.stringify(dataToVerify);

          let expectedChecksum = '';
          try {
            const msgUint8 = new TextEncoder().encode(payloadString);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            expectedChecksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
          } catch {
            let hash = 0;
            for (let i = 0; i < payloadString.length; i++) {
              const char = payloadString.charCodeAt(i);
              hash = (hash << 5) - hash + char;
              hash = hash & hash;
            }
            expectedChecksum = hash.toString(16);
          }

          if (checksum !== expectedChecksum) {
            throw new Error('Data corruption detected: Checksum mismatch');
          }

          await db.importBackup(
            {
              groups: parsed.groups || [],
              timecodes: parsed.timecodes || [],
              entries: parsed.entries || [],
              settings: parsed.settings,
            },
            mode
          );
          await refreshData();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  return (
    <TimeTrackerContext.Provider value={{
      groups,
      timecodes,
      activeEntries,
      startTimer,
      stopTimer,
      pauseTimer,
      resumeTimer,
      addGroup,
      updateGroup,
      deleteGroup,
      addTimecode,
      updateTimecode,
      deleteTimecode,
      mergeTimecodes,
      updateActiveNote,
      refreshData,
      entries,
      updateEntry,
      deleteEntry,
      splitEntry,
      addManualEntry,
      forgotToStopEntry,
      dismissForgotToStop,
      settings,
      updateSettings,
      exportData,
      importData,
      lastStoppedEntry,
      undoStopTimer,
      clearLastStoppedEntry,
      deletedGroups,
      deletedTimecodes,
      deletedEntries,
      restoreGroup,
      restoreTimecode,
      restoreEntry,
      hardDeleteGroup,
      hardDeleteTimecode,
      hardDeleteEntry,
    }}>
      {children}
    </TimeTrackerContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTimeTracker = () => {
  const context = useContext(TimeTrackerContext);
  if (context === undefined) {
    throw new Error('useTimeTracker must be used within a TimeTrackerProvider');
  }
  return context;
};
