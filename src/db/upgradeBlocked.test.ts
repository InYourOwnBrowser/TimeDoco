import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDB, deleteDB, type IDBPDatabase } from 'idb';

/**
 * A version bump landing on a user who has two tabs open.
 *
 * The deploy that took the database from 2 to 3 is the first one where this
 * matters, and it is invisible to every other test in the suite because they
 * all open a single connection. IndexedDB will not upgrade while a connection
 * to the old version is open, and `openDB` does not reject when that happens —
 * it simply never settles. Unhandled, that made the new tab await a promise
 * with no outcome on every read and every write: nothing threw, so
 * `refreshData`'s catch never ran, fallback mode was never entered, and the app
 * rendered a complete and entirely empty tracker that silently stored nothing.
 *
 * The contract these lock down is that neither tab is left guessing: the one
 * that needs the upgrade says so and refuses work rather than hanging, the one
 * in the way gets out of it, and the first recovers on its own once it can.
 */

const DB_NAME = 'time-tracker-db';

/** The schema as version 2 shipped it — what a user on the live build holds. */
const openV2 = async (): Promise<IDBPDatabase> => {
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
  await db.put('groups', {
    id: 'g-1', name: 'Acme', color: '#123456', archived: false,
    updatedAt: '2024-01-01T00:00:00.000Z',
  });
  return db;
};

const runningEntry = () => ({
  id: 'e-new', timecodeId: 'tc-1',
  startTime: '2024-02-01T09:00:00.000Z', endTime: null,
  duration: 0, note: 'work done after the deploy', tags: [],
  isRunning: true, isPaused: false, pausedSegments: [], editHistory: [],
  createdAt: '2024-02-01T09:00:00.000Z', updatedAt: '2024-02-01T09:00:00.000Z',
});

/** Resolves to how a promise ended, or 'pending' if it did not end at all. */
const settle = (promise: Promise<unknown>, ms = 300) =>
  Promise.race([
    promise.then(() => 'resolved' as const, () => 'rejected' as const),
    new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms)),
  ]);

describe('a version bump arriving while another tab holds the old version', () => {
  /** The other tab: the live build, still holding its v2 connection open. */
  let otherTab: IDBPDatabase | null = null;

  beforeEach(async () => {
    vi.resetModules();
    await deleteDB(DB_NAME);
  });

  afterEach(async () => {
    try { otherTab?.close(); } catch { /* already closed */ }
    otherTab = null;
    const mod = await import('./index');
    await mod.resetDBForTests();
    await deleteDB(DB_NAME);
  });

  it('announces the standoff rather than waiting on a promise that never settles', async () => {
    otherTab = await openV2();
    const mod = await import('./index');

    const blocked = vi.fn();
    window.addEventListener('idb-connection-blocked', blocked);

    await settle(mod.getGroups());

    expect(blocked).toHaveBeenCalled();
    expect(mod.getConnectionBlock()).toBe('blocked-by-older-tab');
    window.removeEventListener('idb-connection-blocked', blocked);
  });

  it('refuses a read with a sentence written for the user', async () => {
    otherTab = await openV2();
    const mod = await import('./index');
    await settle(mod.getGroups());

    // Rejects, rather than hanging — which is what the app renders an empty
    // tracker off — and rather than resolving from the in-memory store, which
    // would look exactly like total data loss.
    await expect(mod.getGroups()).rejects.toThrow(/Another TimeDoco tab is open on an older version/);
  });

  it('refuses a write, so tracked time is never silently dropped', async () => {
    otherTab = await openV2();
    const mod = await import('./index');
    await settle(mod.getGroups());

    // The failure the mutation wrappers turn into a toast. Hanging here meant a
    // start-timer button that did nothing at all.
    await expect(mod.putEntry(runningEntry() as never)).rejects.toThrow(/Close the other tab/);
  });

  it('refuses the destructive paths too, which do not go through withDB', async () => {
    otherTab = await openV2();
    const mod = await import('./index');
    await settle(mod.getGroups());

    await expect(mod.wipeAllData()).rejects.toThrow(/older version/);
    await expect(
      mod.importBackup({ groups: [], timecodes: [], entries: [] }, 'replace'),
    ).rejects.toThrow(/older version/);
  });

  it('recovers on its own once the other tab closes, and says so', async () => {
    otherTab = await openV2();
    const mod = await import('./index');

    const read = mod.getGroups().catch(() => 'refused');
    await settle(read);
    expect(mod.getConnectionBlock()).toBe('blocked-by-older-tab');

    const unblocked = vi.fn();
    window.addEventListener('idb-connection-unblocked', unblocked);

    // The user does what the banner asked.
    otherTab.close();
    otherTab = null;

    // The upgrade IndexedDB was holding back now runs, and the same pending
    // open resolves — there is nothing to retry.
    const db = await mod.initDB();
    expect(db.version).toBe(3);
    expect(mod.getConnectionBlock()).toBeNull();
    expect(unblocked).toHaveBeenCalled();

    // And the data was never in danger: it is all still there.
    expect((await mod.getGroups()).map((g) => g.id)).toEqual(['g-1']);
    window.removeEventListener('idb-connection-unblocked', unblocked);
  });

  it('gets out of the way when it is the tab holding an older version open', async () => {
    // This tab opens first, at the current version.
    const mod = await import('./index');
    expect((await mod.initDB()).version).toBe(3);

    const superseded = vi.fn();
    window.addEventListener('idb-connection-blocked', superseded);

    // A newer build, in another tab, wants a version this one has never heard
    // of. On the deploy that introduces `blocking` the tab in the way is the
    // *previous* build and has no such handler, so this is the half that pays
    // off on the version after — which is exactly why it is tested now.
    const newerTab = await openDB(DB_NAME, 4, { upgrade() { /* whatever v4 does */ } });

    expect(superseded).toHaveBeenCalled();
    expect(mod.getConnectionBlock()).toBe('superseded-by-newer-tab');
    // The upgrade got through, which it could not have done had this tab held on.
    expect(newerTab.version).toBe(4);

    // And this tab refuses work against a database it no longer owns rather
    // than erroring somewhere further in.
    await expect(mod.getGroups()).rejects.toThrow(/updated in another tab/);

    newerTab.close();
    window.removeEventListener('idb-connection-blocked', superseded);
  });
});
