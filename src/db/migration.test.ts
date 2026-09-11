import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB, deleteDB } from 'idb';
import type { Entry, Group, Settings, Timecode } from '../types';

/**
 * Upgrading a real user's database in place.
 *
 * `migrateImportData` covers a backup file arriving from an older version;
 * nothing covered the store the user already has. That upgrade runs on the
 * first load after a deploy, and a failure in it is total loss for that user —
 * there is no server copy. It is also the one piece of code that becomes
 * impossible to retrofit a test for, because once v1 and v2 databases exist in
 * the wild the fixtures have to be guessed rather than written.
 *
 * Each test builds a database at the old version with that version's real
 * schema, then opens it through the app's own `initDB` and checks both the
 * schema and every record.
 */

const DB_NAME = 'time-tracker-db';

const group = (over: Partial<Group> = {}): Group => ({
  id: 'g-1',
  name: 'Acme Corp',
  color: '#123456',
  archived: false,
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

const timecode = (over: Partial<Timecode> = {}): Timecode => ({
  id: 'tc-1',
  name: 'Development',
  groupId: 'g-1',
  color: '#123456',
  hourlyRate: 120,
  archived: false,
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...over,
});

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e-1',
  timecodeId: 'tc-1',
  startTime: '2024-01-02T09:00:00.000Z',
  endTime: '2024-01-02T11:30:00.000Z',
  duration: 9000,
  note: 'Auth flow',
  tags: ['billable'],
  isRunning: false,
  isPaused: false,
  pausedSegments: [],
  editHistory: [],
  createdAt: '2024-01-02T09:00:00.000Z',
  updatedAt: '2024-01-02T11:30:00.000Z',
  ...over,
});

const settings = (): Settings => ({
  id: 'user-settings',
  lastBackupDate: '2024-01-01T00:00:00.000Z',
  reminderIntervalDays: 7,
  roundingRule: '15min',
  idleThresholdMinutes: 10,
  weeklyTargetHours: 40,
  allowConcurrentTimers: false,
  currencySymbol: '£',
  preparerName: 'A Freelancer',
});

/** A stopped entry, a running one, and one that spans midnight. */
const SEED_ENTRIES = [
  entry(),
  entry({ id: 'e-2', startTime: '2024-01-03T22:00:00.000Z', endTime: '2024-01-04T01:00:00.000Z', duration: 10800, note: 'Overnight' }),
  entry({ id: 'e-3', startTime: '2024-01-05T08:00:00.000Z', endTime: null, duration: 0, isRunning: true, note: 'Still going' }),
];

const seed = async (db: any) => {
  await db.put('groups', group());
  await db.put('timecodes', timecode());
  await db.put('timecodes', timecode({ id: 'tc-2', name: 'Design', groupId: null, hourlyRate: null }));
  for (const e of SEED_ENTRIES) await db.put('entries', e);
  await db.put('settings', settings());
};

/** The schema as version 1 actually shipped it, boolean index and all. */
const createV1 = async () => {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('groups', { keyPath: 'id' });
      const timecodes = db.createObjectStore('timecodes', { keyPath: 'id' });
      timecodes.createIndex('by-group', 'groupId');
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('by-timecode', 'timecodeId');
      // v1's mistake: IndexedDB cannot key on a boolean, so this index never
      // matched anything. v2 removes it.
      entries.createIndex('is-running', 'isRunning');
      db.createObjectStore('settings', { keyPath: 'id' });
    },
  });
  await seed(db);
  db.close();
};

/** v2: the boolean index gone, `by-start-time` not yet added. */
const createV2 = async () => {
  const db = await openDB(DB_NAME, 2, {
    upgrade(db) {
      db.createObjectStore('groups', { keyPath: 'id' });
      const timecodes = db.createObjectStore('timecodes', { keyPath: 'id' });
      timecodes.createIndex('by-group', 'groupId');
      const entries = db.createObjectStore('entries', { keyPath: 'id' });
      entries.createIndex('by-timecode', 'timecodeId');
      db.createObjectStore('settings', { keyPath: 'id' });
    },
  });
  await seed(db);
  db.close();
};

const openThroughTheApp = async () => {
  const mod = await import('./index');
  const db = await mod.initDB();
  return { mod, db };
};

const indexNamesOf = (db: any, store: string): string[] => {
  // Read-only, so it completes on its own. Aborting it leaves idb's `done`
  // promise rejected with nobody to catch it.
  const tx = db.transaction(store);
  return (Array.from(tx.objectStore(store).indexNames) as string[]).sort();
};

describe('in-place schema upgrades', () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteDB(DB_NAME);
  });

  afterEach(async () => {
    const mod = await import('./index');
    await mod.closeDB();
    await deleteDB(DB_NAME);
  });

  describe.each([
    ['v1', createV1],
    ['v2', createV2],
  ])('from %s', (_label, create) => {
    it('reaches the current version', async () => {
      await create();
      const { db } = await openThroughTheApp();
      expect(db.version).toBe(3);
    });

    it('ends with exactly the indexes the current schema declares', async () => {
      await create();
      const { db } = await openThroughTheApp();

      // The boolean index is gone, and the one reads depend on is present.
      expect(indexNamesOf(db, 'entries')).toEqual(['by-start-time', 'by-timecode']);
      expect(indexNamesOf(db, 'timecodes')).toEqual(['by-group']);
    });

    it('keeps every record, field for field', async () => {
      await create();
      const { mod } = await openThroughTheApp();

      expect(await mod.getGroups()).toEqual([group()]);
      expect((await mod.getTimecodes()).map((t) => t.id).sort()).toEqual(['tc-1', 'tc-2']);
      expect(await mod.getSettings()).toEqual(settings());

      const entries = await mod.getEntries();
      expect(entries).toHaveLength(3);
      // Oldest first, and the running entry still reads as running.
      expect(entries.map((e) => e.id)).toEqual(['e-1', 'e-2', 'e-3']);
      expect(entries[0]).toEqual(SEED_ENTRIES[0]);
      expect(entries[2].endTime).toBeNull();
    });

    it('leaves the running timer findable, which the dead index never made it', async () => {
      await create();
      const { mod } = await openThroughTheApp();

      const active = await mod.getActiveEntries();
      expect(active.map((e) => e.id)).toEqual(['e-3']);
      expect((await mod.getActiveEntry())?.id).toBe('e-3');
    });

    it('accepts writes after the upgrade, and re-reads them', async () => {
      await create();
      const { mod } = await openThroughTheApp();

      const added = entry({ id: 'e-4', startTime: '2024-01-06T09:00:00.000Z', endTime: '2024-01-06T10:00:00.000Z', duration: 3600 });
      await mod.putEntry(added);
      expect(await mod.getEntry('e-4')).toEqual(added);
      expect((await mod.getEntries()).map((e) => e.id)).toEqual(['e-1', 'e-2', 'e-3', 'e-4']);
    });

    it('is idempotent — reopening at the current version changes nothing', async () => {
      await create();
      const first = await openThroughTheApp();
      const before = await first.mod.getEntries();
      await first.mod.closeDB();

      vi.resetModules();
      const second = await openThroughTheApp();
      expect(second.db.version).toBe(3);
      expect(indexNamesOf(second.db, 'entries')).toEqual(['by-start-time', 'by-timecode']);
      expect(await second.mod.getEntries()).toEqual(before);
    });
  });

  it('creates a complete schema for a first-time user', async () => {
    const { db } = await openThroughTheApp();

    expect(db.version).toBe(3);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['entries', 'groups', 'settings', 'timecodes']);
    expect(indexNamesOf(db, 'entries')).toEqual(['by-start-time', 'by-timecode']);
    expect(indexNamesOf(db, 'timecodes')).toEqual(['by-group']);
  });

  it('does not fall back to memory when an upgrade is all it has to do', async () => {
    await createV1();
    const { mod } = await openThroughTheApp();

    // A silent fallback would look like a working app that has lost the user's
    // history, which is the worst possible way for this to fail.
    expect(mod.getIsFallbackMode()).toBe(false);
    expect(await mod.getEntries()).toHaveLength(3);
  });
});
