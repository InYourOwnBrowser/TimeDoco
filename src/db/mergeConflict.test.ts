import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deleteDB } from 'idb';
import type { Entry, Group, Settings } from '../types';

/**
 * How merge mode decides between a record in the file and the one already here.
 *
 * The rule is `updatedAt`, and nothing validates that field — it does not
 * appear in `validateBackupPayload` at all — so both sides of the comparison
 * can arrive missing or unparseable. Written as a bare `new Date(a) >
 * new Date(b)` that produced NaN, and NaN loses every comparison, which broke
 * the rule in both directions: an undated record in the file always lost and
 * was dropped in silence, and an undated record *already stored* always won, so
 * no import could ever replace it.
 *
 * `mergeSettings` had this right on its own. These cover the three stores that
 * did not, and the reporting that makes the remaining skip audible.
 */

const DB_NAME = 'time-tracker-db';

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e-1', timecodeId: 'tc-1',
  startTime: '2024-01-02T09:00:00.000Z', endTime: '2024-01-02T11:30:00.000Z',
  duration: 9000, note: 'local', tags: [], isRunning: false, isPaused: false,
  pausedSegments: [], editHistory: [],
  createdAt: '2024-01-02T09:00:00.000Z', updatedAt: '2024-01-02T11:30:00.000Z',
  ...over,
});

const group = (over: Partial<Group> = {}): Group => ({
  id: 'g-1', name: 'local', color: '#123456', archived: false,
  updatedAt: '2024-01-02T11:30:00.000Z',
  ...over,
});

const importOf = (over: { groups?: Group[]; entries?: Entry[] }) => ({
  groups: over.groups ?? [], timecodes: [], entries: over.entries ?? [],
});

describe('merge-mode conflict resolution on updatedAt', () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteDB(DB_NAME);
  });

  afterEach(async () => {
    const mod = await import('./index');
    await mod.resetDBForTests();
    await deleteDB(DB_NAME);
  });

  it('still lets a newer record in and still keeps a newer local one', async () => {
    const mod = await import('./index');
    await mod.putEntry(entry({ note: 'local', updatedAt: '2024-06-01T00:00:00.000Z' }));

    await mod.importBackup(importOf({ entries: [entry({ note: 'newer', updatedAt: '2024-07-01T00:00:00.000Z' })] }), 'merge');
    expect((await mod.getEntry('e-1'))?.note).toBe('newer');

    await mod.importBackup(importOf({ entries: [entry({ note: 'older', updatedAt: '2024-05-01T00:00:00.000Z' })] }), 'merge');
    expect((await mod.getEntry('e-1'))?.note).toBe('newer');
  });

  it('lets a dated backup replace a stored record whose stamp cannot be read', async () => {
    const mod = await import('./index');
    // A corrupted write, or a record from before the field was universal. It
    // used to win against everything, for good: restoring a backup over it
    // quietly did nothing at all.
    await mod.putEntry(entry({ note: 'corrupt local', updatedAt: 'not-a-date' }));

    const outcome = await mod.importBackup(
      importOf({ entries: [entry({ note: 'good backup', updatedAt: '2024-07-01T00:00:00.000Z' })] }),
      'merge',
    );

    expect((await mod.getEntry('e-1'))?.note).toBe('good backup');
    // Nothing was skipped here — the file's record was perfectly datable.
    expect(outcome.undatedSkipped).toBe(0);
  });

  it('keeps the stored copy when the file cannot be dated, and says how many', async () => {
    const mod = await import('./index');
    await mod.putEntry(entry({ note: 'local' }));
    await mod.putGroup(group({ name: 'local' }));

    const undatedEntry = { ...entry({ note: 'from the file' }) } as Partial<Entry>;
    delete undatedEntry.updatedAt;
    const undatedGroup = { ...group({ name: 'from the file' }) } as Partial<Group>;
    delete undatedGroup.updatedAt;

    const outcome = await mod.importBackup(
      importOf({ entries: [undatedEntry as Entry], groups: [undatedGroup as Group] }),
      'merge',
    );

    // Nothing shows these are newer, so the copies already here stand — but the
    // caller now has a number to put in front of the user instead of reporting
    // an unqualified success.
    expect((await mod.getEntry('e-1'))?.note).toBe('local');
    expect((await mod.getGroups())[0].name).toBe('local');
    expect(outcome.undatedSkipped).toBe(2);
  });

  it('writes an undated record when there is no stored copy to weigh it against', async () => {
    const mod = await import('./index');
    const undated = { ...entry({ note: 'brand new' }) } as Partial<Entry>;
    delete undated.updatedAt;

    const outcome = await mod.importBackup(importOf({ entries: [undated as Entry] }), 'merge');

    // A stamp is only ever a tie-break, and there is nothing here to tie with.
    expect((await mod.getEntry('e-1'))?.note).toBe('brand new');
    expect(outcome.undatedSkipped).toBe(0);
  });

  it('counts nothing in replace mode, which resolves no conflicts at all', async () => {
    const mod = await import('./index');
    await mod.putEntry(entry({ note: 'local' }));

    const undated = { ...entry({ note: 'from the file' }) } as Partial<Entry>;
    delete undated.updatedAt;

    const outcome = await mod.importBackup(importOf({ entries: [undated as Entry] }), 'replace');

    expect((await mod.getEntry('e-1'))?.note).toBe('from the file');
    expect(outcome.undatedSkipped).toBe(0);
  });

  it('applies the same rule in the in-memory fallback store', async () => {
    // The pair of paths has drifted before — that is why `mergeSettings` exists
    // as one function — so the fallback gets the same three cases.
    vi.doMock('idb', async (importOriginal) => {
      const actual = await importOriginal<typeof import('idb')>();
      return { ...actual, openDB: vi.fn().mockRejectedValue(new Error('no database here')) };
    });
    const mod = await import('./index');

    await mod.getGroups(); // enters fallback mode
    await mod.putEntry(entry({ note: 'corrupt local', updatedAt: 'not-a-date' }));

    await mod.importBackup(
      importOf({ entries: [entry({ note: 'good backup', updatedAt: '2024-07-01T00:00:00.000Z' })] }),
      'merge',
    );
    expect((await mod.getEntry('e-1'))?.note).toBe('good backup');

    const undated = { ...entry({ note: 'from the file' }) } as Partial<Entry>;
    delete undated.updatedAt;
    const outcome = await mod.importBackup(importOf({ entries: [undated as Entry] }), 'merge');

    expect((await mod.getEntry('e-1'))?.note).toBe('good backup');
    expect(outcome.undatedSkipped).toBe(1);

    vi.doUnmock('idb');
  });

  it('settles settings by the same rule, which is where it came from', async () => {
    const mod = await import('./index');
    const base = { id: 'user-settings', currencySymbol: '£', preparerName: 'A Freelancer' } as Settings;
    await mod.putSettings(base);

    // `putSettings` stamps `updatedAt`, so the stored copy is dated. A file
    // whose settings carry no stamp cannot beat it.
    await mod.importBackup(
      { groups: [], timecodes: [], entries: [], settings: { currencySymbol: '$' } as Settings },
      'merge',
    );
    expect((await mod.getSettings())?.currencySymbol).toBe('£');

    await mod.importBackup(
      {
        groups: [], timecodes: [], entries: [],
        settings: { currencySymbol: '$', updatedAt: '2099-01-01T00:00:00.000Z' } as Settings,
      },
      'merge',
    );
    expect((await mod.getSettings())?.currencySymbol).toBe('$');
  });
});
