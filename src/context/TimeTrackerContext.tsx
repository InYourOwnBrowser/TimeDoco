import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Group, Timecode, Entry, Settings } from '../types';
import * as db from '../db';
import { differenceInSeconds } from 'date-fns';

interface TimeTrackerContextType {
  groups: Group[];
  timecodes: Timecode[];
  activeEntry: Entry | null;
  startTimer: (timecodeId: string) => Promise<void>;
  stopTimer: () => Promise<void>;
  pauseTimer: () => Promise<void>;
  resumeTimer: () => Promise<void>;
  addGroup: (name: string, color: string) => Promise<Group>;
  addTimecode: (name: string, color?: string, groupId?: string) => Promise<Timecode>;
  updateActiveNote: (note: string) => Promise<void>;
  refreshData: () => Promise<void>;
  entries: Entry[];
  updateEntry: (id: string, updates: Partial<Entry>) => Promise<void>;
  addManualEntry: (entryData: { startTime: string, endTime: string, timecodeId: string, note: string }) => Promise<void>;
  forgotToStopEntry: Entry | null;
  dismissForgotToStop: () => void;
  settings: Settings | null;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  exportData: () => Promise<void>;
  importData: (file: File, mode: 'merge' | 'replace') => Promise<void>;
}

const TimeTrackerContext = createContext<TimeTrackerContextType | undefined>(undefined);

export const TimeTrackerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [timecodes, setTimecodes] = useState<Timecode[]>([]);
  const [activeEntry, setActiveEntry] = useState<Entry | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [forgotToStopEntry, setForgotToStopEntry] = useState<Entry | null>(null);
  const [dismissedForgotToStopId, setDismissedForgotToStopId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const refreshData = async () => {
    const loadedGroups = await db.getGroups();
    const loadedTimecodes = await db.getTimecodes();
    const loadedEntries = await db.getEntries();
    const loadedActiveEntry = await db.getActiveEntry();
    let loadedSettings = await db.getSettings();

    if (!loadedSettings) {
      loadedSettings = {
        id: 'user-settings',
        lastBackupDate: null,
        reminderIntervalDays: 7,
        roundingRule: 'none',
        idleThresholdMinutes: 15,
        weeklyTargetHours: null,
        encryptionEnabled: false,
      };
      await db.putSettings(loadedSettings);
    }

    setGroups(loadedGroups);
    setTimecodes(loadedTimecodes);
    // Sort entries descending by startTime for the list
    setEntries(loadedEntries.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()));
    setActiveEntry(loadedActiveEntry || null);
    setSettings(loadedSettings);

    // "Forgot-to-stop" Detection
    if (loadedActiveEntry && loadedActiveEntry.id !== dismissedForgotToStopId) {
      const start = new Date(loadedActiveEntry.startTime);
      const now = new Date();
      const hoursElapsed = differenceInSeconds(now, start) / 3600;

      if (hoursElapsed > 10 || (hoursElapsed > 0 && start.getDate() !== now.getDate())) {
        setForgotToStopEntry(loadedActiveEntry);
      } else {
        setForgotToStopEntry(null);
      }
    } else {
      setForgotToStopEntry(null);
    }
  };

  useEffect(() => {
    refreshData();
  }, []);

  const startTimer = async (timecodeId: string) => {
    if (activeEntry) {
      await stopTimer();
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
  };

  const stopTimer = async () => {
    if (!activeEntry) return;
    const now = new Date();
    const endTimeIso = now.toISOString();

    // Calculate total pause duration
    let totalPauseSeconds = 0;
    activeEntry.pausedSegments.forEach(segment => {
      const pStart = new Date(segment.pauseStart);
      const pEnd = segment.pauseEnd ? new Date(segment.pauseEnd) : now;
      totalPauseSeconds += differenceInSeconds(pEnd, pStart);
    });

    // Close open pause segment if paused
    let newPausedSegments = [...activeEntry.pausedSegments];
    if (activeEntry.isPaused && newPausedSegments.length > 0) {
      newPausedSegments[newPausedSegments.length - 1] = {
        ...newPausedSegments[newPausedSegments.length - 1],
        pauseEnd: endTimeIso,
      };
    }

    const start = new Date(activeEntry.startTime);
    let duration = differenceInSeconds(now, start) - totalPauseSeconds;
    if (duration < 0) duration = 0;

    const updatedEntry: Entry = {
      ...activeEntry,
      endTime: endTimeIso,
      duration,
      isRunning: false,
      isPaused: false,
      pausedSegments: newPausedSegments,
      updatedAt: endTimeIso,
    };
    await db.putEntry(updatedEntry);
    await refreshData();
  };

  const pauseTimer = async () => {
    if (!activeEntry || activeEntry.isPaused) return;
    const now = new Date().toISOString();
    const updatedEntry: Entry = {
      ...activeEntry,
      isPaused: true,
      pausedSegments: [...activeEntry.pausedSegments, { pauseStart: now }],
      updatedAt: now,
    };
    await db.putEntry(updatedEntry);
    await refreshData();
  };

  const resumeTimer = async () => {
    if (!activeEntry || !activeEntry.isPaused) return;
    const now = new Date().toISOString();
    const newPausedSegments = [...activeEntry.pausedSegments];
    if (newPausedSegments.length > 0) {
      newPausedSegments[newPausedSegments.length - 1] = {
        ...newPausedSegments[newPausedSegments.length - 1],
        pauseEnd: now,
      };
    }
    const updatedEntry: Entry = {
      ...activeEntry,
      isPaused: false,
      pausedSegments: newPausedSegments,
      updatedAt: now,
    };
    await db.putEntry(updatedEntry);
    await refreshData();
  };

  const updateActiveNote = async (note: string) => {
    if (!activeEntry) return;
    const now = new Date().toISOString();
    const updatedEntry: Entry = {
      ...activeEntry,
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

  const addTimecode = async (name: string, color?: string, groupId?: string): Promise<Timecode> => {
    const newTimecode: Timecode = {
      id: crypto.randomUUID(),
      name,
      groupId: groupId || null,
      color,
      hourlyRate: null,
      archived: false,
    };
    await db.putTimecode(newTimecode);
    await refreshData();
    return newTimecode;
  };

  const dismissForgotToStop = () => {
    if (forgotToStopEntry) {
      setDismissedForgotToStopId(forgotToStopEntry.id);
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

      let totalPauseSeconds = 0;
      newPausedSegments.forEach(segment => {
        const pStart = new Date(segment.pauseStart);
        const pEnd = segment.pauseEnd ? new Date(segment.pauseEnd) : new Date(finalEndTime);
        totalPauseSeconds += differenceInSeconds(pEnd, pStart);
      });

      const start = new Date(finalStartTime);
      const end = new Date(finalEndTime);
      newDuration = differenceInSeconds(end, start) - totalPauseSeconds;
      if (newDuration < 0) newDuration = 0;
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
      dismissForgotToStop();
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

  const updateSettings = async (updates: Partial<Settings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...updates };
    await db.putSettings(newSettings);
    await refreshData();
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
      activeEntry,
      startTimer,
      stopTimer,
      pauseTimer,
      resumeTimer,
      addGroup,
      addTimecode,
      updateActiveNote,
      refreshData,
      entries,
      updateEntry,
      addManualEntry,
      forgotToStopEntry,
      dismissForgotToStop,
      settings,
      updateSettings,
      exportData,
      importData,
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
