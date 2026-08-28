import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Group, Timecode, Entry, Settings } from '../types';

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

export const closeDB = async () => {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // The connection never opened; nothing to close.
    }
    dbPromise = null;
  }
  // Reset the degraded state with the connection. Leaving it set made fallback
  // mode permanent for the life of the page even after a successful reopen.
  isFallbackMode = false;
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
            // Lets entries be read back already ordered instead of sorted in JS.
            entryStore.createIndex('by-start-time', 'startTime');
          }
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      },
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

/** Running entries, oldest first, so "the active timer" is never arbitrary. */
const selectActive = (entries: Entry[]): Entry[] =>
  entries
    .filter((e) => e.isRunning === true && !e.deletedAt)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

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
const byStartTimeAsc = (a: Entry, b: Entry) =>
  new Date(a.startTime).getTime() - new Date(b.startTime).getTime();

/**
 * Entries ordered oldest-first by start time, read back already sorted from
 * the index rather than sorted in JS on every refresh.
 *
 * IndexedDB omits records whose indexed key is absent, so the index result is
 * checked against the store count and a plain scan is used if anything would
 * have been dropped. Silently losing an entry with a malformed startTime is a
 * far worse outcome than sorting in memory.
 */
export const getEntries = async (): Promise<Entry[]> =>
  withDB(
    async (db) => {
      const [indexed, total] = await Promise.all([
        db.getAllFromIndex('entries', 'by-start-time'),
        db.count('entries'),
      ]);
      if (indexed.length === total) return indexed;
      return (await db.getAll('entries')).sort(byStartTimeAsc);
    },
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
 * The primary running timer: the one that has been running longest. Picking
 * whichever record `getAll` happened to return first made the timer shown in
 * the global bar non-deterministic when concurrency is enabled.
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
export const getSettings = async (): Promise<Settings | undefined> =>
  withDB((db) => db.get('settings', 'user-settings'), () => fallbackMemoryDB.settings.get('user-settings'));

export const putSettings = async (settings: Settings): Promise<string> =>
  withDB((db) => db.put('settings', settings), () => {
    fallbackMemoryDB.settings.set(settings.id, settings);
    return settings.id;
  });

export const wipeAllData = async (): Promise<void> => {
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
        fallbackMemoryDB.settings.set(data.settings.id, data.settings);
      } else if (mode === 'merge') {
        const existingSettings = fallbackMemoryDB.settings.get('user-settings');
        if (existingSettings) {
          const mergedTemplates = [...(existingSettings.templates || [])];
          if (data.settings.templates) {
            data.settings.templates.forEach(t => {
              if (!mergedTemplates.some(existing => existing.id === t.id)) {
                mergedTemplates.push(t);
              }
            });
          }
          fallbackMemoryDB.settings.set('user-settings', {
            ...existingSettings,
            ...data.settings,
            templates: mergedTemplates
          });
        } else {
          fallbackMemoryDB.settings.set('user-settings', data.settings);
        }
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
      const existingSettings = await settingsStore.get('user-settings');
      if (existingSettings) {
        const mergedTemplates = [...(existingSettings.templates || [])];
        if (data.settings.templates) {
          data.settings.templates.forEach(t => {
            if (!mergedTemplates.some(existing => existing.id === t.id)) {
              mergedTemplates.push(t);
            }
          });
        }
        await settingsStore.put({
          ...existingSettings,
          ...data.settings,
          templates: mergedTemplates
        });
      } else {
        await settingsStore.put(data.settings);
      }
    }
  }

  await tx.done;
};
