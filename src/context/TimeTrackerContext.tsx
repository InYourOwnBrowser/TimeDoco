import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { Group, Timecode, Entry, Settings, PauseSegment, EditHistory, EntryTemplate } from '../types';
import * as db from '../db';
import { differenceInSeconds, isSameDay } from 'date-fns';
import { calculateDuration, findOverlappingCandidates } from '../utils/timeUtils';
import { clearErrorLog, logError } from '../utils/errorLog';
import { useToast } from './ToastContext';
import { requestPersistence } from '../utils/storagePersistence';
import {
  validateBackupPayload,
  verifyBackupFile,
  assertSupportedSchemaVersion,
  SUPPORTED_SCHEMA_VERSION,
  MAX_IMPORT_ENTRIES,
} from '../utils/importValidation';

/** Which half of a split keeps a flat fee. A fee is not a rate, so it cannot be divided by time. */
export type FeeAllocation = 'first' | 'second' | 'discard';

/**
 * splitEntry has several ways to decline (missing entry, still running, in the
 * trash, a split time outside the entry). Each used to be a silent no-op that
 * the caller could not tell from success.
 */
export type SplitEntryResult =
  | { ok: true; newEntryId: string; feeMoved: FeeAllocation | null; estimateSplit: boolean }
  | { ok: false; reason: string };

interface TimeTrackerContextType {
  groups: Group[];
  timecodes: Timecode[];
  activeEntries: Entry[];
  startTimer: (timecodeId: string, note?: string, tags?: string[], expectedDurationMinutes?: number | null) => Promise<void>;
  stopTimer: (entryId: string) => Promise<void>;
  pauseTimer: (entryId: string, pauseStartTime?: string) => Promise<void>;
  resumeTimer: (entryId: string) => Promise<void>;
  addGroup: (name: string, color: string) => Promise<Group>;
  /** Resolves to whether the change was stored. Gate any success message on it. */
  updateGroup: (id: string, updates: Partial<Group>) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  addTimecode: (name: string, color?: string, groupId?: string, hourlyRate?: number, options?: { deferRefresh?: boolean }) => Promise<Timecode>;
  /** Resolves to whether the change was stored. Gate any success message on it. */
  updateTimecode: (id: string, updates: Partial<Timecode>) => Promise<boolean>;
  deleteTimecode: (id: string) => Promise<boolean>;
  mergeTimecodes: (sourceId: string, destId: string) => Promise<boolean>;
  updateActiveNote: (entryId: string, note: string, tags?: string[]) => Promise<boolean>;
  refreshData: (options?: { broadcast?: boolean }) => Promise<void>;
  entries: Entry[];
  /** Resolves to whether the change was stored. Gate any success message on it. */
  updateEntry: (id: string, updates: Partial<Entry>) => Promise<boolean>;
  deleteEntry: (id: string) => Promise<void>;
  bulkDeleteEntries: (ids: string[]) => Promise<void>;
  splitEntry: (entryId: string, splitTime: string, newTimecodeId?: string, options?: { feeAllocation?: FeeAllocation }) => Promise<SplitEntryResult>;
  /** Resolves to whether the entry was stored. Gate any success message on it. */
  addManualEntry: (entryData: { startTime: string; endTime: string; timecodeId: string; note: string; tags?: string[]; pausedSegments?: PauseSegment[]; manualAmount?: number | null }) => Promise<boolean>;
  bulkAddManualEntries: (entriesData: { startTime: string, endTime: string, timecodeId: string, note: string, tags?: string[], manualAmount?: number | null }[]) => Promise<{ added: number; skipped: number }>;
  forgotToStopEntry: Entry | null;
  dismissForgotToStop: () => void;
  settings: Settings | null;
  /** Resolves to whether the change was stored. Gate any success message on it. */
  updateSettings: (updates: Partial<Settings>) => Promise<boolean>;
  /**
   * Put a deleted template back, merged against the templates as they stand now
   * rather than a snapshot taken before the delete.
   *
   * @param index where it sat in the list before it was removed, so undo puts
   *   it back where the user last saw it instead of at the end.
   */
  restoreTemplate: (template: EntryTemplate, index?: number) => Promise<boolean>;
  exportData: (customFilename?: string) => Promise<void>;
  getBackupBlob: () => Promise<Blob>;
  /** Stamp `lastBackupDate`. Call only once a backup has actually been saved. */
  markBackupSaved: () => Promise<void>;
  importData: (file: File, mode: 'merge' | 'replace') => Promise<void>;
  wipeAllData: () => Promise<void>;
  lastStoppedEntry: Entry | null;
  undoStopTimer: (entry: Entry) => Promise<void>;
clearLastStoppedEntry: () => void;
  deletedGroups: Group[];
  deletedTimecodes: Timecode[];
  deletedEntries: Entry[];
  restoreGroup: (id: string) => Promise<boolean>;
  restoreTimecode: (id: string) => Promise<boolean>;
  restoreEntry: (id: string) => Promise<boolean>;
  hardDeleteGroup: (id: string) => Promise<boolean>;
  hardDeleteTimecode: (id: string) => Promise<boolean>;
  hardDeleteEntry: (id: string) => Promise<boolean>;
  emptyTrash: () => Promise<boolean>;
}

// A timer must have run at least this long overnight before we suspect it was
// left running, so working past midnight does not prompt every night.
const MIN_OVERNIGHT_FORGOT_HOURS = 5;

const getLiveEntriesForTimecode = (timecodeId: string, entries: Entry[]): Entry[] =>
  entries.filter((e) => e.timecodeId === timecodeId && !e.deletedAt);

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
    //
    // Wrapped in `mutateValue` because this runs from a toast action, which
    // cannot await it: a failed write here was an unhandled rejection, so the
    // toast dismissed, the timer stayed stopped, and nothing told the user.
    // `null` means the write failed; `false` means another timer is running.
    const restored = await mutateValue('undo the stop', () => runExclusive(async () => {
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
    }));

    if (restored === false) {
      addToast('Cannot undo — another timer is already running', 'error');
    }
    // `null` already raised its own storage error toast inside `mutateValue`.
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

  /**
   * Serialises every mutation that reads a running entry and writes the whole
   * record back — starting, stopping, undoing a stop, pausing, resuming and the
   * note autosave.
   *
   * A plain "already stopping" boolean could only refuse a concurrent call, and
   * refusing is the wrong answer for `startTimer`: it would carry on and create
   * its entry while the stop it asked for was still in flight, leaving two
   * running timers with `allowConcurrentTimers` off. Queueing makes the second
   * caller wait for the first to finish instead of skipping past it.
   *
   * Per-call booleans could not do this job either: they reject a re-entrant
   * call from the same component but do nothing about two different callers
   * interleaving a read and a write. Taking the queue means each of these reads
   * the state the one before it left behind, so a note save can no longer write
   * a pre-stop copy of the entry back over a stop and resurrect the timer.
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

  /**
   * Turns a storage failure into something the user can act on.
   *
   * Running out of quota is the one case with an obvious remedy, and it is also
   * the one most likely to hit a long-running local-first database, so it gets
   * its own message rather than a generic "could not save".
   */
  const describeStorageError = (error: unknown, action: string): string => {
    const name = (error as { name?: string } | null)?.name;
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (name === 'QuotaExceededError' || /quota/i.test(message)) {
      return `Could not ${action}: this browser is out of storage for TimeDoco. Export a backup from Settings, then clear the trash or remove old entries to free space.`;
    }
    if (error instanceof Error && !name?.includes('Database') && !name?.includes('IndexedDB') && !(error instanceof DOMException)) {
      return message;
    }
    return `Could not ${action}. Your change was not saved.`;
  };

  /**
   * Wraps a storage mutation so a failed write is reported rather than becoming
   * an unhandled rejection behind a success toast.
   *
   * `withDB` deliberately rethrows single-operation errors — a rejected put, an
   * aborted transaction, a Safari private-mode rejection — because one bad
   * record must not flip the whole app into an empty in-memory store. That is
   * correct, but almost nothing caught what it threw, so a failed write left the
   * UI showing state that was never persisted.
   *
   * Returns whether the write went through. Callers must gate their success
   * toast on that: a toast fired before the write resolves reports success for
   * something that may never have been stored.
   */
  const mutateValue = useCallback(
    async <T,>(action: string, operation: () => Promise<T>): Promise<T | null> => {
      try {
        return await operation();
      } catch (error) {
        logError(error as Error, `mutate:${action}`);
        addToast(describeStorageError(error, action), 'error', undefined, 8000);
        return null;
      }
    },
    // addToast is stable; describeStorageError is a pure local helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addToast]
  );

  /**
   * Reports a failed write and rethrows it.
   *
   * For a mutation whose caller is waiting on a record it will go on to use:
   * absorbing the error there would hand back an object that was never stored.
   * The user is told either way, and the caller's own handling still runs.
   */
  const reportAndRethrow = useCallback(
    async (action: string, operation: () => Promise<unknown>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        logError(error as Error, `mutate:${action}`);
        addToast(describeStorageError(error, action), 'error', undefined, 8000);
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addToast]
  );

  /** `mutateValue` for a mutation with no result; resolves to whether it was stored. */
  const mutate = useCallback(
    async (action: string, operation: () => Promise<void>): Promise<boolean> =>
      (await mutateValue(action, async () => {
        await operation();
        return true as const;
      })) === true,
    [mutateValue]
  );

  /**
   * Wraps a cascade in `mutate` without restructuring it.
   *
   * The trash and delete cascades issue many writes across several stores; any
   * of them can fail. Guarding at the boundary catches the whole sequence in
   * one place and keeps the public signature, rather than threading a result
   * through code whose shape is about the cascade, not about error handling.
   * A partial cascade is still partial — the toast says the change did not go
   * through, and the reload that follows shows what actually landed.
   *
   * Resolves to whether the whole sequence went through, so a caller that needs
   * to know — the CSV import's timecode rollback, which reported a cleanup it
   * had no way of confirming — can check instead of assuming.
   */
  const guarded = useCallback(
    <A extends unknown[]>(action: string, fn: (...args: A) => Promise<unknown>) =>
      async (...args: A): Promise<boolean> =>
        mutate(action, async () => { await fn(...args); }),
    [mutate]
  );

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
    // Re-request persistence on load if previously granted, to survive Safari session resets
    if (typeof localStorage !== 'undefined' && localStorage.getItem('persistenceGranted') === 'true') {
      requestPersistence().catch(() => {});
    }
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
      const currentSettings = await db.getSettings();

      let purged = false;
      const purgedTimecodeIds = new Set<string>();
      let purgedEntryCount = 0;

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
        if (getLiveEntriesForTimecode(tc.id, loadedEntries).length > 0) {
          continue;
        }
        const relatedDeletedEntries = [...loadedEntries].filter((e) => e.timecodeId === tc.id && e.deletedAt);
        if (relatedDeletedEntries.length > 0) {
          await Promise.all(relatedDeletedEntries.map((e) => db.deleteEntry(e.id)));
          purgedEntryCount += relatedDeletedEntries.length;
        }
        await db.deleteTimecode(tc.id);
        purgedTimecodeIds.add(tc.id);
        purged = true;
      }

      // Templates must go with the timecodes they point at. Left behind, they
      // reference a hard-deleted id, and validateBackupPayload rejects the
      // user's own backup on re-import ("template ... refers to timecode ...
      // which is not in this backup").
      if (currentSettings?.templates && purgedTimecodeIds.size > 0) {
        const updatedTemplates = currentSettings.templates.filter((t) => !purgedTimecodeIds.has(t.timecodeId));
        if (updatedTemplates.length !== currentSettings.templates.length) {
          await db.putSettings({ ...currentSettings, templates: updatedTemplates });
        }
      }

      if (entriesToDelete.length > 0) {
        const removed = await Promise.all(
          entriesToDelete.map(async (entry) => {
            const exists = await db.getEntry(entry.id);
            if (exists) {
              await db.deleteEntry(entry.id);
              return 1;
            }
            return 0;
          })
        );
        purgedEntryCount += removed.reduce((a: number, b: number) => a + b, 0);
        purged = true;
      }

      if (purged) {
        await refreshData();
        // The purge is unprompted and irreversible, so say what it took. A
        // silent 30-day cleanup is indistinguishable from data going missing.
        const parts: string[] = [];
        if (purgedEntryCount > 0) parts.push(`${purgedEntryCount} ${purgedEntryCount === 1 ? 'entry' : 'entries'}`);
        if (purgedTimecodeIds.size > 0) parts.push(`${purgedTimecodeIds.size} ${purgedTimecodeIds.size === 1 ? 'timecode' : 'timecodes'}`);
        if (groupsToDelete.length > 0) parts.push(`${groupsToDelete.length} ${groupsToDelete.length === 1 ? 'group' : 'groups'}`);
        if (parts.length > 0) {
          addToast(`Trash auto-cleanup removed ${parts.join(', ')} deleted over 30 days ago.`, 'info');
        }
      }
    };

    autoPurgeTrash().catch((error) => {
      // A partial purge leaves the trash half-emptied; without this the user
      // sees neither the cleanup nor the reason it stopped.
      logError(error as Error, 'autoPurgeTrash');
      addToast('Trash auto-cleanup did not finish. Some deleted items remain.', 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshData]);

  const startTimer = async (timecodeId: string, note: string = '', tags: string[] = [], expectedDurationMinutes: number | null = null) => {
    if (isStartingTimerRef.current) return;
    isStartingTimerRef.current = true;
    try {
      // The whole stop-then-create sequence holds the queue, so no other timer
      // mutation can slip between deciding what to stop and writing the new
      // entry. `performStop` is the unlocked body: calling `stopTimerById` here
      // would wait on a queue this call already owns.
      const started = await mutateValue('start the timer', () => runExclusive(async () => {
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
      }));

      await refreshData();
      if (started === null) return; // the write failed and has been reported
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
    // The pre-stop snapshot is read inside the queue, so it is the entry as it
    // actually stood when the stop ran: a note save queued ahead of this one has
    // already been applied and is part of what the undo would restore.
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('persistenceAttempted')) {
      localStorage.setItem('persistenceAttempted', 'true');
      requestPersistence().catch(() => {});
    }

    const stopped = await mutateValue('stop the timer', () => runExclusive(async () => {
      const entry = await db.getEntry(entryId);
      const didStop = await performStop(entryId);
      // Only claim the timer stopped when it did — a concurrent stop makes
      // performStop a no-op and there is nothing to offer an undo for.
      return didStop ? entry : null;
    }));

    if (stopped) {
      setLastStoppedEntry(stopped);
      addToast('Timer stopped', 'success', { label: 'Undo', onClick: () => undoStopTimer(stopped) }, 5000);
    }
    await refreshData();
  };

  const pauseTimer = async (entryId: string, pauseStartTime?: string) => {
    // Takes the timer queue for the same reason stopping does: this reads the
    // whole entry and writes the whole entry back, so a stop that lands between
    // the read and the write would be overwritten by the pre-stop copy.
    const updatedEntry = await mutateValue('pause the timer', () => runExclusive(async () => {
      const entry = await db.getEntry(entryId);
      if (!entry || !entry.isRunning || entry.isPaused) return null;
      const now = new Date().toISOString();
      const startOfPause = pauseStartTime || now;
      const paused: Entry = {
        ...entry,
        isPaused: true,
        pausedSegments: [...entry.pausedSegments, { pauseStart: startOfPause }],
        updatedAt: now,
      };
      await db.putEntry(paused);
      return paused;
    }));

    if (!updatedEntry) return;
    replaceEntryInState(updatedEntry);
    addToast('Timer paused', 'info');
  };

  const resumeTimer = async (entryId: string) => {
    const updatedEntry = await mutateValue('resume the timer', () => runExclusive(async () => {
      const entry = await db.getEntry(entryId);
      if (!entry || !entry.isRunning || !entry.isPaused) return null;
      const now = new Date().toISOString();
      const newPausedSegments = [...entry.pausedSegments];
      if (newPausedSegments.length > 0) {
        newPausedSegments[newPausedSegments.length - 1] = {
          ...newPausedSegments[newPausedSegments.length - 1],
          pauseEnd: now,
        };
      }
      const resumed: Entry = {
        ...entry,
        isPaused: false,
        pausedSegments: newPausedSegments,
        updatedAt: now,
      };
      await db.putEntry(resumed);
      return resumed;
    }));

    if (!updatedEntry) return;
    replaceEntryInState(updatedEntry);
    addToast('Timer resumed', 'success');
  };

  const updateActiveNote = async (entryId: string, note: string, tags?: string[]) => {
    // The autosave writes the whole entry back on a one second debounce while
    // the user types, and stopping the timer fires one last save immediately
    // before the stop. Outside the queue the "still running" check runs against
    // a read taken before the stop, and the write that follows resurrects the
    // timer with endTime null and the duration erased.
    const updatedEntry = await mutateValue('save the note', () => runExclusive(async () => {
      const entry = await db.getEntry(entryId);
      if (!entry || !entry.isRunning) return null;
      const now = new Date().toISOString();
      const withNote: Entry = {
        ...entry,
        note,
        ...(tags !== undefined ? { tags } : {}),
        updatedAt: now,
      };
      await db.putEntry(withNote);
      return withNote;
    }));

    if (updatedEntry) replaceEntryInState(updatedEntry);
  };

  const addGroup = async (name: string, color: string): Promise<Group> => {
    const newGroup: Group = {
      id: crypto.randomUUID(),
      name,
      color,
      archived: false,
      updatedAt: new Date().toISOString(),
    };
    // Creators report and rethrow rather than absorbing: the caller is waiting
    // for a record it will act on, and handing back one that was never stored
    // would be worse than the failure.
    await reportAndRethrow('create the group', () => db.putGroup(newGroup));
    await refreshData();
    return newGroup;
  };

  const updateGroup = async (id: string, updates: Partial<Group>): Promise<boolean> => {
    const groupToUpdate = await db.getGroup(id);
    if (!groupToUpdate) return false;
    const updatedGroup = {
      ...groupToUpdate,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    if (!(await mutate('save the group', () => db.putGroup(updatedGroup).then(() => undefined)))) return false;
    await refreshData();
    return true;
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

      // Templates belonging to these timecodes are deliberately left alone. A
      // soft delete is reversible from the toast and from the Trash days later,
      // and stripping the templates here made one class of the user's data
      // unrecoverable on both paths. They are hidden while their timecode is in
      // the trash — see TemplateList — and only purged for good alongside it in
      // `hardDeleteTimecode`, `emptyTrash` and `autoPurgeTrash`.

      addToast('Group deleted', 'success', { label: 'Undo', onClick: async () => {
        await restoreGroup(id);
      } }, 5000);
    }
    await refreshData();
  };

  const emptyTrash = async () => {
    // Delete all soft-deleted groups, timecodes, and entries permanently.
    // Read directly from the database rather than React state to avoid staleness across tabs.
    const [allGroups, allTimecodes, allEntries, currentSettings] = await Promise.all([
      db.getGroups(),
      db.getTimecodes(),
      db.getEntries(),
      db.getSettings(),
    ]);

    const deletedGroupsInDb = allGroups.filter((g) => g.deletedAt);
    for (const group of deletedGroupsInDb) {
      const timecodesToUpdate = allTimecodes.filter((tc) => tc.groupId === group.id);
      if (timecodesToUpdate.length > 0) {
        await Promise.all(timecodesToUpdate.map((tc) => db.putTimecode(touch({ ...tc, groupId: null }))));
      }
      await db.deleteGroup(group.id);
    }

    const deletedTimecodesInDb = allTimecodes.filter((tc) => tc.deletedAt);
    const removedTimecodeIds = new Set<string>();

    for (const tc of deletedTimecodesInDb) {
      // Check if there are live (non-deleted) entries referencing this trashed timecode.
      // If a user restored an entry without restoring its timecode, purging the timecode would destroy live entries.
      if (getLiveEntriesForTimecode(tc.id, allEntries).length > 0) {
        // Skip purging this timecode to protect live entries
        continue;
      }

      const entriesToDelete = allEntries.filter((e) => e.timecodeId === tc.id && e.deletedAt);
      if (entriesToDelete.length > 0) {
        await Promise.all(entriesToDelete.map((e) => db.deleteEntry(e.id)));
      }
      await db.deleteTimecode(tc.id);
      removedTimecodeIds.add(tc.id);
    }

    if (currentSettings && currentSettings.templates && removedTimecodeIds.size > 0) {
      const updatedTemplates = currentSettings.templates.filter((t) => !removedTimecodeIds.has(t.timecodeId));
      if (updatedTemplates.length !== currentSettings.templates.length) {
        await db.putSettings({ ...currentSettings, templates: updatedTemplates });
      }
    }

    const deletedEntriesInDb = allEntries.filter((e) => e.deletedAt);
    if (deletedEntriesInDb.length > 0) {
      await Promise.all(deletedEntriesInDb.map((entry) => db.deleteEntry(entry.id)));
    }

    await refreshData();
  };

  const hardDeleteGroup = async (id: string) => {
    // Cascading: set groupId to null for all timecodes in this group.
    // Read from the database rather than React snapshot to avoid staleness across tabs.
    const allTimecodes = await db.getTimecodes();
    const timecodesToUpdate = allTimecodes.filter((tc) => tc.groupId === id);
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
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('persistenceAttempted')) {
      localStorage.setItem('persistenceAttempted', 'true');
      requestPersistence().catch(() => {});
    }
    const newTimecode: Timecode = {
      id: crypto.randomUUID(),
      name,
      groupId: groupId || null,
      color,
      hourlyRate: hourlyRate ?? null,
      archived: false,
      updatedAt: new Date().toISOString(),
    };
    await reportAndRethrow('create the timecode', () => db.putTimecode(newTimecode));
    if (!options?.deferRefresh) await refreshData();
    return newTimecode;
  };

  const updateTimecode = async (id: string, updates: Partial<Timecode>): Promise<boolean> => {
    const tcToUpdate = await db.getTimecode(id);
    if (!tcToUpdate) return false;
    const updatedTimecode = {
      ...tcToUpdate,
      ...updates,
      updatedAt: new Date().toISOString()
    };
    if (!(await mutate('save the timecode', () => db.putTimecode(updatedTimecode).then(() => undefined)))) return false;
    await refreshData();
    return true;
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

  /**
   * Read-modify-write of a whole entry record, so it takes the timer queue.
   *
   * `ForgotToStopPrompt` and `EntryEditModal` both edit entries that may still
   * be running. Without the queue a stop, or the one-second note autosave,
   * landing between the read below and the write at the end of this function is
   * silently overwritten by the pre-edit copy — the same lost-update race the
   * queue was built to close for the other whole-record writers.
   *
   * Resolves to whether the change was stored; callers must gate their success
   * message on it.
   */
  const updateEntry = async (id: string, updates: Partial<Entry>): Promise<boolean> => {
    const applied = await mutateValue('save the entry', () => runExclusive(async () => {
      const entryToUpdate = await db.getEntry(id);
      if (!entryToUpdate) return false;

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
      return true;
    }));

    // Bail before the follow-on state changes: clearing the forgot-to-stop
    // banner for an edit that was never stored would hide a timer that is still
    // wrong. `applied` is null when the write failed and false when the entry
    // no longer exists; neither is something to report as saved.
    if (applied !== true) return false;

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
    return true;
  };

  /** Resolves to whether the entry was stored; gate any success message on it. */
  const addManualEntry = async (entryData: { startTime: string; endTime: string; timecodeId: string; note: string; tags?: string[]; pausedSegments?: PauseSegment[]; manualAmount?: number | null }): Promise<boolean> => {
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

    if (!(await mutate('save the entry', () => db.putEntry(newEntry).then(() => undefined)))) return false;
    await refreshData();
    return true;
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

  const bulkAddManualEntries = async (entriesData: { startTime: string, endTime: string, timecodeId: string, note: string, tags?: string[], manualAmount?: number | null }[]) => {
    if (entriesData.length > MAX_IMPORT_ENTRIES) {
      throw new Error(`Cannot import more than ${MAX_IMPORT_ENTRIES} entries at once.`);
    }

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
        manualAmount: entryData.manualAmount ?? null,
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

    const CHUNK_SIZE = 2000;
    let totalAdded = 0;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      try {
        await db.putEntries(chunk);
        totalAdded += chunk.length;
      } catch (error) {
        if (totalAdded > 0) {
          throw new Error(`Import failed after committing ${totalAdded} entries: ${error instanceof Error ? error.message : String(error)}`);
        }
        throw error;
      }
    }
    await refreshData();
    return { added: totalAdded, skipped };
  };


  const mergeTimecodes = async (sourceId: string, destId: string): Promise<boolean> => {
    if (!sourceId || !destId || sourceId === destId) return false;

    const allEntries = await db.getEntries();
    const currentActive = await db.getActiveEntries();

    // Prevent merging if both source and destination have running timers
    const activeOnSource = currentActive.filter((e) => e.timecodeId === sourceId && !e.deletedAt);
    const activeOnDest = currentActive.filter((e) => e.timecodeId === destId && !e.deletedAt);
    if (activeOnSource.length > 0 && activeOnDest.length > 0) {
      throw new Error('Cannot merge timecodes: multiple running timers would exist on the same timecode');
    }

    // Collect all non-deleted entries that will end up on destId
    const targetEntries = [
      ...allEntries.filter((e) => (e.timecodeId === destId || e.timecodeId === sourceId) && !e.deletedAt),
      ...currentActive.filter((e) => (e.timecodeId === destId || e.timecodeId === sourceId) && !e.deletedAt),
    ];
    const uniqueTargets = Array.from(new Map(targetEntries.map((e) => [e.id, e])).values());

    const now = Date.now();
    const intervals = uniqueTargets.map((e) => ({
      id: e.id,
      start: new Date(e.startTime).getTime(),
      end: e.endTime ? new Date(e.endTime).getTime() : now,
    })).filter((inv) => Number.isFinite(inv.start) && Number.isFinite(inv.end));

    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        if (intervals[i].start < intervals[j].end && intervals[i].end > intervals[j].start) {
          throw new Error('Cannot merge timecodes: resulting entries would overlap');
        }
      }
    }

    const isoNow = new Date().toISOString();
    // 1. Update all entries referencing sourceId to point to destId in one transaction.
    // Read from the database, not component state: state excludes soft-deleted
    // entries, which would then be left pointing at a timecode this merge is
    // about to delete, and can be stale relative to another tab.
    const entriesToUpdate = allEntries.filter((e) => e.timecodeId === sourceId);
    const activeToUpdate = currentActive.filter((entry) => entry.timecodeId === sourceId);

    const combinedEntriesMap = new Map<string, Entry>();
    for (const e of entriesToUpdate) {
      combinedEntriesMap.set(e.id, { ...e, timecodeId: destId, updatedAt: isoNow });
    }
    for (const e of activeToUpdate) {
      combinedEntriesMap.set(e.id, { ...e, timecodeId: destId, updatedAt: isoNow });
    }
    const entriesToPut = Array.from(combinedEntriesMap.values());
    if (entriesToPut.length > 0) {
      await db.putEntries(entriesToPut);
    }

    // 2. Update templates
    const currentSettings = await db.getSettings();
    if (currentSettings && currentSettings.templates) {
      const updatedTemplates = currentSettings.templates.map(t =>
        t.timecodeId === sourceId ? { ...t, timecodeId: destId } : t
      );
      await db.putSettings({ ...currentSettings, templates: updatedTemplates });
    }

    // 3. Soft delete the source timecode
    const sourceTc = await db.getTimecode(sourceId);
    if (sourceTc) {
      const mergedAt = new Date().toISOString();
      await db.putTimecode(touch({ ...sourceTc, deletedAt: mergedAt }, mergedAt));
    }

    // 4. Refresh everything
    await refreshData();
    return true;
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

    // Templates pointing at this timecode are left in place. A soft delete is
    // reversible — from the toast now, or from the Trash days later — and
    // deleting them here made them recoverable only inside the five second undo
    // window. They stop appearing while the timecode is in the trash (see
    // TemplateList) and are purged with it in `hardDeleteTimecode`,
    // `emptyTrash` and `autoPurgeTrash`.

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

           // Nothing to do for templates: the delete left them in place, so
           // restoring the timecode is enough to bring them back into view.
           await refreshData();
        }
      }, 5000);
    }

    await refreshData();
  };

  const hardDeleteTimecode = async (id: string) => {
    // From the database: a permanent delete must not leave orphans behind
    // because the React snapshot was missing a record.
    const allEntries = await db.getEntries();
    const liveEntries = getLiveEntriesForTimecode(id, allEntries);
    if (liveEntries.length > 0) {
      const count = liveEntries.length;
      const msg = `This timecode still has ${count} ${count === 1 ? 'entry' : 'entries'} that ${count === 1 ? 'is' : 'are'} not in the trash. Deleting it will destroy ${count === 1 ? 'it' : 'them'} permanently.`;
      if (typeof window !== 'undefined' && window.confirm && !window.confirm(msg)) {
        return false;
      }
    }

    const entriesToDelete = allEntries.filter((e) => e.timecodeId === id);
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

  const restoreTimecodeInternal = async (id: string, skipOverlapCheck = false) => {
    const tc = await db.getTimecode(id);
    if (tc) {
      const deletedTime = tc.deletedAt;
      const allEntries = await db.getEntries();
      const entriesToRestore = allEntries.filter(e => e.timecodeId === id && e.deletedAt === deletedTime);

      if (!skipOverlapCheck && entriesToRestore.length > 0) {
        const liveEntries = allEntries.filter(e => !e.deletedAt);
        const rejected = findOverlappingCandidates(entriesToRestore, liveEntries, settings?.allowConcurrentTimers);
        if (rejected.size > 0) {
          throw new Error('Cannot restore timecode: entries overlap with existing live entries.');
        }
      }

      tc.deletedAt = undefined;
      await db.putTimecode(touch(tc));

      if (tc.groupId) {
        const group = await db.getGroup(tc.groupId);
        if (group && group.deletedAt) {
          await restoreGroupInternal(group.id);
        }
      }

      for (const entry of entriesToRestore) {
        await restoreEntryInternal(entry.id, true);
      }
    }
  };

  const restoreTimecode = async (id: string) => {
    try {
      await restoreTimecodeInternal(id);
      await refreshData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to restore timecode', 'error');
    }
  };

  /** Resolves to whether the change was stored; gate any success message on it. */
  const updateSettings = async (updates: Partial<Settings>): Promise<boolean> => {
    if (!settings) return false;
    const previousSettings = settings;
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);

    // Read the latest settings from the DB to prevent clobbering fields saved by other tabs
    const currentSettings = await db.getSettings();
    const toWrite = currentSettings ? { ...currentSettings, ...updates } : newSettings;
    if (currentSettings) setSettings(toWrite);

    // The state above is optimistic. If the write fails, put it back rather than
    // leaving the panel showing a preference that was never stored — the user
    // would carry on believing it had been saved.
    if (!(await mutate('save your settings', () => db.putSettings(toWrite).then(() => undefined)))) {
      setSettings(previousSettings);
      return false;
    }
    notifyOtherTabs();
    return true;
  };

  const restoreTemplate = async (template: EntryTemplate, index?: number): Promise<boolean> => {
    const stored = await mutateValue('restore the template', async () => {
      // Re-read rather than replaying the caller's pre-delete snapshot: a
      // template created inside the undo window is in the stored list and not
      // in that snapshot, so writing the snapshot back would delete it.
      const current = await db.getSettings();
      if (!current) return false;
      const existing = current.templates || [];
      if (existing.some((t) => t.id === template.id)) return true;
      const merged = [...existing];
      const at = index == null ? merged.length : Math.max(0, Math.min(index, merged.length));
      merged.splice(at, 0, template);
      await db.putSettings({ ...current, templates: merged });
      return true;
    });
    if (stored !== true) return false;
    notifyOtherTabs();
    await refreshData();
    return true;
  };


  const splitEntry = async (
    entryId: string,
    splitTime: string,
    newTimecodeId?: string,
    options?: { feeAllocation?: FeeAllocation }
  ): Promise<SplitEntryResult> => {
    const entry = await db.getEntry(entryId);
    if (!entry) return { ok: false, reason: 'That entry no longer exists.' };
    if (entry.deletedAt) return { ok: false, reason: 'That entry is in the trash. Restore it before splitting.' };
    if (!entry.endTime) return { ok: false, reason: 'A running timer cannot be split. Stop it first.' };

    const splitDate = new Date(splitTime);
    const startDate = new Date(entry.startTime);
    const endDate = new Date(entry.endTime);

    if (!Number.isFinite(splitDate.getTime())) {
      return { ok: false, reason: 'That split time could not be read.' };
    }
    if (splitDate <= startDate || splitDate >= endDate) {
      return { ok: false, reason: 'Split time must be strictly between the start and end times.' };
    }

    // Filter paused segments for both halves
    const pausedSegments1: PauseSegment[] = [];
    const pausedSegments2: PauseSegment[] = [];

    for (const seg of entry.pausedSegments || []) {
      const pStart = new Date(seg.pauseStart);
      const pEnd = seg.pauseEnd ? new Date(seg.pauseEnd) : endDate;

      if (pEnd <= splitDate) {
        pausedSegments1.push(seg);
      } else if (pStart >= splitDate) {
        pausedSegments2.push({
          pauseStart: seg.pauseStart,
          pauseEnd: seg.pauseEnd || endDate.toISOString(),
        });
      } else {
        // Segment crosses the split time
        pausedSegments1.push({ pauseStart: seg.pauseStart, pauseEnd: splitDate.toISOString() });
        pausedSegments2.push({
          pauseStart: splitDate.toISOString(),
          pauseEnd: seg.pauseEnd || endDate.toISOString(),
        });
      }
    }

    const duration1 = calculateDuration(startDate, splitDate, pausedSegments1);
    const duration2 = calculateDuration(splitDate, endDate, pausedSegments2);

    const now = new Date().toISOString();

    // An estimate describes the whole of the work, so splitting the work splits
    // the estimate with it, in proportion to the time each half actually took.
    // Dropping it (the previous behaviour) silently removed the entry from the
    // Estimates tab's statistics; parking it all on one half would report that
    // half as wildly under and the other as unestimated.
    let expected1: number | null = null;
    let expected2: number | null = null;
    const expectedTotal = entry.expectedDurationMinutes ?? null;
    if (expectedTotal != null && Number.isFinite(expectedTotal)) {
      const totalDuration = duration1 + duration2;
      if (totalDuration > 0) {
        expected1 = Math.round((expectedTotal * duration1) / totalDuration);
        // The remainder rather than a second rounding, so the two halves always
        // sum back to the original estimate.
        expected2 = expectedTotal - expected1;
      } else {
        expected1 = expectedTotal;
        expected2 = 0;
      }
    }

    // A flat fee cannot be divided by time — it is not a rate — so the caller
    // says which half keeps it. Silently discarding it destroyed billable money
    // with no warning and no undo.
    const feeAllocation: FeeAllocation = options?.feeAllocation ?? 'first';
    const hadFee = entry.manualAmount != null;
    const fee1 = hadFee && feeAllocation === 'first' ? entry.manualAmount! : null;
    const fee2 = hadFee && feeAllocation === 'second' ? entry.manualAmount! : null;

    const splitNote: EditHistory = {
      field: 'split',
      oldValue: { endTime: entry.endTime, duration: entry.duration, manualAmount: entry.manualAmount ?? null, expectedDurationMinutes: expectedTotal },
      newValue: { endTime: splitDate.toISOString(), duration: duration1, manualAmount: fee1, expectedDurationMinutes: expected1 },
      editedAt: now,
    };

    const entry1: Entry = {
      ...entry,
      endTime: splitDate.toISOString(),
      duration: duration1,
      pausedSegments: pausedSegments1,
      manualAmount: fee1,
      expectedDurationMinutes: expected1,
      editHistory: [...(entry.editHistory || []), splitNote],
      deletedAt: undefined,
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
      editHistory: [splitNote],
      manualAmount: fee2,
      expectedDurationMinutes: expected2,
      deletedAt: undefined,
    };

    // Both halves in one transaction. Written separately, a failure on the
    // second put would leave the original already truncated to the first half
    // and the remainder — along with any fee allocated to it — gone with no way
    // back. `mutateValue` reports the failure rather than letting it surface as
    // an unhandled rejection behind a success message.
    const stored = await mutateValue('split the entry', async () => {
      await db.putEntries([entry1, entry2]);
      return true as const;
    });

    await refreshData();

    if (!stored) {
      return { ok: false, reason: 'The split could not be saved. The entry is unchanged.' };
    }

    return {
      ok: true,
      newEntryId: entry2.id,
      feeMoved: hadFee ? feeAllocation : null,
      estimateSplit: expectedTotal != null,
    };
  };

  const deleteEntry = async (id: string) => {
    // Stopping happens inside the queue so a concurrent stop cannot land between
    // the read and the write, and so the trashed record can never sit in storage
    // with isRunning: true — restoring it would otherwise revive a timer that
    // has been "running" for as long as it sat in the trash.
    const deleted = await mutateValue('delete the entry', () => runExclusive(async () => {
      const entry = await db.getEntry(id);
      if (!entry) return false;
      if (entry.isRunning) {
        await performStop(entry.id);
      }
      const latestEntry = (await db.getEntry(id)) || entry;
      const deletedAt = new Date().toISOString();
      await db.putEntry(touch({ ...latestEntry, deletedAt }, deletedAt));
      return true;
    }));
    if (deleted) {
      addToast('Entry deleted', 'success', { label: 'Undo', onClick: () => restoreEntry(id) }, 5000);
    }
    await refreshData();
  };

  const bulkDeleteEntries = async (ids: string[]) => {
    if (ids.length === 0) return;
    // Sequential inside one queue slot: each entry is stopped before it is
    // trashed, and no concurrent timer mutation can interleave with the batch.
    const deletedIds = await mutateValue('delete the entries', () => runExclusive(async () => {
      const now = new Date().toISOString();
      const done: string[] = [];
      for (const id of ids) {
        const entry = await db.getEntry(id);
        if (!entry) continue;
        if (entry.isRunning) {
          await performStop(entry.id);
        }
        const latestEntry = (await db.getEntry(id)) || entry;
        await db.putEntry(touch({ ...latestEntry, deletedAt: now }, now));
        done.push(id);
      }
      return done;
    }));
    if (deletedIds && deletedIds.length > 0) {
      addToast(
        `${deletedIds.length} ${deletedIds.length === 1 ? 'entry' : 'entries'} deleted`,
        'success',
        { label: 'Undo', onClick: () => Promise.all(deletedIds.map((id) => restoreEntryInternal(id))).then(() => refreshData()) },
        5000
      );
    }
    await refreshData();
  };

  const hardDeleteEntry = async (id: string) => {
    await db.deleteEntry(id);
    await refreshData();
  };

  const restoreEntryInternal = async (id: string, skipOverlapCheck = false) => {
    const entry = await db.getEntry(id);
    if (entry) {
      if (!skipOverlapCheck) {
        const liveEntries = await db.getEntries().then(res => res.filter(e => !e.deletedAt));
        const rejected = findOverlappingCandidates([entry], liveEntries, settings?.allowConcurrentTimers);
        if (rejected.size > 0) {
          throw new Error('Cannot restore entry: overlaps with existing live entries.');
        }
      }
      entry.deletedAt = undefined;
      await db.putEntry(touch(entry));

      if (entry.timecodeId) {
        const tc = await db.getTimecode(entry.timecodeId);
        if (tc && tc.deletedAt) {
          await restoreTimecodeInternal(tc.id);
        }
      }
    }
  };

  const restoreEntry = async (id: string) => {
    try {
      await restoreEntryInternal(id);
      await refreshData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to restore entry', 'error');
    }
  };

  /**
   * Record that a backup actually reached the user's disk.
   *
   * This is deliberately not done by `getBackupBlob`: serialising the data is
   * not saving it. The download can still fail after the blob exists — an
   * object URL that cannot be created, a click the browser refuses — and a
   * stamp written at serialisation time would suppress the reminder banner for
   * another interval over a file the user never received.
   */
  const markBackupSaved = async () => {
    try {
      await updateSettings({ lastBackupDate: new Date().toISOString() });
    } catch (error) {
      // Callers fire this from a download callback that cannot await it, so a
      // rejection here would surface as an unhandled one. Failing to record the
      // date only means the reminder comes back sooner, which is the safe way
      // for this to break.
      logError(error as Error, 'markBackupSaved');
    }
  };

  const getBackupBlob = async (): Promise<Blob> => {
    const allGroups = await db.getGroups();
    const allTimecodes = await db.getTimecodes();
    const allEntries = await db.getEntries();
    const storedSettings = await db.getSettings();

    // The file records when it was taken, so restoring it does not resurrect
    // the previous backup date and start the reminder countdown from there.
    // Only the copy inside the file is stamped here; the stored settings are
    // stamped by `markBackupSaved` once the download has actually succeeded.
    const currentSettings = storedSettings
      ? { ...storedSettings, lastBackupDate: new Date().toISOString() }
      : storedSettings;

    const dataToExport = {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
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

    // Only once the download is handed to the browser, for the same reason
    // `markBackupSaved` exists: anything above can throw, and a stamp written
    // before it would claim a backup the user never got.
    await markBackupSaved();
  };

  const migrateImportData = (data: any, fromVersion: number) => {
    let migratedData = { ...data };

    // Future migrations go here:
    // if (fromVersion === 1) {
    //   migratedData = migrateV1toV2(migratedData);
    //   fromVersion = 2;
    // }

    assertSupportedSchemaVersion(fromVersion);

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
    // Size, parse, checksum and schema version, all in the one helper the
    // import preview calls — so a file the preview passes is a file this
    // accepts, and vice versa.
    const parsed = await verifyBackupFile(file);

    const migratedData = normalizeImportData(migrateImportData(parsed, parsed.schemaVersion));

    // In merge mode an entry may legitimately point at a timecode that is
    // already stored locally rather than carried in the file.
    const knownTimecodeIds = mode === 'merge'
      ? new Set((await db.getTimecodes()).map((tc) => tc.id))
      : undefined;

    let importedEntries: Entry[] = migratedData.entries || [];
    let skippedOverlaps = 0;

    if (mode === 'merge') {
      const localEntries = await db.getEntries();
      const incomingIds = new Set(importedEntries.map((e) => e.id));

      // An incoming record with an id already stored is an update to that
      // record, not a second entry beside it, so it must not be weighed against
      // its own local copy.
      const untouchedLocal = localEntries.filter((e) => !incomingIds.has(e.id) && !e.deletedAt);

      // The local setting is what will be in force after a merge — the file's
      // settings may not even be applied.
      const localSettings = await db.getSettings();
      const effectiveAllowConcurrent = localSettings?.allowConcurrentTimers ?? false;

      validateBackupPayload(migratedData, knownTimecodeIds, {
        allowConcurrentTimers: effectiveAllowConcurrent,
        existingRunningCount: untouchedLocal.filter((e) => e.isRunning).length,
      });

      // Every single-entry path checks for overlaps, and CSV import does too,
      // but backup merge did not — so a merge could create the overlapping
      // entries the UI refuses to accept, and overlapping entries double-count
      // on an invoice. Trashed incoming records are left alone: they occupy no
      // time until restored, and restoreEntry does its own checking.
      const liveIncoming: Entry[] = [];
      const liveIncomingIndexes: number[] = [];
      importedEntries.forEach((e, index) => {
        if (!e.deletedAt) {
          liveIncoming.push(e);
          liveIncomingIndexes.push(index);
        }
      });

      const clashing = findOverlappingCandidates(liveIncoming, untouchedLocal, effectiveAllowConcurrent);
      if (clashing.size > 0) {
        const dropped = new Set(Array.from(clashing).map((i) => liveIncomingIndexes[i]));
        importedEntries = importedEntries.filter((_, index) => !dropped.has(index));
        skippedOverlaps = clashing.size;
      }
    } else {
      // Validate what will actually be written, not the pre-migration input.
      validateBackupPayload(migratedData, knownTimecodeIds);
    }

    await db.importBackup(
      {
        groups: migratedData.groups || [],
        timecodes: migratedData.timecodes || [],
        entries: importedEntries,
        settings: migratedData.settings,
      },
      mode
    );
    await refreshData();

    if (skippedOverlaps > 0) {
      addToast(
        `Imported, but skipped ${skippedOverlaps} ${skippedOverlaps === 1 ? 'entry' : 'entries'} that overlapped time you already have.`,
        'info',
        undefined,
        8000
      );
    }
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
      deleteGroup: guarded('delete the group', deleteGroup),
      addTimecode,
      updateTimecode,
      deleteTimecode: guarded('delete the timecode', deleteTimecode),
      mergeTimecodes,
      updateActiveNote: guarded('save the note', updateActiveNote),
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
      restoreTemplate,
      exportData,
      getBackupBlob,
      markBackupSaved,
      importData,
      wipeAllData,
      lastStoppedEntry,
      undoStopTimer,
      clearLastStoppedEntry,
      deletedGroups,
      deletedTimecodes,
      deletedEntries,
      restoreGroup: guarded('restore the group', restoreGroup),
      restoreTimecode: guarded('restore the timecode', restoreTimecode),
      restoreEntry: guarded('restore the entry', restoreEntry),
      hardDeleteGroup: guarded('permanently delete the group', hardDeleteGroup),
      hardDeleteTimecode: guarded('permanently delete the timecode', hardDeleteTimecode),
      hardDeleteEntry: guarded('permanently delete the entry', hardDeleteEntry),
      emptyTrash: guarded('empty the trash', emptyTrash),
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
