import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deleteDB } from 'idb';
import type { Settings } from '../types';

/**
 * Importing a settings record that does not carry the key its store is addressed by.
 *
 * The `settings` store has an in-line key of `id` and exactly one row.
 * `validateBackupPayload` rejects an `id` that is present and wrong, and allows
 * one that is absent or null — so a hand-edited or third-party backup can pass
 * validation and then be unwritable, because `put` cannot extract the key.
 *
 * In replace mode that `DataError` is thrown *after* the four `clear()` calls,
 * and because it escapes before `tx.done` is awaited nothing aborts the
 * transaction: the clears commit. The user was shown a failed import and had
 * lost their rounding rule, currency, tax setup, preparer details, logo, footer
 * and templates.
 *
 * The in-memory fallback path always normalised here; the IndexedDB path did
 * not — the same one-path-fixed-not-its-sibling split `mergeSettings` exists to
 * prevent. These live in their own file rather than in `index.test.ts` because
 * that suite registers a `vi.doMock('idb', ...)` per test, and these need the
 * real store to exercise the key extraction at all.
 */

const DB_NAME = 'time-tracker-db';

const storedSettings = (): Settings => ({
  id: 'user-settings',
  roundingRule: '15min',
  currencySymbol: '£',
  preparerName: 'A Freelancer',
  lastBackupDate: null,
  reminderIntervalDays: 7,
  idleThresholdMinutes: null,
  weeklyTargetHours: null,
  allowConcurrentTimers: false,
}) as Settings;

describe('importing settings that carry no usable id', () => {
  beforeEach(async () => {
    vi.resetModules();
    await deleteDB(DB_NAME);
  });

  afterEach(async () => {
    const mod = await import('./index');
    await mod.resetDBForTests();
    await deleteDB(DB_NAME);
  });

  it('is a shape the validator lets through, so the db layer has to cope with it', async () => {
    const { validateBackupPayload } = await import('../utils/importValidation');

    expect(() =>
      validateBackupPayload(
        { schemaVersion: 1, groups: [], timecodes: [], entries: [], settings: { roundingRule: '15min' } },
        new Set<string>(),
      ),
    ).not.toThrow();
  });

  it('lands at the key the store uses on a replace, rather than wiping settings', async () => {
    const mod = await import('./index');
    await mod.putSettings(storedSettings());

    await mod.importBackup(
      { groups: [], timecodes: [], entries: [], settings: { roundingRule: '5min' } as Settings },
      'replace',
    );

    const after = await mod.getSettings();
    // Previously: the four clears committed, the put threw, and this was
    // `undefined` — every preference the user had set, gone.
    expect(after).toBeDefined();
    expect(after?.id).toBe('user-settings');
    expect(after?.roundingRule).toBe('5min');
  });

  it('does the same on a merge, where the record is spread over the local one', async () => {
    const mod = await import('./index');
    await mod.putSettings(storedSettings());

    await mod.importBackup(
      {
        groups: [], timecodes: [], entries: [],
        // `null` is permitted by the validator too, and on its way through
        // `mergeSettings` it overwrites the good key rather than being absent.
        settings: { id: null, currencySymbol: '$', updatedAt: '2099-01-01T00:00:00.000Z' } as unknown as Settings,
      },
      'merge',
    );

    const after = await mod.getSettings();
    expect(after?.id).toBe('user-settings');
    expect(after?.currencySymbol).toBe('$');
    // Still a merge against the local record, not a replacement of it.
    expect(after?.preparerName).toBe('A Freelancer');
  });

  it('leaves a well-formed backup exactly as it was — the normal path is unchanged', async () => {
    const mod = await import('./index');
    await mod.putSettings(storedSettings());

    const exported = await mod.getSettings();
    await mod.wipeAllData();
    await mod.importBackup({ groups: [], timecodes: [], entries: [], settings: exported! }, 'replace');

    expect(await mod.getSettings()).toEqual(exported);
  });
});
