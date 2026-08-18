import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Group, Timecode, Entry, Settings } from '../types';
import * as db from '../db';
import { differenceInSeconds } from 'date-fns';
import { calculateDuration } from '../utils/timeUtils';
import { useToast } from './ToastContext';

interface TimeTrackerContextType {
  groups: Group[];
  timecodes: Timecode[];
  activeEntries: Entry[];
  startTimer: (timecodeId: string, note?: string, tags?: string[]) => Promise<void>;
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
  updateActiveNote: (entryId: string, note: string, tags?: string[]) => Promise<void>;
  refreshData: () => Promise<void>;
  entries: Entry[];
  updateEntry: (id: string, updates: Partial<Entry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  splitEntry: (entryId: string, splitTime: string, newTimecodeId?: string) => Promise<void>;
  addManualEntry: (entryData: { startTime: string, endTime: string, timecodeId: string, note: string, tags?: string[] }) => Promise<void>;
  bulkAddManualEntries: (entriesData: { startTime: string, endTime: string, timecodeId: string, note: string, tags?: string[] }[]) => Promise<void>;
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
  emptyTrash: () => Promise<void>;
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
  const [dismissedForgotToStopIds, setDismissedForgotToStopIds] = useState<string[]>(() => {
    const data = localStorage.getItem('dismissedForgotToStopIds');
    try { return data ? JSON.parse(data) : []; } catch { return []; }
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

  const isStartingTimerRef = useRef(false);
  const isStoppingTimerRef = useRef(false);
  const isPausingTimerRef = useRef(false);
  const isResumingTimerRef = useRef(false);

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
        idleThresholdMinutes: null,
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
        if (dismissedForgotToStopIds.includes(entry.id)) continue;
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
  }, [dismissedForgotToStopIds]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    const autoPurgeTrash = async () => {
      const now = Date.now();
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

      const loadedGroups = await db.getGroups();
      const loadedTimecodes = await db.getTimecodes();
      const loadedEntries = await db.getEntries();

      let purged = false;

      // Identify items deleted > 30 days ago
      const groupsToDelete = loadedGroups.filter(g => g.deletedAt && now - new Date(g.deletedAt).getTime() > THIRTY_DAYS_MS);
      const timecodesToDelete = loadedTimecodes.filter(t => t.deletedAt && now - new Date(t.deletedAt).getTime() > THIRTY_DAYS_MS);
      const entriesToDelete = loadedEntries.filter(e => e.deletedAt && now - new Date(e.deletedAt).getTime() > THIRTY_DAYS_MS);

      // We perform the deletion safely like emptyTrash does
      for (const group of groupsToDelete) {
        const timecodesToUpdate = [...loadedTimecodes].filter((tc) => tc.groupId === group.id);
        if (timecodesToUpdate.length > 0) {
          await Promise.all(timecodesToUpdate.map((tc) => db.putTimecode({ ...tc, groupId: null })));
        }
        await db.deleteGroup(group.id);
        purged = true;
      }

      for (const tc of timecodesToDelete) {
        const relatedEntries = [...loadedEntries].filter((e) => e.timecodeId === tc.id);
        if (relatedEntries.length > 0) {
          await Promise.all(relatedEntries.map((e) => db.deleteEntry(e.id)));
        }
        await db.deleteTimecode(tc.id);
        purged = true;
      }

      if (entriesToDelete.length > 0) {
        await Promise.all(
          entriesToDelete.map(async (entry) => {
            const exists = await db.getEntry(entry.id);
            if (exists) {
              await db.deleteEntry(entry.id);
            }
          })
        );
        purged = true;
      }

      if (purged) {
        await refreshData();
      }
    };

    autoPurgeTrash().catch(console.error);
  }, [refreshData]);

  const startTimer = async (timecodeId: string, note: string = '', tags: string[] = []) => {
    if (isStartingTimerRef.current) return;
    isStartingTimerRef.current = true;
    try {
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
        note,
        tags,
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
    } finally {
      isStartingTimerRef.current = false;
    }
  };

  const stopTimerById = async (entryId: string) => {
    if (isStoppingTimerRef.current) return;
    isStoppingTimerRef.current = true;
    try {
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
    } finally {
      isStoppingTimerRef.current = false;
    }
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
    if (isPausingTimerRef.current) return;
    isPausingTimerRef.current = true;
    try {
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
    } finally {
      isPausingTimerRef.current = false;
    }
  };

  const resumeTimer = async (entryId: string) => {
    if (isResumingTimerRef.current) return;
    isResumingTimerRef.current = true;
    try {
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
    } finally {
      isResumingTimerRef.current = false;
    }
  };

  const updateActiveNote = async (entryId: string, note: string, tags?: string[]) => {
    const entry = await db.getEntry(entryId);
    if (!entry || !entry.isRunning) return;
    const now = new Date().toISOString();
    const updatedEntry: Entry = {
      ...entry,
      note,
      ...(tags !== undefined ? { tags } : {}),
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
      updatedAt: new Date().toISOString(),
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
    const now = new Date().toISOString();

    // Cascade soft-delete to timecodes
    const timecodesToDelete = [...timecodes, ...deletedTimecodes].filter(tc => tc.groupId === id && !tc.deletedAt);
    for (const tc of timecodesToDelete) {
      await db.putTimecode({ ...tc, deletedAt: now });

      // Cascade soft-delete to entries for each timecode
      const entriesToDelete = [...entries, ...deletedEntries].filter((e) => e.timecodeId === tc.id && !e.deletedAt);
      for (const entry of entriesToDelete) {
        if (entry.isRunning) {
          await stopTimerById(entry.id);
        }
        const latestEntry = await db.getEntry(entry.id) || entry;
        await db.putEntry({ ...latestEntry, deletedAt: now });
      }
    }

    if (group) {
      await db.putGroup({ ...group, deletedAt: now });

      // Update templates to remove timecodes that were deleted
      const currentSettings = await db.getSettings();
      if (currentSettings && currentSettings.templates) {
        const deletedTimecodeIds = new Set(timecodesToDelete.map(t => t.id));
        const updatedTemplates = currentSettings.templates.filter(t => !deletedTimecodeIds.has(t.timecodeId));
        if (updatedTemplates.length !== currentSettings.templates.length) {
          await db.putSettings({ ...currentSettings, templates: updatedTemplates });
        }
      }

      addToast('Group deleted', 'success', { label: 'Undo', onClick: async () => {
        await restoreGroup(id);
        for (const tc of timecodesToDelete) {
          await restoreTimecode(tc.id);
        }
      } }, 5000);
    }
    await refreshData();
  };

  const emptyTrash = async () => {
    // Delete all soft-deleted groups, timecodes, and entries permanently
    // Order matters to avoid re-inserting timecodes during group cascade
    for (const group of deletedGroups) {
      // Cascading: set groupId to null for all timecodes in this group
      const timecodesToUpdate = [...timecodes, ...deletedTimecodes].filter((tc) => tc.groupId === group.id);
      if (timecodesToUpdate.length > 0) {
        await Promise.all(timecodesToUpdate.map((tc) => db.putTimecode({ ...tc, groupId: null })));
      }
      await db.deleteGroup(group.id);
    }
    for (const tc of deletedTimecodes) {
      // Hard deleting a timecode also requires hard deleting its associated entries
      const entriesToDelete = [...entries, ...deletedEntries].filter((e) => e.timecodeId === tc.id);
      if (entriesToDelete.length > 0) {
        await Promise.all(entriesToDelete.map((e) => db.deleteEntry(e.id)));
      }
      await db.deleteTimecode(tc.id);
    }
    if (deletedEntries.length > 0) {
      await Promise.all(deletedEntries.map((entry) => db.deleteEntry(entry.id)));
    }
    await refreshData();
  };

  const hardDeleteGroup = async (id: string) => {
    // Cascading: set groupId to null for all timecodes in this group
    const timecodesToUpdate = [...timecodes, ...deletedTimecodes].filter((tc) => tc.groupId === id);
    if (timecodesToUpdate.length > 0) {
      await Promise.all(timecodesToUpdate.map((tc) => db.putTimecode({ ...tc, groupId: null })));
    }
    await db.deleteGroup(id);
    await refreshData();
  };

  const restoreGroup = async (id: string) => {
    const group = await db.getGroup(id);
    if (group) {
      const deletedTime = group.deletedAt;
      group.deletedAt = undefined;
      await db.putGroup(group);

      const tcsToRestore = deletedTimecodes.filter(tc => tc.groupId === id && tc.deletedAt === deletedTime);
      for (const tc of tcsToRestore) {
        await restoreTimecode(tc.id);
      }
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
      updatedAt: new Date().toISOString(),
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
      const newDismissedIds = [...dismissedForgotToStopIds, id];
      setDismissedForgotToStopIds(newDismissedIds);
      localStorage.setItem('dismissedForgotToStopIds', JSON.stringify(newDismissedIds));
      setForgotToStopEntry(null);
    }
  };

  const updateEntry = async (id: string, updates: Partial<Entry>) => {
    const entryToUpdate = await db.getEntry(id);
    if (!entryToUpdate) return;

    const now = new Date().toISOString();
    const newEditHistory = [...entryToUpdate.editHistory];

    const fieldsToTrack: (keyof Entry)[] = ['startTime', 'endTime', 'timecodeId', 'note', 'tags'];
    fieldsToTrack.forEach(field => {
      if (updates[field] !== undefined && JSON.stringify(updates[field]) !== JSON.stringify(entryToUpdate[field])) {
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
      const newDismissedIds = dismissedForgotToStopIds.filter(dId => dId !== id);
      setDismissedForgotToStopIds(newDismissedIds);
      localStorage.setItem('dismissedForgotToStopIds', JSON.stringify(newDismissedIds));
    } else if (dismissedForgotToStopIds.includes(id) && updates.endTime) {
      // Clear it from storage if the user addresses it without the banner active
      const newDismissedIds = dismissedForgotToStopIds.filter(dId => dId !== id);
      setDismissedForgotToStopIds(newDismissedIds);
      localStorage.setItem('dismissedForgotToStopIds', JSON.stringify(newDismissedIds));
    }

    await refreshData();
  };

  const addManualEntry = async (entryData: { startTime: string, endTime: string, timecodeId: string, note: string, tags?: string[] }) => {
    const now = new Date().toISOString();
    const durationMs = new Date(entryData.endTime).getTime() - new Date(entryData.startTime).getTime();
    const duration = Math.max(0, Math.floor(durationMs / 1000));

    const newEntry: Entry = {
      id: crypto.randomUUID(),
      timecodeId: entryData.timecodeId,
      startTime: entryData.startTime,
      endTime: entryData.endTime,
      duration: duration > 0 ? duration : 0,
      note: entryData.note,
      tags: entryData.tags || [],
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

  const bulkAddManualEntries = async (entriesData: { startTime: string, endTime: string, timecodeId: string, note: string, tags?: string[] }[]) => {
    const now = new Date().toISOString();
    const promises = entriesData.map(entryData => {
      const durationMs = new Date(entryData.endTime).getTime() - new Date(entryData.startTime).getTime();
      const duration = Math.max(0, Math.floor(durationMs / 1000));
      const newEntry: Entry = {
        id: crypto.randomUUID(),
        timecodeId: entryData.timecodeId,
        startTime: entryData.startTime,
        endTime: entryData.endTime,
        duration: duration > 0 ? duration : 0,
        note: entryData.note,
        tags: entryData.tags || [],
        isRunning: false,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: now,
        updatedAt: now,
      };
      return db.putEntry(newEntry);
    });

    await Promise.all(promises);
    await refreshData();
  };


  const mergeTimecodes = async (sourceId: string, destId: string) => {
    const now = new Date().toISOString();
    // 1. Update all entries referencing sourceId to point to destId
    const entriesToUpdate = entries.filter((e) => e.timecodeId === sourceId);
    if (entriesToUpdate.length > 0) {
      await Promise.all(entriesToUpdate.map((entry) => db.putEntry({ ...entry, timecodeId: destId, updatedAt: now })));
    }

    // 2. Update active entries as well, if any are running on the source timecode
    const currentActive = await db.getActiveEntries();
    const activeToUpdate = currentActive.filter((entry) => entry.timecodeId === sourceId);
    if (activeToUpdate.length > 0) {
      await Promise.all(activeToUpdate.map((entry) => db.putEntry({ ...entry, timecodeId: destId, updatedAt: now })));
    }

    // 3. Update templates
    const currentSettings = await db.getSettings();
    if (currentSettings && currentSettings.templates) {
      const updatedTemplates = currentSettings.templates.map(t =>
        t.timecodeId === sourceId ? { ...t, timecodeId: destId } : t
      );
      await db.putSettings({ ...currentSettings, templates: updatedTemplates });
    }

    // 4. Soft delete the source timecode
    const sourceTc = await db.getTimecode(sourceId);
    if (sourceTc) {
      await db.putTimecode({ ...sourceTc, deletedAt: new Date().toISOString() });
    }

    // 5. Refresh everything
    await refreshData();
  };

  const deleteTimecode = async (id: string) => {
    // Cascading: soft-delete all entries associated with this timecode
    const entriesToDelete = [...entries, ...deletedEntries].filter((e) => e.timecodeId === id && !e.deletedAt);
    const now = new Date().toISOString();
    for (const entry of entriesToDelete) {
      if (entry.isRunning) {
        await stopTimerById(entry.id);
      }
      // Re-fetch the entry in case it was updated by stopTimerById
      const latestEntry = await db.getEntry(entry.id) || entry;
      await db.putEntry({ ...latestEntry, deletedAt: now });
    }
    const tc = await db.getTimecode(id);
    if (tc) {
      await db.putTimecode({ ...tc, deletedAt: now });
    }

    // Update templates
    const currentSettings = await db.getSettings();
    let originalTemplates: NonNullable<typeof currentSettings>['templates'] = [];
    if (currentSettings && currentSettings.templates) {
      originalTemplates = currentSettings.templates;
      const updatedTemplates = currentSettings.templates.filter(t => t.timecodeId !== id);
      if (updatedTemplates.length !== currentSettings.templates.length) {
        await db.putSettings({ ...currentSettings, templates: updatedTemplates });
      }
    }

    if (tc) {
      addToast('Timecode deleted', 'success', {
        label: 'Undo',
        onClick: async () => {
           await restoreTimecode(id);
           for (const entry of entriesToDelete) {
             await restoreEntry(entry.id);
           }
           if (originalTemplates.length > 0) {
             db.getSettings().then(s => {
               if (s) {
                 db.putSettings({ ...s, templates: originalTemplates }).then(refreshData);
               }
             });
           }
        }
      }, 5000);
    }

    await refreshData();
  };

  const hardDeleteTimecode = async (id: string) => {
    const entriesToDelete = [...entries, ...deletedEntries].filter((e) => e.timecodeId === id);
    if (entriesToDelete.length > 0) {
      await Promise.all(entriesToDelete.map((entry) => db.deleteEntry(entry.id)));
    }
    await db.deleteTimecode(id);

    // Update templates
    const currentSettings = await db.getSettings();
    if (currentSettings && currentSettings.templates) {
      const updatedTemplates = currentSettings.templates.filter(t => t.timecodeId !== id);
      if (updatedTemplates.length !== currentSettings.templates.length) {
        await db.putSettings({ ...currentSettings, templates: updatedTemplates });
      }
    }

    await refreshData();
  };

  const restoreTimecode = async (id: string) => {
    const tc = await db.getTimecode(id);
    if (tc) {
      const deletedTime = tc.deletedAt;
      tc.deletedAt = undefined;
      await db.putTimecode(tc);

      const entriesToRestore = deletedEntries.filter(e => e.timecodeId === id && e.deletedAt === deletedTime);
      for (const entry of entriesToRestore) {
        await restoreEntry(entry.id);
      }
    }
    await refreshData();
  };

  const updateSettings = async (updates: Partial<Settings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await db.putSettings(newSettings);
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
      addToast('Entry deleted', 'success', { label: 'Undo', onClick: () => restoreEntry(id) }, 5000);
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
      checksumAlgorithm: '',
    };

    let payloadString = '';

    // Compute checksum
    let checksum = '';
    try {
      dataToExport.checksumAlgorithm = 'sha-256';
      payloadString = JSON.stringify(dataToExport);
      const msgUint8 = new TextEncoder().encode(payloadString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      checksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback simple hash if subtle crypto is not available (e.g., non-https local dev)
      dataToExport.checksumAlgorithm = 'fallback';
      payloadString = JSON.stringify(dataToExport);
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
    a.download = `timedoco-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);

    if (currentSettings) {
      await updateSettings({ lastBackupDate: new Date().toISOString() });
    }
  };

  const migrateImportData = (data: any, fromVersion: number) => {
    let migratedData = { ...data };

    // Future migrations go here:
    // if (fromVersion === 1) {
    //   migratedData = migrateV1toV2(migratedData);
    //   fromVersion = 2;
    // }

    if (fromVersion !== 1) {
      throw new Error(`Unsupported schema version: ${fromVersion}. Cannot migrate.`);
    }

    return migratedData;
  };

  const importData = async (file: File, mode: 'merge' | 'replace') => {
    return new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string;
          const parsed = JSON.parse(content);

          if (!parsed.checksum) {
            throw new Error('No checksum found in backup file');
          }

          const { checksum, ...dataToVerify } = parsed;
          const payloadString = JSON.stringify(dataToVerify);

          let expectedChecksum = '';
          if (dataToVerify.checksumAlgorithm === 'fallback') {
            let hash = 0;
            for (let i = 0; i < payloadString.length; i++) {
              const char = payloadString.charCodeAt(i);
              hash = (hash << 5) - hash + char;
              hash = hash & hash;
            }
            expectedChecksum = hash.toString(16);
          } else {
            try {
              const msgUint8 = new TextEncoder().encode(payloadString);
              const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
              const hashArray = Array.from(new Uint8Array(hashBuffer));
              expectedChecksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
            } catch {
              throw new Error('Cannot verify SHA-256 backup checksum in this environment. Ensure you are on HTTPS.');
            }
          }

          if (checksum !== expectedChecksum) {
            throw new Error('Data corruption detected: Checksum mismatch');
          }

          const migratedData = migrateImportData(parsed, parsed.schemaVersion);

          await db.importBackup(
            {
              groups: migratedData.groups || [],
              timecodes: migratedData.timecodes || [],
              entries: migratedData.entries || [],
              settings: migratedData.settings,
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
      bulkAddManualEntries,
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
      emptyTrash,
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
