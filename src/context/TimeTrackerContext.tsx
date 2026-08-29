import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Group, Timecode, Entry, Settings, PauseSegment } from '../types';
import * as db from '../db';
import { differenceInSeconds, isSameDay } from 'date-fns';
import { calculateDuration, findOverlappingCandidates } from '../utils/timeUtils';
import { clearErrorLog, logError } from '../utils/errorLog';
import { useToast } from './ToastContext';
import { validateBackupPayload, MAX_IMPORT_FILE_BYTES } from '../utils/importValidation';

interface TimeTrackerContextType {
  groups: Group[];
  timecodes: Timecode[];
  activeEntries: Entry[];
  startTimer: (timecodeId: string, note?: string, tags?: string[], expectedDurationMinutes?: number | null) => Promise<void>;
  stopTimer: (entryId: string) => Promise<void>;
  pauseTimer: (entryId: string, pauseStartTime?: string) => Promise<void>;
  resumeTimer: (entryId: string) => Promise<void>;
  addGroup: (name: string, color: string) => Promise<Group>;
  updateGroup: (id: string, updates: Partial<Group>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  addTimecode: (name: string, color?: string, groupId?: string, hourlyRate?: number, options?: { deferRefresh?: boolean }) => Promise<Timecode>;
  updateTimecode: (id: string, updates: Partial<Timecode>) => Promise<void>;
  deleteTimecode: (id: string) => Promise<void>;
  mergeTimecodes: (sourceId: string, destId: string) => Promise<void>;
  updateActiveNote: (entryId: string, note: string, tags?: string[]) => Promise<void>;
  refreshData: (options?: { broadcast?: boolean }) => Promise<void>;
  entries: Entry[];
  updateEntry: (id: string, updates: Partial<Entry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  bulkDeleteEntries: (ids: string[]) => Promise<void>;
  splitEntry: (entryId: string, splitTime: string, newTimecodeId?: string) => Promise<void>;
  addManualEntry: (entryData: { startTime: string; endTime: string; timecodeId: string; note: string; tags?: string[]; pausedSegments?: PauseSegment[]; manualAmount?: number | null }) => Promise<void>;
  bulkAddManualEntries: (entriesData: { startTime: string, endTime: string, timecodeId: string, note: string, tags?: string[] }[]) => Promise<{ added: number; skipped: number }>;
  forgotToStopEntry: Entry | null;
  dismissForgotToStop: () => void;
  settings: Settings | null;
  updateSettings: (updates: Partial<Settings>) => Promise<void>;
  exportData: (customFilename?: string) => Promise<void>;
  getBackupBlob: () => Promise<Blob>;
  importData: (file: File, mode: 'merge' | 'replace') => Promise<void>;
  wipeAllData: () => Promise<void>;
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

// A timer must have run at least this long overnight before we suspect it was
// left running, so working past midnight does not prompt every night.
const MIN_OVERNIGHT_FORGOT_HOURS = 5;

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
  // Mirrored in a ref so refreshData keeps a stable identity — depending on the
  // state made dismissing a prompt re-read the entire database.
  const dismissedForgotToStopIdsRef = useRef<string[]>(dismissedForgotToStopIds);
  useEffect(() => {
    dismissedForgotToStopIdsRef.current = dismissedForgotToStopIds;
  }, [dismissedForgotToStopIds]);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [lastStoppedEntry, setLastStoppedEntry] = useState<Entry | null>(null);

  const clearLastStoppedEntry = useCallback(() => {
    setLastStoppedEntry(null);
  }, []);

  const undoStopTimer = async (entryToUndo: Entry) => {
    if (!entryToUndo) return;

    // Re-read the stored record rather than trusting the pre-stop snapshot the
    // toast closed over: the entry may have been edited during the undo window.
    const current = await db.getEntry(entryToUndo.id);
    if (!current) {
      setLastStoppedEntry(null);
      return;
    }

    // Nothing to undo if it never stopped, and resurrecting it would wipe the
    // duration of an entry that is already finished.
    if (current.isRunning) {
      setLastStoppedEntry(null);
      return;
    }

    // Resurrecting the entry makes it running again, so it takes the timer
    // queue for the same reason startTimer does: checking for another running
    // timer and then writing this one has to be one indivisible step.
    const restored = await runExclusive(async () => {
      // Another timer may have been started inside the 5 second undo window.
      if (!(settings?.allowConcurrentTimers ?? false)) {
        const stillActive = await db.getActiveEntries();
        if (stillActive.length > 0) return false;
      }

      // Remove endTime and duration, set isRunning back to true
      const updatedEntry: Entry = {
        ...current,
        endTime: null,
        duration: 0,
        isRunning: true,
        updatedAt: new Date().toISOString(),
      };

      await db.putEntry(updatedEntry);
      return true;
    });

    if (!restored) {
      addToast('Cannot undo — another timer is already running', 'error');
    }
    setLastStoppedEntry(null);
    await refreshData();
  };

  /**
   * Stamp a record as changed now.
   *
   * Merge-mode import resolves conflicts by comparing `updatedAt`, so any write
   * that leaves the old stamp in place is silently reversible: importing a
   * backup taken before the change wins and undoes it. Trashing, restoring and
   * the cascades that null a `groupId` are all real changes and all go through
   * here.
   */
  const touch = <T extends { updatedAt: string }>(record: T, at: string = new Date().toISOString()): T =>
    ({ ...record, updatedAt: at });

  const isStartingTimerRef = useRef(false);
  const isPausingTimerRef = useRef(false);
  const isResumingTimerRef = useRef(false);

  /**
   * Serialises the mutations that decide how many timers are running.
   *
   * A plain "already stopping" boolean could only refuse a concurrent call, and
   * refusing is the wrong answer for `startTimer`: it would carry on and create
   * its entry while the stop it asked for was still in flight, leaving two
   * running timers with `allowConcurrentTimers` off. Queueing makes the second
   * caller wait for the first to finish instead of skipping past it.
   */
  const timerQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const runExclusive = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    // Run after the queued work whether it settled or threw, so one failed
    // mutation cannot wedge every later one.
    const result = timerQueueRef.current.then(task, task);
    // The queue itself must never hold a rejection, or the next `.then` would
    // skip straight to its rejection handler and surface as unhandled.
    timerQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const broadcastRef = useRef<BroadcastChannel | null>(null);

  /** Tell other open tabs that stored data changed and they should re-read. */
  const notifyOtherTabs = useCallback(() => {
    try {
      broadcastRef.current?.postMessage({ type: 'data-changed' });
    } catch {
      // A closed channel must never break a mutation.
    }
  }, []);

  /**
   * Replace one entry in the loaded state, for a mutation that changed only
   * that entry's own fields — not its start time, whether it is trashed, or
   * whether it is running. Nothing can move between lists or change position,
   * so this cannot drift from what a full reload would produce, and it saves
   * re-reading every entry from IndexedDB. The note autosave runs on a one
   * second debounce, so that read was happening every second while typing.
   *
   * Only safe for an entry already on screen as a running timer; anything
   * broader must go through refreshData.
   */
  const replaceEntryInState = useCallback((updated: Entry) => {
    const swap = (list: Entry[]) => {
      const index = list.findIndex((e) => e.id === updated.id);
      if (index === -1) return list;
      const next = [...list];
      next[index] = updated;
      return next;
    };
    setEntries(swap);
    setActiveEntries(swap);
    notifyOtherTabs();
  }, [notifyOtherTabs]);

  const refreshData = useCallback(async (options?: { broadcast?: boolean }) => {
    // Callers that pass through `.then(refreshData)` hand us a resolved value
    // rather than options, so only an explicit false suppresses the broadcast.
    const shouldBroadcast = !(options && typeof options === 'object' && options.broadcast === false);
    try {

      // Read the four stores concurrently rather than serially, and derive the
      // active entries from the list already in hand instead of re-reading every
      // entry a second time.
      const [loadedGroups, loadedTimecodes, loadedEntries, storedSettings] = await Promise.all([
        db.getGroups(),
        db.getTimecodes(),
        db.getEntries(),
        db.getSettings(),
      ]);
      const loadedActiveEntries = db.selectActiveEntries(loadedEntries);
      let loadedSettings = storedSettings;

      if (!loadedSettings) {
        loadedSettings = {
          id: 'user-settings',
          lastBackupDate: null,
          reminderIntervalDays: 7,
          roundingRule: 'none',
          roundingScope: 'day',
          idleThresholdMinutes: null,
          weeklyTargetHours: null,
          allowConcurrentTimers: false,
          overrunAudioAlertEnabled: true,
          theme: 'dark',
        };
        await db.putSettings(loadedSettings);
      }

      const liveGroups: Group[] = [];
      const trashedGroups: Group[] = [];
      for (const g of loadedGroups) (g.deletedAt ? trashedGroups : liveGroups).push(g);

      const liveTimecodes: Timecode[] = [];
      const trashedTimecodes: Timecode[] = [];
      for (const t of loadedTimecodes) (t.deletedAt ? trashedTimecodes : liveTimecodes).push(t);

      // getEntries returns ascending by start time from the index, so the list's
      // descending order is a reverse rather than a full re-sort.
      const liveEntries: Entry[] = [];
      const trashedEntries: Entry[] = [];
      for (let i = loadedEntries.length - 1; i >= 0; i--) {
        const e = loadedEntries[i];
        (e.deletedAt ? trashedEntries : liveEntries).push(e);
      }

      setGroups(liveGroups);
      setDeletedGroups(trashedGroups);
      setTimecodes(liveTimecodes);
      setDeletedTimecodes(trashedTimecodes);
      setEntries(liveEntries);
      setDeletedEntries(trashedEntries);
      setActiveEntries(loadedActiveEntries);
      setSettings(loadedSettings);

      // "Forgot-to-stop" Detection
      if (loadedActiveEntries.length > 0) {
        let foundForgot = false;
        for (const entry of loadedActiveEntries) {
          if (dismissedForgotToStopIdsRef.current.includes(entry.id)) continue;
          const start = new Date(entry.startTime);
          const now = new Date();
          const hoursElapsed = differenceInSeconds(now, start) / 3600;

          // getDate() is day-of-month, so a timer started at 23:50 tripped this
          // after 20 minutes. Require a real overnight run before prompting.
          const ranOvernight = !isSameDay(start, now) && hoursElapsed >= MIN_OVERNIGHT_FORGOT_HOURS;
          if (hoursElapsed > 10 || ranOvernight) {
            setForgotToStopEntry(entry);
            foundForgot = true;
            break;
          }
        }
        if (!foundForgot) setForgotToStopEntry(null);
      } else {
        setForgotToStopEntry(null);
      }

      // Tell other open tabs to re-read. IndexedDB is shared between them but
      // each tab holds its own React snapshot and writes whole records back, so
      // without this they drift apart and overwrite each other's work.
      if (shouldBroadcast) notifyOtherTabs();

      // Drop dismissals for timers that are no longer running, so the list does
      // not grow without bound in localStorage.
      const runningIds = new Set(loadedActiveEntries.map((e) => e.id));
      const stillRelevant = dismissedForgotToStopIdsRef.current.filter((id: string) => runningIds.has(id));
      if (stillRelevant.length !== dismissedForgotToStopIdsRef.current.length) {
        dismissedForgotToStopIdsRef.current = stillRelevant;
        setDismissedForgotToStopIds(stillRelevant);
        localStorage.setItem('dismissedForgotToStopIds', JSON.stringify(stillRelevant));
      }
    } catch (error) {
      // A failed read must never blank the UI. The database layer only enters
      // fallback mode when the connection itself is unusable, so an error here
      // is one bad operation: keep the last known good state on screen.
      logError(error as Error, 'refreshData');
      addToast('Could not re-read your data — showing the last loaded state.', 'error');
    }
  }, [addToast, notifyOtherTabs]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // A running timer keeps accruing after the tab closes, and the elapsed time
  // then includes however long the browser was shut. Warn before that happens.
  useEffect(() => {
    if (activeEntries.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore custom text but still require returnValue to be set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [activeEntries.length]);

  // Cross-tab sync: re-read on another tab's mutation, and whenever this tab
  // becomes visible again (covers browsers without BroadcastChannel).
  useEffect(() => {
    const reload = () => { refreshData({ broadcast: false }); };

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('timedoco');
      broadcastRef.current = channel;
      channel.onmessage = (event) => {
        if (event.data?.type === 'data-changed') reload();
      };
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (channel) {
        channel.onmessage = null;
        channel.close();
        if (broadcastRef.current === channel) broadcastRef.current = null;
      }
    };
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
          await Promise.all(timecodesToUpdate.map((tc) => db.putTimecode(touch({ ...tc, groupId: null }))));
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

  const startTimer = async (timecodeId: string, note: string = '', tags: string[] = [], expectedDurationMinutes: number | null = null) => {
    if (isStartingTimerRef.current) return;
    isStartingTimerRef.current = true;
    try {
      // The whole stop-then-create sequence holds the queue, so no other timer
      // mutation can slip between deciding what to stop and writing the new
      // entry. `performStop` is the unlocked body: calling `stopTimerById` here
      // would wait on a queue this call already owns.
      const started = await runExclusive(async () => {
        const isConcurrentAllowed = settings?.allowConcurrentTimers ?? false;
        const currentActive = await db.getActiveEntries();

        for (const entry of currentActive) {
          // With concurrency allowed only a duplicate on the same timecode is
          // stopped; otherwise every running timer is.
          if (!isConcurrentAllowed || entry.timecodeId === timecodeId) {
            await performStop(entry.id);
          }
        }

        if (!isConcurrentAllowed) {
          // Re-read rather than trusting the loop above: another tab shares this
          // database and does not share the queue, so it can have started a
          // timer while these stops were running.
          const stillActive = await db.getActiveEntries();
          if (stillActive.length > 0) return false;
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
          expectedDurationMinutes: expectedDurationMinutes ?? null,
        };
        await db.putEntry(newEntry);
        return true;
      });

      await refreshData();
      if (started) {
        addToast('Timer started', 'success');
      } else {
        addToast('Another timer is already running — stop it first', 'error');
      }
    } finally {
      isStartingTimerRef.current = false;
    }
  };

  /**
   * Stop one running timer. The caller must already hold the timer queue;
   * `stopTimerById` is the entry point that takes it.
   *
   * Returns whether this call actually stopped the timer, so callers do not
   * report success for an already-stopped no-op.
   */
  const performStop = async (entryId: string): Promise<boolean> => {
    const entry = await db.getEntry(entryId);
    if (!entry || !entry.isRunning) return false;
    const now = new Date();
    const endTimeIso = now.toISOString();

    // Close open pause segment if paused
    const newPausedSegments = [...entry.pausedSegments];
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
    return true;
  };

  const stopTimerById = (entryId: string): Promise<boolean> => runExclusive(() => performStop(entryId));

  const stopTimer = async (entryId: string) => {
    const entry = await db.getEntry(entryId);
    const didStop = await stopTimerById(entryId);
    // Only claim the timer stopped when it did — a concurrent stop makes
    // stopTimerById a no-op and the timer keeps running.
    if (didStop && entry) {
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
      replaceEntryInState(updatedEntry);
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
      replaceEntryInState(updatedEntry);
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
    replaceEntryInState(updatedEntry);
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
    const groupToUpdate = await db.getGroup(id);
    if (!groupToUpdate) return;
    const updatedGroup = {
      ...groupToUpdate,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    await db.putGroup(updatedGroup);
    await refreshData();
  };

  const deleteGroup = async (id: string) => {
    const group = await db.getGroup(id);
    const now = new Date().toISOString();

    // Cascade soft-delete to timecodes. Read from the database rather than the
    // React snapshot, which can be stale relative to another tab and would then
    // silently skip records this cascade is meant to cover.
    const [allTimecodes, allEntries] = await Promise.all([db.getTimecodes(), db.getEntries()]);
    const timecodesToDelete = allTimecodes.filter(tc => tc.groupId === id && !tc.deletedAt);
    for (const tc of timecodesToDelete) {
      await db.putTimecode(touch({ ...tc, deletedAt: now }, now));

      // Cascade soft-delete to entries for each timecode
      const entriesToDelete = allEntries.filter((e) => e.timecodeId === tc.id && !e.deletedAt);
      for (const entry of entriesToDelete) {
        if (entry.isRunning) {
          await stopTimerById(entry.id);
        }
        const latestEntry = await db.getEntry(entry.id) || entry;
        await db.putEntry(touch({ ...latestEntry, deletedAt: now }, now));
      }
    }

    if (group) {
      await db.putGroup(touch({ ...group, deletedAt: now }, now));

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
        await Promise.all(timecodesToUpdate.map((tc) => db.putTimecode(touch({ ...tc, groupId: null }))));
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
      await Promise.all(timecodesToUpdate.map((tc) => db.putTimecode(touch({ ...tc, groupId: null }))));
    }
    await db.deleteGroup(id);
    await refreshData();
  };

  const restoreGroupInternal = async (id: string) => {
    const group = await db.getGroup(id);
    if (group) {
      const deletedTime = group.deletedAt;
      group.deletedAt = undefined;
      await db.putGroup(touch(group));

      const allTimecodes = await db.getTimecodes();
      const tcsToRestore = allTimecodes.filter(tc => tc.groupId === id && tc.deletedAt === deletedTime);
      for (const tc of tcsToRestore) {
        await restoreTimecodeInternal(tc.id);
      }
    }
  };

  const restoreGroup = async (id: string) => {
    await restoreGroupInternal(id);
    await refreshData();
  };

  /**
   * @param options.deferRefresh skip the reload, for a caller creating several
   *   timecodes in a row. A CSV naming 50 new timecodes otherwise triggers 50
   *   complete reads of the database before a single entry is written; the
   *   caller reloads once when it is done.
   */
  const addTimecode = async (
    name: string,
    color?: string,
    groupId?: string,
    hourlyRate?: number,
    options?: { deferRefresh?: boolean },
  ): Promise<Timecode> => {
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
    if (!options?.deferRefresh) await refreshData();
    return newTimecode;
  };

  const updateTimecode = async (id: string, updates: Partial<Timecode>) => {
    const tcToUpdate = await db.getTimecode(id);
    if (!tcToUpdate) return;
    const updatedTimecode = {
      ...tcToUpdate,
      ...updates,
      updatedAt: new Date().toISOString()
    };
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
    let newPausedSegments = updates.pausedSegments !== undefined
      ? [...updates.pausedSegments]
      : [...entryToUpdate.pausedSegments];

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

  const addManualEntry = async (entryData: { startTime: string; endTime: string; timecodeId: string; note: string; tags?: string[]; pausedSegments?: PauseSegment[]; manualAmount?: number | null }) => {
    const now = new Date().toISOString();
    const pausedSegments = entryData.pausedSegments || [];
    const duration = calculateDuration(new Date(entryData.startTime), new Date(entryData.endTime), pausedSegments);

    const newEntry: Entry = {
      id: crypto.randomUUID(),
      timecodeId: entryData.timecodeId,
      startTime: entryData.startTime,
      endTime: entryData.endTime,
      duration,
      note: entryData.note,
      tags: entryData.tags || [],
      isRunning: false,
      isPaused: false,
      pausedSegments,
      manualAmount: entryData.manualAmount ?? null,
      editHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    await db.putEntry(newEntry);
    await refreshData();
  };

  const wipeAllData = async () => {
    await db.wipeAllData();
    // Everything the app has written to localStorage, in one place — the error
    // log holds messages, stack traces and context, so it must go too.
    localStorage.removeItem('backupReminderDismissed');
    localStorage.removeItem('dismissedForgotToStopIds');
    clearErrorLog();
    setDismissedForgotToStopIds([]);
    setForgotToStopEntry(null);
    setLastStoppedEntry(null);
    await refreshData();
  };

  const bulkAddManualEntries = async (entriesData: { startTime: string, endTime: string, timecodeId: string, note: string, tags?: string[] }[]) => {
    const now = new Date().toISOString();
    const wellFormed: Entry[] = [];
    let skipped = 0;

    for (const entryData of entriesData) {
      const start = new Date(entryData.startTime);
      const end = new Date(entryData.endTime);

      // Reversed or unparseable times previously produced a silent zero-length
      // entry that the single-entry path would have rejected outright.
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        skipped++;
        continue;
      }

      wellFormed.push({
        id: crypto.randomUUID(),
        timecodeId: entryData.timecodeId,
        startTime: entryData.startTime,
        endTime: entryData.endTime,
        // Same duration routine as every other write path.
        duration: calculateDuration(start, end, []),
        note: entryData.note,
        tags: entryData.tags || [],
        isRunning: false,
        isPaused: false,
        pausedSegments: [],
        editHistory: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    // Bulk import previously skipped the overlap check every single-entry path
    // performs, so a CSV could create overlapping entries the UI would refuse —
    // and overlapping entries double-count time on a report.
    const existing = await db.getEntries();
    const clashing = findOverlappingCandidates(
      wellFormed,
      existing,
      settings?.allowConcurrentTimers ?? false
    );
    const toInsert = wellFormed.filter((_, index) => !clashing.has(index));
    skipped += clashing.size;

    await Promise.all(toInsert.map((entry) => db.putEntry(entry)));
    await refreshData();
    return { added: toInsert.length, skipped };
  };


  const mergeTimecodes = async (sourceId: string, destId: string) => {
    const now = new Date().toISOString();
    // 1. Update all entries referencing sourceId to point to destId.
    // Read from the database, not component state: state excludes soft-deleted
    // entries, which would then be left pointing at a timecode this merge is
    // about to delete, and can be stale relative to another tab.
    const allEntries = await db.getEntries();
    const entriesToUpdate = allEntries.filter((e) => e.timecodeId === sourceId);
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
      const mergedAt = new Date().toISOString();
      await db.putTimecode(touch({ ...sourceTc, deletedAt: mergedAt }, mergedAt));
    }

    // 5. Refresh everything
    await refreshData();
  };

  const deleteTimecode = async (id: string) => {
    // Cascading: soft-delete all entries associated with this timecode.
    // Read from the database so a record created in another tab is not missed.
    const entriesToDelete = (await db.getEntries()).filter((e) => e.timecodeId === id && !e.deletedAt);
    const now = new Date().toISOString();
    for (const entry of entriesToDelete) {
      if (entry.isRunning) {
        await stopTimerById(entry.id);
      }
      // Re-fetch the entry in case it was updated by stopTimerById
      const latestEntry = await db.getEntry(entry.id) || entry;
      await db.putEntry(touch({ ...latestEntry, deletedAt: now }, now));
    }
    const tc = await db.getTimecode(id);
    if (tc) {
      await db.putTimecode(touch({ ...tc, deletedAt: now }, now));
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
           // Restore records directly rather than through restoreTimecode /
           // restoreEntry, each of which triggers its own full reload.
           const tcToRestore = await db.getTimecode(id);
           if (tcToRestore) {
             const { deletedAt: _tcDeleted, ...restoredTc } = tcToRestore;
             await db.putTimecode(touch(restoredTc as Timecode));
           }
           await Promise.all(entriesToDelete.map(async (entry) => {
             const latest = await db.getEntry(entry.id);
             if (!latest) return;
             const { deletedAt: _entryDeleted, ...restored } = latest;
             await db.putEntry(touch(restored as Entry));
           }));

           if (originalTemplates.length > 0) {
             const current = await db.getSettings();
             if (current) {
               // Merge rather than overwrite: a template added during the undo
               // window would otherwise be discarded by the restore.
               const merged = [...(current.templates || [])];
               for (const template of originalTemplates) {
                 if (!merged.some((t) => t.id === template.id)) merged.push(template);
               }
               await db.putSettings({ ...current, templates: merged });
             }
           }
           await refreshData();
        }
      }, 5000);
    }

    await refreshData();
  };

  const hardDeleteTimecode = async (id: string) => {
    // From the database: a permanent delete must not leave orphans behind
    // because the React snapshot was missing a record.
    const entriesToDelete = (await db.getEntries()).filter((e) => e.timecodeId === id);
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

  const restoreTimecodeInternal = async (id: string) => {
    const tc = await db.getTimecode(id);
    if (tc) {
      const deletedTime = tc.deletedAt;
      tc.deletedAt = undefined;
      await db.putTimecode(touch(tc));

      const allEntries = await db.getEntries();
      const entriesToRestore = allEntries.filter(e => e.timecodeId === id && e.deletedAt === deletedTime);
      for (const entry of entriesToRestore) {
        await restoreEntryInternal(entry.id);
      }
    }
  };

  const restoreTimecode = async (id: string) => {
    await restoreTimecodeInternal(id);
    await refreshData();
  };

  const updateSettings = async (updates: Partial<Settings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);

    // Read the latest settings from the DB to prevent clobbering fields saved by other tabs
    const currentSettings = await db.getSettings();
    if (currentSettings) {
      const mergedSettings = { ...currentSettings, ...updates };
      setSettings(mergedSettings);
      await db.putSettings(mergedSettings);
    } else {
      await db.putSettings(newSettings);
    }
    notifyOtherTabs();
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
      manualAmount: null,
      expectedDurationMinutes: null,
    };

    await db.putEntry(entry1);
    await db.putEntry(entry2);
    await refreshData();
  };

  const deleteEntry = async (id: string) => {
    const entry = await db.getEntry(id);
    if (entry) {
      const deletedAt = new Date().toISOString();
      await db.putEntry(touch({ ...entry, deletedAt }, deletedAt));
      addToast('Entry deleted', 'success', { label: 'Undo', onClick: () => restoreEntry(id) }, 5000);
      await refreshData();
    }
  };

  const bulkDeleteEntries = async (ids: string[]) => {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const targets = await Promise.all(ids.map((id) => db.getEntry(id)));
    await Promise.all(
      targets.filter((e): e is Entry => !!e).map((e) => db.putEntry(touch({ ...e, deletedAt: now }, now)))
    );
    addToast(
      `${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} deleted`,
      'success',
      { label: 'Undo', onClick: () => Promise.all(ids.map((id) => restoreEntryInternal(id))).then(() => refreshData()) },
      5000
    );
    await refreshData();
  };

  const hardDeleteEntry = async (id: string) => {
    await db.deleteEntry(id);
    await refreshData();
  };

  const restoreEntryInternal = async (id: string) => {
    const entry = await db.getEntry(id);
    if (entry) {
      entry.deletedAt = undefined;
      await db.putEntry(touch(entry));

      if (entry.timecodeId) {
        const tc = await db.getTimecode(entry.timecodeId);
        if (tc && tc.deletedAt) {
          tc.deletedAt = undefined;
          await db.putTimecode(touch(tc));
        }
      }
    }
  };

  const restoreEntry = async (id: string) => {
    await restoreEntryInternal(id);
    await refreshData();
  };

  const getBackupBlob = async (): Promise<Blob> => {
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

    if (currentSettings) {
      await updateSettings({ lastBackupDate: new Date().toISOString() });
    }

    return new Blob([JSON.stringify(finalExport, null, 2)], { type: 'application/json' });
  };

  const exportData = async (customFilename?: string) => {
    const blob = await getBackupBlob();
    const dateStr = new Date().toISOString().split('T')[0];
    const defaultName = `timedoco-backup-${dateStr}`;
    const cleanName = customFilename ? customFilename.replace(/[/\\:*?"<>|]/g, '').trim() : defaultName;
    const filename = cleanName.endsWith('.json') ? cleanName : `${cleanName}.json`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoking synchronously can cancel a large download in Firefox before
    // the browser has finished reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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

  /**
   * Merge mode decides whether to write each record by comparing updatedAt.
   * A missing or unparseable value compares false against everything, so the
   * record used to be skipped silently and an import of an older-format backup
   * could report success while importing nothing. Stamping a deterministic
   * epoch value keeps such records importable while ensuring they never
   * clobber newer local data.
   */
  const normalizeImportData = (data: any) => {
    const EPOCH = new Date(0).toISOString();
    const withTimestamp = (record: any) => {
      if (!record || typeof record !== 'object') return record;
      const value = record.updatedAt;
      const valid = typeof value === 'string' && value.trim() && !Number.isNaN(Date.parse(value));
      return valid ? record : { ...record, updatedAt: EPOCH };
    };

    return {
      ...data,
      groups: Array.isArray(data.groups) ? data.groups.map(withTimestamp) : data.groups,
      timecodes: Array.isArray(data.timecodes) ? data.timecodes.map(withTimestamp) : data.timecodes,
      entries: Array.isArray(data.entries) ? data.entries.map(withTimestamp) : data.entries,
    };
  };

  const importData = async (file: File, mode: 'merge' | 'replace') => {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error('Import failed: File size exceeds the 20MB limit.');
    }

    // file.text() rather than FileReader: a reader holds its own reference to
    // the decoded string for as long as it is alive, so the file text could not
    // be released after parsing. Here the local can be dropped, which matters
    // when the text, the parsed object and the re-serialised payload would
    // otherwise all be resident at once for a file up to 20MB.
    let content: string = await file.text();
    const parsed = JSON.parse(content);
    content = '';

    if (!parsed.checksum) {
      throw new Error('No checksum found in backup file');
    }

    const { checksum, ...dataToVerify } = parsed;
    let payloadString: string = JSON.stringify(dataToVerify);

    // Prefer SHA-256 always, and only fall back to the weak 32-bit hash
    // when the file actually declares it — a backup exported from a
    // context without crypto.subtle (plain-http dev, some embedded
    // browsers) legitimately carries one. Note the checksum is an
    // integrity check, not a security boundary: anyone crafting a
    // backup can compute a valid digest under either algorithm.
    let verified = false;
    let subtleAvailable = true;

    try {
      const msgUint8 = new TextEncoder().encode(payloadString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      verified = checksum === hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      subtleAvailable = false;
    }

    if (!verified && dataToVerify.checksumAlgorithm === 'fallback') {
      let hash = 0;
      for (let i = 0; i < payloadString.length; i++) {
        const char = payloadString.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      verified = checksum === hash.toString(16);
    }

    if (!verified) {
      if (!subtleAvailable && dataToVerify.checksumAlgorithm !== 'fallback') {
        throw new Error('Cannot verify SHA-256 backup checksum in this environment. Ensure you are on HTTPS.');
      }
      throw new Error(
        'Data corruption detected: Checksum mismatch. If you edited this backup by hand, re-export it from TimeDoco instead.'
      );
    }

    // The re-serialised payload is only needed for the checksum; drop it before
    // the write so it is not resident alongside the records being imported.
    payloadString = '';

    const migratedData = normalizeImportData(migrateImportData(parsed, parsed.schemaVersion));

    // In merge mode an entry may legitimately point at a timecode that is
    // already stored locally rather than carried in the file.
    const knownTimecodeIds = mode === 'merge'
      ? new Set((await db.getTimecodes()).map((tc) => tc.id))
      : undefined;

    // Validate what will actually be written, not the pre-migration input.
    validateBackupPayload(migratedData, knownTimecodeIds);

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
      bulkDeleteEntries,
      splitEntry,
      addManualEntry,
      bulkAddManualEntries,
      forgotToStopEntry,
      dismissForgotToStop,
      settings,
      updateSettings,
      exportData,
      getBackupBlob,
      importData,
      wipeAllData,
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
