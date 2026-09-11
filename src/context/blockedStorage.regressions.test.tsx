import React, { useEffect } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { TimeTrackerProvider, useTimeTracker } from './TimeTrackerContext';
import { ToastProvider } from './ToastContext';
import * as db from '../db';

/**
 * The app under a browser that blocks site data.
 *
 * `storagePersistence` states the rule its own accessors are built around —
 * "localStorage itself throws when site data is blocked, not just its methods" —
 * and the rest of the app reached for the global directly. These cover the two
 * shapes that cost the most: a read in a `useState` initializer, which fails the
 * mount outright, and a write in a click handler or after a committed database
 * write, which rejects an operation that already succeeded.
 */

const blockStorage = () => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
};

const restoreStorage = () => {
  // Deleting the own-property getter uncovers jsdom's real implementation again.
  delete (window as unknown as Record<string, unknown>).localStorage;
};

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

afterEach(() => {
  restoreStorage();
});

describe('with site data blocked', () => {
  it('still mounts the provider', async () => {
    // `dismissedForgotToStopIds` is read in a useState initializer, outside the
    // try that wraps the JSON.parse beside it — so this threw during render and
    // took the whole app down, unrecoverably, before anything else could run.
    await clearDB();
    blockStorage();

    let ctx: ReturnType<typeof useTimeTracker> | undefined;
    expect(() => render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    )).not.toThrow();

    await waitFor(() => expect(ctx?.settings).not.toBeNull());
  });

  it('does not reject a wipe that the database already carried out', async () => {
    // `wipeAllData` removes two keys *after* `db.wipeAllData()` has emptied the
    // database. A throw there reported failure for the one operation documented
    // as a delete-everything guarantee, with the data already gone.
    await clearDB();

    let ctx: ReturnType<typeof useTimeTracker> | undefined;
    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );
    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    blockStorage();
    await expect(act(async () => { await ctx!.wipeAllData(); })).resolves.not.toThrow();
  });

  it('does not throw out of the forgot-to-stop dismissal handler', async () => {
    // A plain click handler: a throw here is an unhandled rejection in a user
    // gesture, not something the app can report or recover from.
    await clearDB();

    let ctx: ReturnType<typeof useTimeTracker> | undefined;
    render(
      <ToastProvider><TimeTrackerProvider>
        <TestConsumer onReady={(c) => (ctx = c)} />
      </TimeTrackerProvider></ToastProvider>
    );
    await waitFor(() => expect(ctx?.settings).not.toBeNull());

    blockStorage();
    expect(() => ctx!.dismissForgotToStop()).not.toThrow();
  });
});
