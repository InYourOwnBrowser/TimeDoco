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
      'is-running': string;
    };
  };
  settings: {
    key: string;
    value: Settings;
  };
}

const DB_NAME = 'time-tracker-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TimeTrackerDB>> | null = null;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<TimeTrackerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
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
          entryStore.createIndex('is-running', 'isRunning');
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

export const getActiveEntry = async (): Promise<Entry | undefined> => {
  const db = await getDB();
  // idb supports indexing by boolean, but sometimes we need to check carefully
  // The 'is-running' index will map true/false. Since we are looking for isRunning: true
  // Let's use index and fallback if IDB behaves weirdly with booleans.
  // We can just iterate or fetch all running.

  // Actually, boolean keys in IDB indexes are valid in modern browsers, but can be tricky.
  // A safer approach: fetch all and filter, or just use getAll and filter since running entries should be 1.
  const allEntries = await db.getAll('entries');
  return allEntries.find((e) => e.isRunning === true);
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
