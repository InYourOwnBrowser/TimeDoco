import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB, deleteDB } from 'idb';

/**
 * A deploy rolled back after users have already loaded it.
 *
 * The sibling of `upgradeBlocked`, reached without a second tab. A user opens
 * the new build once and their database is upgraded; the deploy is then
 * reverted, and every load from that point asks for a version older than the
 * one on disk. IndexedDB refuses with `VersionError`, and there is no downgrade
 * migration — nor cheaply can there be one.
 *
 * What must not happen is the refusal being read as a broken database. That
 * path entered the in-memory fallback, which renders a complete and entirely
 * empty tracker: the user is shown every entry gone, and anything they retype
 * into it is discarded when the tab closes — over a store that is intact and
 * one deploy away from being readable. "Roll it back if production looks
 * wrong" is the normal contingency, so this is the normal way to reach it.
 */

const DB_NAME = 'time-tracker-db';

/** A database the *newer* build has already upgraded, with the user's work in it. */
const seedAtNewerVersion = async () => {
  const db = await openDB(DB_NAME, 99, {
    upgrade(db) {
      db.createObjectStore('groups', { keyPath: 'id' });
      db.createObjectStore('timecodes', { keyPath: 'id' });
      db.createObjectStore('entries', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'id' });
    },
  });
  await db.put('groups', {
    id: 'g-1', name: 'Acme', color: '#123456', archived: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  db.close();
};

const entry = () => ({
  id: 'e-1', timecodeId: 'tc-1',
  startTime: '2026-02-01T09:00:00.000Z', endTime: null,
  duration: 0, note: 'retyped after the app looked empty', tags: [],
  isRunning: true, isPaused: false, pausedSegments: [], editHistory: [],
  createdAt: '2026-02-01T09:00:00.000Z', updatedAt: '2026-02-01T09:00:00.000Z',
});

describe('a build older than the database already on disk', () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteDB(DB_NAME);
    await seedAtNewerVersion();
  });

  afterEach(async () => {
    const mod = await import('./index');
    await mod.closeDB();
    await deleteDB(DB_NAME);
  });

  it('says the data is from a newer version rather than reporting a storage error', async () => {
    const mod = await import('./index');

    await expect(mod.getGroups()).rejects.toThrow(/newer version of TimeDoco/);
    expect(mod.getConnectionBlock()).toBe('database-from-newer-build');

    // Emphatically not fallback mode: that banner tells the user their data
    // will not be saved, which invites them to abandon a database that is fine.
    expect(mod.getIsFallbackMode()).toBe(false);
  });

  it('refuses a write instead of taking it into a store that is thrown away', async () => {
    const mod = await import('./index');
    await expect(mod.getGroups()).rejects.toThrow();

    await expect(mod.putEntry(entry() as never)).rejects.toThrow(/newer version of TimeDoco/);
    expect(mod.getIsFallbackMode()).toBe(false);
  });

  it('refuses the destructive paths too, which do not go through withDB', async () => {
    const mod = await import('./index');
    await expect(mod.getGroups()).rejects.toThrow();

    await expect(mod.wipeAllData()).rejects.toThrow(/newer version of TimeDoco/);
    await expect(
      mod.importBackup({ groups: [], timecodes: [], entries: [] }, 'replace'),
    ).rejects.toThrow(/newer version of TimeDoco/);
  });

  it('leaves the stored data untouched, which is the whole claim the message makes', async () => {
    const mod = await import('./index');
    await expect(mod.getGroups()).rejects.toThrow();
    await expect(mod.putEntry(entry() as never)).rejects.toThrow();

    // Read back the way the newer build would, once it is redeployed.
    const db = await openDB(DB_NAME, 99);
    expect(await db.getAll('groups')).toHaveLength(1);
    expect(await db.getAll('entries')).toEqual([]);
    db.close();
  });
});
