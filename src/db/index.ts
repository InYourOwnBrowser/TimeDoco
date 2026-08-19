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

export const closeDB = async () => {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
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
  try {
    return await initDB();
  } catch (error) {
    triggerFallbackMode(error);
    throw error;
  }
};

// --- Groups ---
export const getGroups = async (): Promise<Group[]> => {
  if (isFallbackMode) return Array.from(fallbackMemoryDB.groups.values());
  try {
    const db = await getDB();
    return await db.getAll('groups');
  } catch (error) {
    triggerFallbackMode(error);
    return Array.from(fallbackMemoryDB.groups.values());
  }
};

export const getGroup = async (id: string): Promise<Group | undefined> => {
  if (isFallbackMode) return fallbackMemoryDB.groups.get(id);
  try {
    const db = await getDB();
    return await db.get('groups', id);
  } catch (error) {
    triggerFallbackMode(error);
    return fallbackMemoryDB.groups.get(id);
  }
};

export const putGroup = async (group: Group): Promise<string> => {
  if (isFallbackMode) {
    fallbackMemoryDB.groups.set(group.id, group);
    return group.id;
  }
  try {
    const db = await getDB();
    return await db.put('groups', group);
  } catch (error) {
    triggerFallbackMode(error);
    fallbackMemoryDB.groups.set(group.id, group);
    return group.id;
  }
};

export const deleteGroup = async (id: string): Promise<void> => {
  if (isFallbackMode) {
    fallbackMemoryDB.groups.delete(id);
    return;
  }
  try {
    const db = await getDB();
    return await db.delete('groups', id);
  } catch (error) {
    triggerFallbackMode(error);
    fallbackMemoryDB.groups.delete(id);
  }
};

// --- Timecodes ---
export const getTimecodes = async (): Promise<Timecode[]> => {
  if (isFallbackMode) return Array.from(fallbackMemoryDB.timecodes.values());
  try {
    const db = await getDB();
    return await db.getAll('timecodes');
  } catch (error) {
    triggerFallbackMode(error);
    return Array.from(fallbackMemoryDB.timecodes.values());
  }
};

export const getTimecode = async (id: string): Promise<Timecode | undefined> => {
  if (isFallbackMode) return fallbackMemoryDB.timecodes.get(id);
  try {
    const db = await getDB();
    return await db.get('timecodes', id);
  } catch (error) {
    triggerFallbackMode(error);
    return fallbackMemoryDB.timecodes.get(id);
  }
};

export const putTimecode = async (timecode: Timecode): Promise<string> => {
  if (isFallbackMode) {
    fallbackMemoryDB.timecodes.set(timecode.id, timecode);
    return timecode.id;
  }
  try {
    const db = await getDB();
    return await db.put('timecodes', timecode);
  } catch (error) {
    triggerFallbackMode(error);
    fallbackMemoryDB.timecodes.set(timecode.id, timecode);
    return timecode.id;
  }
};

export const deleteTimecode = async (id: string): Promise<void> => {
  if (isFallbackMode) {
    fallbackMemoryDB.timecodes.delete(id);
    return;
  }
  try {
    const db = await getDB();
    return await db.delete('timecodes', id);
  } catch (error) {
    triggerFallbackMode(error);
    fallbackMemoryDB.timecodes.delete(id);
  }
};

// --- Entries ---
export const getEntries = async (): Promise<Entry[]> => {
  if (isFallbackMode) return Array.from(fallbackMemoryDB.entries.values());
  try {
    const db = await getDB();
    return await db.getAll('entries');
  } catch (error) {
    triggerFallbackMode(error);
    return Array.from(fallbackMemoryDB.entries.values());
  }
};

export const getEntry = async (id: string): Promise<Entry | undefined> => {
  if (isFallbackMode) return fallbackMemoryDB.entries.get(id);
  try {
    const db = await getDB();
    return await db.get('entries', id);
  } catch (error) {
    triggerFallbackMode(error);
    return fallbackMemoryDB.entries.get(id);
  }
};

export const putEntry = async (entry: Entry): Promise<string> => {
  if (isFallbackMode) {
    fallbackMemoryDB.entries.set(entry.id, entry);
    return entry.id;
  }
  try {
    const db = await getDB();
    return await db.put('entries', entry);
  } catch (error) {
    triggerFallbackMode(error);
    fallbackMemoryDB.entries.set(entry.id, entry);
    return entry.id;
  }
};

export const deleteEntry = async (id: string): Promise<void> => {
  if (isFallbackMode) {
    fallbackMemoryDB.entries.delete(id);
    return;
  }
  try {
    const db = await getDB();
    return await db.delete('entries', id);
  } catch (error) {
    triggerFallbackMode(error);
    fallbackMemoryDB.entries.delete(id);
  }
};

export const getActiveEntry = async (): Promise<Entry | undefined> => {
  if (isFallbackMode) {
    return Array.from(fallbackMemoryDB.entries.values()).find((e) => e.isRunning === true && !e.deletedAt);
  }
  try {
    const db = await getDB();
    const allEntries = await db.getAll('entries');
    return allEntries.find((e) => e.isRunning === true && !e.deletedAt);
  } catch (error) {
    triggerFallbackMode(error);
    return Array.from(fallbackMemoryDB.entries.values()).find((e) => e.isRunning === true && !e.deletedAt);
  }
};

export const getActiveEntries = async (): Promise<Entry[]> => {
  if (isFallbackMode) {
    return Array.from(fallbackMemoryDB.entries.values()).filter((e) => e.isRunning === true && !e.deletedAt);
  }
  try {
    const db = await getDB();
    const allEntries = await db.getAll('entries');
    return allEntries.filter((e) => e.isRunning === true && !e.deletedAt);
  } catch (error) {
    triggerFallbackMode(error);
    return Array.from(fallbackMemoryDB.entries.values()).filter((e) => e.isRunning === true && !e.deletedAt);
  }
};

// --- Settings ---
export const getSettings = async (): Promise<Settings | undefined> => {
  if (isFallbackMode) return fallbackMemoryDB.settings.get('user-settings');
  try {
    const db = await getDB();
    return await db.get('settings', 'user-settings');
  } catch (error) {
    triggerFallbackMode(error);
    return fallbackMemoryDB.settings.get('user-settings');
  }
};

export const putSettings = async (settings: Settings): Promise<string> => {
  if (isFallbackMode) {
    fallbackMemoryDB.settings.set(settings.id, settings);
    return settings.id;
  }
  try {
    const db = await getDB();
    return await db.put('settings', settings);
  } catch (error) {
    triggerFallbackMode(error);
    fallbackMemoryDB.settings.set(settings.id, settings);
    return settings.id;
  }
};

export const wipeAllData = async (): Promise<void> => {
  if (isFallbackMode) {
    fallbackMemoryDB.groups.clear();
    fallbackMemoryDB.timecodes.clear();
    fallbackMemoryDB.entries.clear();
    fallbackMemoryDB.settings.clear();
    return;
  }
  try {
    const db = await getDB();
    const tx = db.transaction(['groups', 'timecodes', 'entries', 'settings'], 'readwrite');
    await tx.objectStore('groups').clear();
    await tx.objectStore('timecodes').clear();
    await tx.objectStore('entries').clear();
    await tx.objectStore('settings').clear();
    await tx.done;
  } catch (error) {
    triggerFallbackMode(error);
    fallbackMemoryDB.groups.clear();
    fallbackMemoryDB.timecodes.clear();
    fallbackMemoryDB.entries.clear();
    fallbackMemoryDB.settings.clear();
    throw error;
  }
};

// --- Import / Backup ---
export const importBackup = async (
  data: { groups: Group[]; timecodes: Timecode[]; entries: Entry[]; settings?: Settings },
  mode: 'merge' | 'replace'
): Promise<void> => {
  if (isFallbackMode) {
    if (mode === 'replace') {
      fallbackMemoryDB.groups.clear();
      fallbackMemoryDB.timecodes.clear();
      fallbackMemoryDB.entries.clear();
      fallbackMemoryDB.settings.clear();
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

  try {
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
  } catch (error) {
    triggerFallbackMode(error);
    throw error;
  }
};
