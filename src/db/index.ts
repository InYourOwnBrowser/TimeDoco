import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Group, Timecode, Entry, Settings } from '../types';
import { UserFacingError } from '../utils/errorMessage';

interface TimeTrackerDB extends DBSchema {
  groups: {
    key: string;
    value: Group;
  };
  timecodes: {
    key: string;
    value: Timecode;
    indexes: { 'by-group': string };
  };
  entries: {
    key: string;
    value: Entry;
    indexes: {
      'by-timecode': string;
      'by-start-time': string;
    };
  };
  settings: {
    key: string;
    value: Settings;
  };
}

const DB_NAME = 'time-tracker-db';
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<TimeTrackerDB>> | null = null;
let isFallbackMode = false;

export const getIsFallbackMode = (): boolean => isFallbackMode;

/**
 * Two tabs, two builds, one database that can only be at one version.
 *
 * A version bump is the one deploy that cannot be absorbed silently: the tab
 * running the new build needs the upgrade, and IndexedDB will not start it
 * while any connection to the old version is open. Left unhandled that is not
 * an error — `openDB` simply never settles — so every read and every write
 * awaits a promise with no outcome. Nothing rejects, so `refreshData`'s catch
 * never runs and fallback mode is never entered: the app renders a complete,
 * empty tracker and stores nothing the user does in it, which is the single
 * worst way for this to present. Neither state may fall back to the in-memory
 * store, either — an empty store is exactly the "all my data is gone" the user
 * would already be fearing.
 *
 * Which tab is told, and what it is told, differs:
 *
 *  - 'blocked-by-older-tab' is the new build, waiting on a connection it does
 *    not own. It cannot close that connection itself; the user has to.
 *  - 'superseded-by-newer-tab' is the old build, asked to get out of the way.
 *    It closes its connection so the upgrade proceeds, which leaves this tab
 *    running against a database it can no longer open at its own version.
 *
 * `blocking` is the half that only pays off next time: on the deploy that
 * introduces it, the tab that has to yield is running the *previous* build,
 * which has no such handler. It is here so the version after this one does not
 * repeat the whole problem.
 */
export type ConnectionBlock = 'blocked-by-older-tab' | 'superseded-by-newer-tab';

let connectionBlock: ConnectionBlock | null = null;

export const getConnectionBlock = (): ConnectionBlock | null => connectionBlock;

/** What each state tells the user, written to be shown verbatim. */
const BLOCK_MESSAGES: Record<ConnectionBlock, string> = {
  'blocked-by-older-tab':
    'Another TimeDoco tab is open on an older version and is holding your database. ' +
    'Close the other tab, then reload this one. Nothing has been lost.',
  'superseded-by-newer-tab':
    'TimeDoco was updated in another tab, which now owns your database. ' +
    'Reload this tab to catch up. Nothing has been lost.',
};

const setConnectionBlock = (state: ConnectionBlock) => {
  if (connectionBlock === state) return;
  connectionBlock = state;
  window.dispatchEvent(new CustomEvent('idb-connection-blocked', { detail: { state } }));
};

const clearConnectionBlock = () => {
  if (connectionBlock === null) return;
  connectionBlock = null;
  // The blocking tab closed and the upgrade went through. Whatever is listening
  // has a banner to take down and a stale, empty view to re-read.
  window.dispatchEvent(new CustomEvent('idb-connection-unblocked'));
};

/**
 * Refuse an operation while the two tabs are at different versions.
 *
 * Throws rather than falling back to memory: a version standoff says nothing
 * about whether IndexedDB works, and answering from an empty in-memory store
 * would show the user an app that has lost everything — while quietly taking
 * writes into a store discarded when the tab closes. A `UserFacingError`
 * reaches them intact through `describeUserFacingError`, and the last loaded
 * state stays on screen, which is what `refreshData`'s catch and the mutation
 * wrappers already do with a failure.
 */
const assertConnectionUsable = (): void => {
  if (connectionBlock !== null) {
    throw new UserFacingError(BLOCK_MESSAGES[connectionBlock]);
  }
};

// In-memory fallback storage
const fallbackMemoryDB = {
  groups: new Map<string, Group>(),
  timecodes: new Map<string, Timecode>(),
  entries: new Map<string, Entry>(),
  settings: new Map<string, Settings>(),
};

const triggerFallbackMode = (error: any) => {
  if (!isFallbackMode) {
    console.error('IndexedDB failed, entering in-memory fallback mode:', error);
    isFallbackMode = true;
    window.dispatchEvent(new CustomEvent('idb-fallback-mode', { detail: { error } }));
  }
};

const clearFallbackMemory = () => {
  fallbackMemoryDB.groups.clear();
  fallbackMemoryDB.timecodes.clear();
  fallbackMemoryDB.entries.clear();
  fallbackMemoryDB.settings.clear();
};

/**
 * Close the connection and clear the degraded state, keeping whatever the
 * in-memory store holds.
 *
 * The memory is not scratch space: when IndexedDB could not be opened it is the
 * user's data, and the only copy of it. Clearing it here — in a function whose
 * name promises to close a connection — discarded a session's work outright,
 * and left a reopen that fails again looking at an empty app. Resetting just
 * the flag is what the reopen actually needs; `resetDBForTests` is the wipe.
 */
export const closeDB = async () => {
  if (dbPromise) {
    const pending = dbPromise;
    dbPromise = null;
    if (connectionBlock === 'blocked-by-older-tab') {
      // This one never settles while the other tab holds the database, so
      // awaiting it would hang whoever asked to close — a test's teardown
      // among them. Close it if and when it does arrive instead.
      void pending.then((db) => db.close()).catch(() => {});
    } else {
      try {
        (await pending).close();
      } catch {
        // The connection never opened; nothing to close.
      }
    }
  }
  // Reset the degraded state with the connection. Leaving it set made fallback
  // mode permanent for the life of the page even after a successful reopen.
  isFallbackMode = false;
  connectionBlock = null;
};

/**
 * `closeDB`, plus the wipe of the in-memory store that a fresh test needs.
 *
 * Separate from `closeDB` because discarding the fallback data is only ever
 * right when there is no user whose data it is.
 */
export const resetDBForTests = async () => {
  await closeDB();
  clearFallbackMemory();
};

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<TimeTrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('groups')) {
          db.createObjectStore('groups', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('timecodes')) {
          const tcStore = db.createObjectStore('timecodes', { keyPath: 'id' });
          tcStore.createIndex('by-group', 'groupId');
        }
        if (!db.objectStoreNames.contains('entries')) {
          const entryStore = db.createObjectStore('entries', { keyPath: 'id' });
          entryStore.createIndex('by-timecode', 'timecodeId');
          entryStore.createIndex('by-start-time', 'startTime');
        } else {
          const entryStore = transaction.objectStore('entries');
          if (oldVersion < 2) {
            // Remove the invalid boolean index from v1
            if (entryStore.indexNames.contains('is-running' as any)) {
              entryStore.deleteIndex('is-running' as any);
            }
          }
          if (oldVersion < 3 && !entryStore.indexNames.contains('by-start-time')) {
            // Declared but deliberately not read: see `getEntries`, which sorts
            // in JS because an IndexedDB index compares `startTime` as a string
            // and ISO strings with different offsets do not sort by instant.
            // Kept so the schema matches v3 databases already in the wild —
            // dropping it is a v4 migration, for no gain a reader would see.
            entryStore.createIndex('by-start-time', 'startTime');
          }
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      },
      blocked() {
        // Pending, not failed: IndexedDB re-fires `success` on its own once the
        // other connection closes, so this promise is still the one that will
        // resolve. Say so and let it wait.
        setConnectionBlock('blocked-by-older-tab');
      },
      blocking() {
        // A newer build is waiting on this connection. Close it so the upgrade
        // can start — a tab that will not yield blocks the user's other tab
        // indefinitely, and this one has already loaded its data.
        setConnectionBlock('superseded-by-newer-tab');
        void dbPromise
          ?.then((db) => db.close())
          // Already closed, or never opened. Either way there is nothing left
          // holding the upgrade up, which is all this had to achieve.
          .catch(() => {});
      },
    }).then((db) => {
      // Reached only by an open that actually succeeded, which is the one
      // unambiguous signal that nothing is holding the database any more.
      clearConnectionBlock();
      return db;
    });
  }
  return dbPromise;
};

export const getDB = async () => {
  try {
    return await initDB();
  } catch (error) {
    // Only a failure to open the database puts the app into fallback mode.
    triggerFallbackMode(error);
    throw error;
  }
};

/**
 * Run one operation against IndexedDB, with the in-memory store used only when
 * the database cannot be opened at all.
 *
 * An error raised by a single operation — a rejected put, an aborted
 * transaction, one unreadable record — is rethrown rather than flipping the
 * whole app into an empty in-memory store. Treating those as connection
 * failures meant one bad record silently emptied the app's view of its own
 * data, which to the user is indistinguishable from total data loss.
 */
async function withDB<T>(
  operation: (db: IDBPDatabase<TimeTrackerDB>) => Promise<T>,
  whenUnavailable: () => T,
): Promise<T> {
  // Checked before fallback mode: see `assertConnectionUsable` for why this one
  // rejects where every other unavailability answers from memory.
  assertConnectionUsable();

  if (isFallbackMode) return whenUnavailable();

  let db: IDBPDatabase<TimeTrackerDB>;
  try {
    db = await getDB();
  } catch {
    // getDB has already entered fallback mode and logged the cause.
    return whenUnavailable();
  }

  return await operation(db);
}

/** Oldest-first by start time, treating an unparseable timestamp as the epoch. */
const byStartTimeAsc = (a: Entry, b: Entry) => {
  const tA = a.startTime ? new Date(a.startTime).getTime() : NaN;
  const tB = b.startTime ? new Date(b.startTime).getTime() : NaN;
  const validA = Number.isNaN(tA) ? 0 : tA;
  const validB = Number.isNaN(tB) ? 0 : tB;
  return validA - validB;
};

/** Running entries, most recent first, matching GlobalActiveTimerBar and document title. */
const selectActive = (entries: Entry[]): Entry[] =>
  entries
    .filter((e) => e.isRunning === true && !e.deletedAt)
    // Sorted through the same NaN-safe comparator `getEntries` uses. A raw
    // `getTime()` difference on an unparseable start time is NaN, which is
    // neither negative, zero nor positive, so the sort order became arbitrary
    // — and this list decides which timer the app calls the primary one.
    .sort((a, b) => byStartTimeAsc(b, a));

// --- Groups ---
export const getGroups = async (): Promise<Group[]> =>
  withDB((db) => db.getAll('groups'), () => Array.from(fallbackMemoryDB.groups.values()));

export const getGroup = async (id: string): Promise<Group | undefined> =>
  withDB((db) => db.get('groups', id), () => fallbackMemoryDB.groups.get(id));

export const putGroup = async (group: Group): Promise<string> =>
  withDB((db) => db.put('groups', group), () => {
    fallbackMemoryDB.groups.set(group.id, group);
    return group.id;
  });

export const deleteGroup = async (id: string): Promise<void> =>
  withDB((db) => db.delete('groups', id), () => {
    fallbackMemoryDB.groups.delete(id);
  });

// --- Timecodes ---
export const getTimecodes = async (): Promise<Timecode[]> =>
  withDB((db) => db.getAll('timecodes'), () => Array.from(fallbackMemoryDB.timecodes.values()));

export const getTimecode = async (id: string): Promise<Timecode | undefined> =>
  withDB((db) => db.get('timecodes', id), () => fallbackMemoryDB.timecodes.get(id));

export const putTimecode = async (timecode: Timecode): Promise<string> =>
  withDB((db) => db.put('timecodes', timecode), () => {
    fallbackMemoryDB.timecodes.set(timecode.id, timecode);
    return timecode.id;
  });

export const deleteTimecode = async (id: string): Promise<void> =>
  withDB((db) => db.delete('timecodes', id), () => {
    fallbackMemoryDB.timecodes.delete(id);
  });

// --- Entries ---
/**
 * Entries ordered oldest-first by start time, sorted explicitly by timestamp.
 *
 * Sorting in JavaScript by parsed Date timestamp ensures ISO strings with
 * varying timezone offsets (e.g. +13:00 vs Z) sort correctly according to
 * actual epoch time, avoiding IndexedDB string index comparison pitfalls.
 */
export const getEntries = async (): Promise<Entry[]> =>
  withDB(
    async (db) => (await db.getAll('entries')).sort(byStartTimeAsc),
    () => Array.from(fallbackMemoryDB.entries.values()).sort(byStartTimeAsc),
  );

export const getEntry = async (id: string): Promise<Entry | undefined> =>
  withDB((db) => db.get('entries', id), () => fallbackMemoryDB.entries.get(id));

export const putEntry = async (entry: Entry): Promise<string> =>
  withDB((db) => db.put('entries', entry), () => {
    fallbackMemoryDB.entries.set(entry.id, entry);
    return entry.id;
  });

export const deleteEntry = async (id: string): Promise<void> =>
  withDB((db) => db.delete('entries', id), () => {
    fallbackMemoryDB.entries.delete(id);
  });

/**
 * Write several entries as one unit: either every record lands or none does.
 *
 * Splitting an entry rewrites the original as the first half and creates the
 * second half as a new record. Two sequential `putEntry` calls are two
 * transactions, so a failure on the second — quota, an aborted transaction,
 * Safari's private mode — leaves the original truncated and the remainder
 * nowhere, which destroys time the user actually worked. One transaction makes
 * that impossible: an error aborts it and the original stays as it was.
 */
export const putEntries = async (entries: Entry[]): Promise<void> => {
  if (entries.length === 0) return;
  return withDB(
    async (db) => {
      const tx = db.transaction('entries', 'readwrite');
      const store = tx.objectStore('entries');
      await Promise.all(entries.map((entry) => store.put(entry)));
      await tx.done;
    },
    () => {
      // The in-memory store has no transactions, but a Map write cannot fail
      // partway either, so the same all-or-nothing holds without one.
      entries.forEach((entry) => fallbackMemoryDB.entries.set(entry.id, entry));
    },
  );
};

/**
 * Put a group/timecode/entry set back as one unit: all of it lands, or none.
 *
 * A restore from the trash is one user action over three stores — a group, the
 * timecodes under it, and their entries. Written as three sequential loops of
 * single-record puts it is as many transactions as there are records, so a
 * failure part-way leaves the group and its timecodes live with half their
 * entries still in the trash: a state the user never asked for and cannot see
 * without going back to the trash to look. One transaction across the three
 * stores makes that impossible — an error aborts it and nothing moved.
 *
 * Ordered group → timecode → entry so the parent of every restored record is
 * already in the transaction, matching what `planRestore` builds.
 */
export const putRestorePlan = async (
  groups: Group[],
  timecodes: Timecode[],
  entries: Entry[],
): Promise<void> => {
  if (groups.length === 0 && timecodes.length === 0 && entries.length === 0) return;
  return withDB(
    async (db) => {
      const tx = db.transaction(['groups', 'timecodes', 'entries'], 'readwrite');
      await Promise.all([
        ...groups.map((group) => tx.objectStore('groups').put(group)),
        ...timecodes.map((timecode) => tx.objectStore('timecodes').put(timecode)),
        ...entries.map((entry) => tx.objectStore('entries').put(entry)),
      ]);
      await tx.done;
    },
    () => {
      // The in-memory store has no transactions, but a Map write cannot fail
      // partway either, so the same all-or-nothing holds without one.
      groups.forEach((group) => fallbackMemoryDB.groups.set(group.id, group));
      timecodes.forEach((timecode) => fallbackMemoryDB.timecodes.set(timecode.id, timecode));
      entries.forEach((entry) => fallbackMemoryDB.entries.set(entry.id, entry));
    },
  );
};

/**
 * The primary running timer: the most recently started active timer,
 * matching GlobalActiveTimerBar and document title.
 */
export const getActiveEntry = async (): Promise<Entry | undefined> =>
  withDB(
    async (db) => selectActive(await db.getAll('entries'))[0],
    () => selectActive(Array.from(fallbackMemoryDB.entries.values()))[0],
  );

export const getActiveEntries = async (): Promise<Entry[]> =>
  withDB(
    async (db) => selectActive(await db.getAll('entries')),
    () => selectActive(Array.from(fallbackMemoryDB.entries.values())),
  );

/** Same selection as getActiveEntries, for a caller that already holds the list. */
export const selectActiveEntries = (entries: Entry[]): Entry[] => selectActive(entries);

// --- Settings ---
/** The single settings record's key. Only ever one row in this store. */
const SETTINGS_KEY = 'user-settings';


export const getSettings = async (): Promise<Settings | undefined> =>
  withDB((db) => db.get('settings', SETTINGS_KEY), () => fallbackMemoryDB.settings.get(SETTINGS_KEY));

/**
 * Merge-mode settings: the newer record wins, and templates are a union.
 *
 * Templates are genuinely additive — a merge should end up holding both sides'
 * — while everything else is a single-valued preference, so the newer write
 * wins, the same rule groups, timecodes and entries already follow. Spreading
 * the file over the local settings unconditionally silently replaced the user's
 * rounding rule, scope, currency, tax setup, preparer details, logo and footer
 * with the file's. Settings written before `updatedAt` existed carry none, and
 * count as older.
 *
 * Shared by the IndexedDB and the in-memory path: this rule was fixed on one
 * and not the other, so the whole bug was intact for any user whose database
 * failed to open. One function is what stops that happening again.
 */
export const mergeSettings = (existing: Settings, incoming: Settings): Settings => {
  const mergedTemplates = [...(existing.templates || [])];
  if (incoming.templates) {
    incoming.templates.forEach((t) => {
      if (!mergedTemplates.some((already) => already.id === t.id)) mergedTemplates.push(t);
    });
  }

  const incomingAt = incoming.updatedAt ? new Date(incoming.updatedAt).getTime() : NaN;
  const existingAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : NaN;
  const incomingIsNewer =
    Number.isFinite(incomingAt) && (!Number.isFinite(existingAt) || incomingAt > existingAt);

  return incomingIsNewer
    ? { ...existing, ...incoming, templates: mergedTemplates }
    : { ...existing, templates: mergedTemplates };
};

/**
 * Stamps `updatedAt` on every settings write. Doing it here rather than at each
 * of the ~a dozen call sites is what makes the field trustworthy enough for
 * merge-mode import to compare against, the way it already compares groups,
 * timecodes and entries.
 */
export const putSettings = async (settings: Settings): Promise<string> => {
  const stamped: Settings = { ...settings, updatedAt: new Date().toISOString() };
  return withDB((db) => db.put('settings', stamped), () => {
    fallbackMemoryDB.settings.set(stamped.id, stamped);
    return stamped.id;
  });
};

export const wipeAllData = async (): Promise<void> => {
  // These two reach `getDB` directly rather than through `withDB`, so they need
  // the version-standoff guard spelled out. Both are destructive; hanging
  // part-way through one is the last thing either should do.
  assertConnectionUsable();
  if (isFallbackMode) {
    clearFallbackMemory();
    return;
  }
  const db = await getDB();
  const tx = db.transaction(['groups', 'timecodes', 'entries', 'settings'], 'readwrite');
  await tx.objectStore('groups').clear();
  await tx.objectStore('timecodes').clear();
  await tx.objectStore('entries').clear();
  await tx.objectStore('settings').clear();
  await tx.done;
};

// --- Import / Backup ---
export const importBackup = async (
  data: { groups: Group[]; timecodes: Timecode[]; entries: Entry[]; settings?: Settings },
  mode: 'merge' | 'replace'
): Promise<void> => {
  assertConnectionUsable();
  if (isFallbackMode) {
    if (mode === 'replace') {
      clearFallbackMemory();
    }
    data.groups.forEach(g => {
      if (mode === 'merge') {
        const existing = fallbackMemoryDB.groups.get(g.id);
        if (!existing || new Date(g.updatedAt) > new Date(existing.updatedAt)) fallbackMemoryDB.groups.set(g.id, g);
      } else {
        fallbackMemoryDB.groups.set(g.id, g);
      }
    });
    data.timecodes.forEach(tc => {
      if (mode === 'merge') {
        const existing = fallbackMemoryDB.timecodes.get(tc.id);
        if (!existing || new Date(tc.updatedAt) > new Date(existing.updatedAt)) fallbackMemoryDB.timecodes.set(tc.id, tc);
      } else {
        fallbackMemoryDB.timecodes.set(tc.id, tc);
      }
    });
    data.entries.forEach(e => {
      if (mode === 'merge') {
        const existing = fallbackMemoryDB.entries.get(e.id);
        if (!existing || new Date(e.updatedAt) > new Date(existing.updatedAt)) fallbackMemoryDB.entries.set(e.id, e);
      } else {
        fallbackMemoryDB.entries.set(e.id, e);
      }
    });
    if (data.settings) {
      if (mode === 'replace') {
        fallbackMemoryDB.settings.set(SETTINGS_KEY, { ...data.settings, id: SETTINGS_KEY });
      } else if (mode === 'merge') {
        const existingSettings = fallbackMemoryDB.settings.get(SETTINGS_KEY);
        fallbackMemoryDB.settings.set(
          SETTINGS_KEY,
          existingSettings ? mergeSettings(existingSettings, data.settings) : data.settings,
        );
      }
    }
    return;
  }

  // An import that fails is an import that failed — it says nothing about
  // whether the database is usable, so it must not degrade the whole app into
  // fallback mode. The error propagates to the caller unchanged.
  const db = await getDB();
  const tx = db.transaction(['groups', 'timecodes', 'entries', 'settings'], 'readwrite');

  if (mode === 'replace') {
    await tx.objectStore('groups').clear();
    await tx.objectStore('timecodes').clear();
    await tx.objectStore('entries').clear();
    await tx.objectStore('settings').clear();
  }

  const groupStore = tx.objectStore('groups');
  for (const g of data.groups) {
    if (mode === 'merge') {
      const existing = await groupStore.get(g.id);
      if (!existing || new Date(g.updatedAt) > new Date(existing.updatedAt)) {
        await groupStore.put(g);
      }
    } else {
      await groupStore.put(g);
    }
  }

  const tcStore = tx.objectStore('timecodes');
  for (const tc of data.timecodes) {
    if (mode === 'merge') {
      const existing = await tcStore.get(tc.id);
      if (!existing || new Date(tc.updatedAt) > new Date(existing.updatedAt)) {
        await tcStore.put(tc);
      }
    } else {
      await tcStore.put(tc);
    }
  }

  const entryStore = tx.objectStore('entries');
  for (const e of data.entries) {
    if (mode === 'merge') {
      const existing = await entryStore.get(e.id);
      if (!existing || new Date(e.updatedAt) > new Date(existing.updatedAt)) {
        await entryStore.put(e);
      }
    } else {
      await entryStore.put(e);
    }
  }

  if (data.settings) {
    const settingsStore = tx.objectStore('settings');
    if (mode === 'replace') {
      await settingsStore.put(data.settings);
    } else if (mode === 'merge') {
      const existingSettings = await settingsStore.get(SETTINGS_KEY);
      await settingsStore.put(
        existingSettings ? mergeSettings(existingSettings, data.settings) : data.settings
      );
    }
  }

  await tx.done;
};
