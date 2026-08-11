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
  refreshData: () => Promise<void>;
}

const TimeTrackerContext = createContext<TimeTrackerContextType | undefined>(undefined);

export const TimeTrackerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [timecodes, setTimecodes] = useState<Timecode[]>([]);
  const [activeEntry, setActiveEntry] = useState<Entry | null>(null);

  const refreshData = async () => {
    const loadedGroups = await db.getGroups();
    const loadedTimecodes = await db.getTimecodes();
    const loadedActiveEntry = await db.getActiveEntry();
    setGroups(loadedGroups);
    setTimecodes(loadedTimecodes);
    setActiveEntry(loadedActiveEntry || null);
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
      refreshData,
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
