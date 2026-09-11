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
 *  - 'database-from-newer-build' is the same predicament reached without any
 *    second tab: this build asks for a version older than the one already on
 *    disk, and IndexedDB refuses with `VersionError`. A rolled-back deploy is
 *    how that happens — the user loaded the newer build once, so their store
 *    is ahead of the code now being served, and every load stays that way
 *    until the newer build returns. There is no downgrade migration and there
 *    cannot cheaply be one; what matters is that the refusal is not mistaken
 *    for a broken database.
 *
 * `blocking` is the half that only pays off next time: on the deploy that
 * introduces it, the tab that has to yield is running the *previous* build,
 * which has no such handler. It is here so the version after this one does not
 * repeat the whole problem.
 */
export type ConnectionBlock =
  | 'blocked-by-older-tab'
  | 'superseded-by-newer-tab'
  | 'database-from-newer-build';

let connectionBlock: ConnectionBlock | null = null;

export const getConnectionBlock = (): ConnectionBlock | null => connectionBlock;

/**
 * What each state tells the user, written to be shown verbatim.
 *
 * Exported because the banner shows the same sentence the refused write
 * reports, and a third state was added to this union while the banner was
 * still choosing between two with a ternary — so the new case silently
 * rendered the wrong explanation. One source, and adding a state to the union
 * is a type error until every consumer handles it.
 */
export const BLOCK_MESSAGES: Record<ConnectionBlock, string> = {
  'blocked-by-older-tab':
    'Another TimeDoco tab is open on an older version and is holding your database. ' +
    'Close the other tab, then reload this one. Nothing has been lost.',
  'superseded-by-newer-tab':
    'TimeDoco was updated in another tab, which now owns your database. ' +
    'Reload this tab to catch up. Nothing has been lost.',
  'database-from-newer-build':
    'Your saved data was last used with a newer version of TimeDoco than the one loaded here, ' +
    'so this version cannot open it. Reload to pick up the current version. Nothing has been lost.',
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

/**
 * Whether an open failed because the store on disk is newer than this build.
 *
 * A rolled-back deploy is the ordinary way to reach it: the user loaded the
 * newer build once, their database was upgraded, and the code now being served
 * asks for the older version. IndexedDB reports that as `VersionError`.
 */
const isVersionRefusal = (error: unknown): boolean =>
  (error as { name?: string } | null)?.name === 'VersionError';

export const getDB = async () => {
  try {
    return await initDB();
  } catch (error) {
    // A version refusal is not a database this app cannot use — it is a
    // database this *build* cannot use, and the data in it is untouched.
    // Falling back to memory here rendered a complete, empty tracker: the user
    // is shown every entry gone, and anything they retype into it is discarded
    // when the tab closes. It belongs with the two-tab standoffs above, which
    // is the same predicament arrived at a different way.
    if (isVersionRefusal(error)) {
      setConnectionBlock('database-from-newer-build');
      throw new UserFacingError(BLOCK_MESSAGES['database-from-newer-build']);
    }
    // Every other failure to open really is a database this app cannot use.
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
    // Re-asked, because the open that just failed may have been a version
    // refusal — which `getDB` records as a block rather than as fallback mode.
    // Answering that from the in-memory store is the thing this whole file is
    // written to avoid: an empty app, taking writes it will throw away, over a
    // database that is intact and one reload from being readable.
    assertConnectionUsable();
    // Otherwise getDB has entered fallback mode and logged the cause.
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

/**
 * A settings record addressed at the one key this store uses.
 *
 * `settings` has an in-line key of `id`, so a record arriving from a file
 * without one cannot be written at all: `put` throws `DataError`. In replace
 * mode that throw lands *after* the four `clear()` calls, and because it escapes
 * before `tx.done` is awaited nothing aborts the transaction — the clears
 * commit. The user is shown a failed import and has lost their rounding rule,
 * currency, tax setup, preparer details, logo, footer and templates.
 *
 * `validateBackupPayload` permits the shape that does this: it rejects an `id`
 * that is present and wrong, and allows one that is absent or null. The
 * in-memory fallback path has always normalised here; the IndexedDB path did
 * not, which is the same one-path-fixed-not-its-sibling split `mergeSettings`
 * exists to prevent. Normalising is also what makes the permissive validator
 * correct rather than merely lenient — a backup is addressed to this store, and
 * this store has exactly one row.
 */
const atSettingsKey = (settings: Settings): Settings => ({ ...settings, id: SETTINGS_KEY });

/** A record's change stamp as an epoch time, or NaN when there isn't a readable one. */
const stampOf = (record: { updatedAt?: string | null }): number =>
  record.updatedAt ? new Date(record.updatedAt).getTime() : NaN;

/** Whether a record carries a change stamp anything can be concluded from. */
const hasReadableStamp = (record: { updatedAt?: string | null }): boolean =>
  Number.isFinite(stampOf(record));

/**
 * Whether an incoming record should replace the one already stored.
 *
 * Merge mode resolves every conflict on `updatedAt`, and nothing validates that
 * field — `validateBackupPayload` does not mention it — so both sides of this
 * comparison can be missing or unparseable. Written as a bare
 * `new Date(incoming.updatedAt) > new Date(existing.updatedAt)` that produced
 * NaN, and NaN loses every comparison it is in, which broke the rule in two
 * different directions at once:
 *
 *  - An incoming record with no readable stamp always lost, so it was dropped.
 *    That is the defensible half — nothing can show it is newer — but it was
 *    silent, and the import still reported success. `undatedSkipped` is what
 *    makes it audible.
 *  - A *stored* record with no readable stamp also always won, so no import
 *    could ever replace it. Restoring a good backup over a corrupted record
 *    quietly did nothing, which is the opposite of what a restore is for.
 *
 * `mergeSettings` already had this right and this is its rule, lifted out so
 * groups, timecodes and entries cannot drift from settings again: incoming wins
 * when it can be dated and either the stored copy cannot be, or it is older.
 */
const incomingIsNewer = (
  incoming: { updatedAt?: string | null },
  existing: { updatedAt?: string | null },
): boolean => {
  const incomingAt = stampOf(incoming);
  const existingAt = stampOf(existing);
  return Number.isFinite(incomingAt) && (!Number.isFinite(existingAt) || incomingAt > existingAt);
};

/**
 * What an import did that the user would not otherwise find out about.
 *
 * `undatedSkipped` counts records left alone *only* because their own change
 * stamp could not be read — not the ones a newer local copy legitimately beat,
 * which is merge working as intended and not worth saying. The distinction
 * matters: the first is unresolvable and the user has to decide what to do
 * about it, the second is the answer they asked for.
 */
export interface ImportOutcome {
  undatedSkipped: number;
}

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

  // The shared rule, which used to be spelled out here and nowhere else.
  return incomingIsNewer(incoming, existing)
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
): Promise<ImportOutcome> => {
  assertConnectionUsable();
  // Only ever incremented in merge mode: replace writes every record
  // unconditionally, so nothing is resolved and nothing can be skipped.
  let undatedSkipped = 0;
  if (isFallbackMode) {
    if (mode === 'replace') {
      clearFallbackMemory();
    }
    // The same three rules as the IndexedDB path below. They were written out
    // twice and the pair has drifted before, which is why the comparison itself
    // now lives in one function rather than in six expressions.
    data.groups.forEach(g => {
      if (mode === 'merge') {
        const existing = fallbackMemoryDB.groups.get(g.id);
        if (!existing || incomingIsNewer(g, existing)) fallbackMemoryDB.groups.set(g.id, g);
        else if (!hasReadableStamp(g)) undatedSkipped++;
      } else {
        fallbackMemoryDB.groups.set(g.id, g);
      }
    });
    data.timecodes.forEach(tc => {
      if (mode === 'merge') {
        const existing = fallbackMemoryDB.timecodes.get(tc.id);
        if (!existing || incomingIsNewer(tc, existing)) fallbackMemoryDB.timecodes.set(tc.id, tc);
        else if (!hasReadableStamp(tc)) undatedSkipped++;
      } else {
        fallbackMemoryDB.timecodes.set(tc.id, tc);
      }
    });
    data.entries.forEach(e => {
      if (mode === 'merge') {
        const existing = fallbackMemoryDB.entries.get(e.id);
        if (!existing || incomingIsNewer(e, existing)) fallbackMemoryDB.entries.set(e.id, e);
        else if (!hasReadableStamp(e)) undatedSkipped++;
      } else {
        fallbackMemoryDB.entries.set(e.id, e);
      }
    });
    if (data.settings) {
      if (mode === 'replace') {
        fallbackMemoryDB.settings.set(SETTINGS_KEY, atSettingsKey(data.settings));
      } else if (mode === 'merge') {
        const existingSettings = fallbackMemoryDB.settings.get(SETTINGS_KEY);
        // Normalised on this branch too. A Map takes the key it is given, so an
        // unnormalised record was readable here — right up until it was exported
        // and imported into a database, where the id is the key.
        fallbackMemoryDB.settings.set(
          SETTINGS_KEY,
          atSettingsKey(existingSettings ? mergeSettings(existingSettings, data.settings) : data.settings),
        );
      }
    }
    return { undatedSkipped };
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
      // No stored copy means no conflict to resolve, so an undated record is
      // still written — it is only ever a tie-break that needs a stamp.
      if (!existing || incomingIsNewer(g, existing)) {
        await groupStore.put(g);
      } else if (!hasReadableStamp(g)) {
        undatedSkipped++;
      }
    } else {
      await groupStore.put(g);
    }
  }

  const tcStore = tx.objectStore('timecodes');
  for (const tc of data.timecodes) {
    if (mode === 'merge') {
      const existing = await tcStore.get(tc.id);
      if (!existing || incomingIsNewer(tc, existing)) {
        await tcStore.put(tc);
      } else if (!hasReadableStamp(tc)) {
        undatedSkipped++;
      }
    } else {
      await tcStore.put(tc);
    }
  }

  const entryStore = tx.objectStore('entries');
  for (const e of data.entries) {
    if (mode === 'merge') {
      const existing = await entryStore.get(e.id);
      if (!existing || incomingIsNewer(e, existing)) {
        await entryStore.put(e);
      } else if (!hasReadableStamp(e)) {
        undatedSkipped++;
      }
    } else {
      await entryStore.put(e);
    }
  }

  if (data.settings) {
    const settingsStore = tx.objectStore('settings');
    if (mode === 'replace') {
      await settingsStore.put(atSettingsKey(data.settings));
    } else if (mode === 'merge') {
      const existingSettings = await settingsStore.get(SETTINGS_KEY);
      await settingsStore.put(
        atSettingsKey(
          existingSettings ? mergeSettings(existingSettings, data.settings) : data.settings
        )
      );
    }
  }

  await tx.done;
  // Reported after the commit: a count of what an import skipped is only true
  // if the transaction it was skipped from actually landed.
  return { undatedSkipped };
};
