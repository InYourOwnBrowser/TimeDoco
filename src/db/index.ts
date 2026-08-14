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
    };
  };
  settings: {
    key: string;
    value: Settings;
  };
}

const DB_NAME = 'time-tracker-db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<TimeTrackerDB>> | null = null;

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
        } else if (oldVersion < 2) {
          // Remove the invalid boolean index from v1
          const entryStore = transaction.objectStore('entries');
          if (entryStore.indexNames.contains('is-running' as any)) {
            entryStore.deleteIndex('is-running' as any);
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
  return await initDB();
};

// --- Groups ---
export const getGroups = async (): Promise<Group[]> => {
  const db = await getDB();
  return db.getAll('groups');
};

export const getGroup = async (id: string): Promise<Group | undefined> => {
  const db = await getDB();
  return db.get('groups', id);
};

export const putGroup = async (group: Group): Promise<string> => {
  const db = await getDB();
  return db.put('groups', group);
};

export const deleteGroup = async (id: string): Promise<void> => {
  const db = await getDB();
  return db.delete('groups', id);
};

// --- Timecodes ---
export const getTimecodes = async (): Promise<Timecode[]> => {
  const db = await getDB();
  return db.getAll('timecodes');
};

export const getTimecode = async (id: string): Promise<Timecode | undefined> => {
  const db = await getDB();
  return db.get('timecodes', id);
};

export const putTimecode = async (timecode: Timecode): Promise<string> => {
  const db = await getDB();
  return db.put('timecodes', timecode);
};

export const deleteTimecode = async (id: string): Promise<void> => {
  const db = await getDB();
  return db.delete('timecodes', id);
};

// --- Entries ---
export const getEntries = async (): Promise<Entry[]> => {
  const db = await getDB();
  return db.getAll('entries');
};

export const getEntry = async (id: string): Promise<Entry | undefined> => {
  const db = await getDB();
  return db.get('entries', id);
};

export const putEntry = async (entry: Entry): Promise<string> => {
  const db = await getDB();
  return db.put('entries', entry);
};

export const deleteEntry = async (id: string): Promise<void> => {
  const db = await getDB();
  return db.delete('entries', id);
};

export const getActiveEntry = async (): Promise<Entry | undefined> => {
  const db = await getDB();
  const allEntries = await db.getAll('entries');
  return allEntries.find((e) => e.isRunning === true);
};

export const getActiveEntries = async (): Promise<Entry[]> => {
  const db = await getDB();
  const allEntries = await db.getAll('entries');
  return allEntries.filter((e) => e.isRunning === true);
};

// --- Settings ---
export const getSettings = async (): Promise<Settings | undefined> => {
  const db = await getDB();
  return db.get('settings', 'user-settings');
};

export const putSettings = async (settings: Settings): Promise<string> => {
  const db = await getDB();
  return db.put('settings', settings);
};

// --- Import / Backup ---
export const importBackup = async (
  data: { groups: Group[]; timecodes: Timecode[]; entries: Entry[]; settings?: Settings },
  mode: 'merge' | 'replace'
): Promise<void> => {
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

  if (data.settings && mode === 'replace') {
    const settingsStore = tx.objectStore('settings');
    await settingsStore.put(data.settings);
  }

  await tx.done;
};
