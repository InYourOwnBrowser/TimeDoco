import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { Group, Timecode, Entry } from '../types';
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
}

const TimeTrackerContext = createContext<TimeTrackerContextType | undefined>(undefined);

export const TimeTrackerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [timecodes, setTimecodes] = useState<Timecode[]>([]);
  const [activeEntry, setActiveEntry] = useState<Entry | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [forgotToStopEntry, setForgotToStopEntry] = useState<Entry | null>(null);
  const [dismissedForgotToStopId, setDismissedForgotToStopId] = useState<string | null>(null);

  const refreshData = async () => {
    const loadedGroups = await db.getGroups();
    const loadedTimecodes = await db.getTimecodes();
    const loadedEntries = await db.getEntries();
    const loadedActiveEntry = await db.getActiveEntry();

    setGroups(loadedGroups);
    setTimecodes(loadedTimecodes);
    // Sort entries descending by startTime for the list
    setEntries(loadedEntries.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()));
    setActiveEntry(loadedActiveEntry || null);

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
