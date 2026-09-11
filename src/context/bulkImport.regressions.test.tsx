import React, { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TimeTrackerProvider, useTimeTracker } from './TimeTrackerContext';
import { ToastProvider } from './ToastContext';
import { PartialImportError } from '../utils/importErrors';
import { getErrorLog, clearErrorLog } from '../utils/errorLog';
import type { Entry } from '../types';

/**
 * A bulk import that fails part way through.
 *
 * `bulkAddManualEntries` writes in chunks of 2,000, each its own transaction.
 * A failure after the first chunk committed used to be reported as a plain
 * `Error` whose message interpolated the cause — so a `TypeError` from the
 * storage layer reached the user verbatim, and the CSV importer, unable to tell
 * a partial commit from a total failure, ran its cleanup path. That path
 * hard-deletes the timecodes the import created, and hard-deleting a timecode
 * cascades to its entries: the rows that had just committed were destroyed.
 */

const { putEntriesMock } = vi.hoisted(() => ({ putEntriesMock: vi.fn() }));

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>();
  return { ...actual, putEntries: (entries: Entry[]) => putEntriesMock(entries) };
});

const db = await import('../db');

const clearDB = async () => {
  try {
    await db.wipeAllData();
  } catch {}
  await db.resetDBForTests();
};

const TestConsumer: React.FC<{ onReady: (c: ReturnType<typeof useTimeTracker>) => void }> = ({ onReady }) => {
  const context = useTimeTracker();
  useEffect(() => { onReady(context); }, [context, onReady]);
  return <div data-testid="ready">Ready</div>;
};

const mountProvider = async () => {
  let ctx: ReturnType<typeof useTimeTracker> | undefined;
  render(
    <ToastProvider><TimeTrackerProvider>
      <TestConsumer onReady={(c) => (ctx = c)} />
    </TimeTrackerProvider></ToastProvider>
  );
  await waitFor(() => expect(ctx?.settings).not.toBeNull());
  return ctx!;
};

/** Sequential half-hour entries an hour apart, so the overlap pass keeps every one. */
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const start = new Date(Date.UTC(2024, 0, 1, 0, 0, 0) + i * 3600_000);
    const end = new Date(start.getTime() + 1800_000);
    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timecodeId: 'tc-import',
      note: `row ${i}`,
    };
  });

// One row past a single chunk: 2,000 commit, then the write of the 2,001st fails.
const CHUNK_SIZE = 2000;
const INNER_MESSAGE = "Cannot read properties of undefined (reading 'foo')";

describe('a bulk import that fails after committing a chunk', () => {
  beforeEach(async () => {
    await clearDB();
    clearErrorLog();
    putEntriesMock.mockReset();
  });

  it('reports the committed count, and never the cause, when a later chunk fails', async () => {
    putEntriesMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError(INNER_MESSAGE));

    const ctx = await mountProvider();

    let thrown: unknown;
    try {
      await ctx.bulkAddManualEntries(rows(CHUNK_SIZE + 1));
    } catch (error) {
      thrown = error;
    }

    // A type the caller branches on, not a message it string-matches.
    expect(thrown).toBeInstanceOf(PartialImportError);
    const error = thrown as PartialImportError;
    expect(error.committed).toBe(CHUNK_SIZE);
    expect(error.attempted).toBe(CHUNK_SIZE + 1);

    // The count is the fact that describes the user's data, so it must be in
    // the message. The cause describes a bug, so it must not be.
    expect(error.message).toContain(String(CHUNK_SIZE));
    expect(error.message).not.toContain(INNER_MESSAGE);
    expect(error.message).not.toContain('undefined');
    expect(error.message).not.toMatch(/No entries were imported/);
  });

  it('logs the cause it withholds from the user', async () => {
    putEntriesMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError(INNER_MESSAGE));

    const ctx = await mountProvider();
    await expect(ctx.bulkAddManualEntries(rows(CHUNK_SIZE + 1))).rejects.toBeInstanceOf(PartialImportError);

    // Withheld from the user, not discarded — this is the only record of what
    // actually went wrong.
    const logged = getErrorLog();
    expect(logged.some((e) => e.message === INNER_MESSAGE && e.context === 'bulkAddManualEntries:partialCommit')).toBe(true);
  });

  it('rethrows the original error untouched when nothing committed', async () => {
    const inner = new TypeError(INNER_MESSAGE);
    putEntriesMock.mockRejectedValueOnce(inner);

    const ctx = await mountProvider();

    let thrown: unknown;
    try {
      await ctx.bulkAddManualEntries(rows(10));
    } catch (error) {
      thrown = error;
    }

    // Nothing landed, so there is no partial commit to report and the caller's
    // rollback is still the right thing to do.
    expect(thrown).toBe(inner);
    expect(thrown).not.toBeInstanceOf(PartialImportError);
  });
});
