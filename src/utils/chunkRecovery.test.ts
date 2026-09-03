import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isStaleChunkError, noteChunkLoaded, reloadOnceForStaleChunk, wasStaleChunkReload } from './chunkRecovery';
import { useDeferredWrite } from '../hooks/useDeferredWrite';

const reload = vi.fn();

beforeEach(() => {
  reload.mockClear();
  sessionStorage.clear();
  // jsdom's Location has no navigation, so the reload is the observable.
  // Only what is used: spreading the real Location would drop its prototype.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: window.location.href, origin: window.location.origin, reload },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('isStaleChunkError', () => {
  // One per engine: the message is all there is to go on, and each browser
  // words it differently.
  it.each([
    ['Chromium', 'Failed to fetch dynamically imported module: https://timedoco.com/assets/AnalysisView-abc123.js'],
    ['Firefox', 'error loading dynamically imported module: https://timedoco.com/assets/AnalysisView-abc123.js'],
    ['Safari', 'Importing a module script failed.'],
    ['Vite CSS preload', 'Unable to preload CSS for /assets/AnalysisView-abc123.css'],
  ])('recognises the %s wording', (_engine, message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it('leaves ordinary application errors alone', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError(new TypeError('entry.startTime is not a Date'))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError('Failed to fetch dynamically imported module: /a.js')).toBe(true);
  });
});

describe('reloadOnceForStaleChunk', () => {
  const staleChunk = () => new Error('Failed to fetch dynamically imported module: /assets/AnalysisView-abc123.js');

  // The return value is still synchronous — the caller has nothing left to do
  // the moment it is true. The reload itself now waits for pending debounced
  // writes to settle, so it is awaited rather than asserted inline.
  it('reloads for a chunk the origin no longer serves', async () => {
    expect(reloadOnceForStaleChunk(staleChunk())).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('does not reload for an error that is not a missing chunk', () => {
    expect(reloadOnceForStaleChunk(new Error('Something else broke'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once, then stops — a broken build must not cycle', async () => {
    reloadOnceForStaleChunk(staleChunk());
    expect(reloadOnceForStaleChunk(staleChunk())).toBe(false);
    expect(reloadOnceForStaleChunk(staleChunk())).toBe(false);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('re-arms once a chunk has actually loaded', async () => {
    reloadOnceForStaleChunk(staleChunk());
    noteChunkLoaded();
    expect(reloadOnceForStaleChunk(staleChunk())).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });

  // W-6: the reload that rescues a stale chunk used to take pending debounced
  // writes down with it. React runs no effect cleanup for a reload, so this is
  // the one loss `useDeferredWrite` cannot prevent from inside itself.
  it('flushes a pending debounced write before reloading', async () => {
    const order: string[] = [];
    reload.mockImplementation(() => { order.push('reload'); });

    const { result } = renderHook(() => useDeferredWrite(5000));
    act(() => result.current.schedule(() => { order.push('write'); }));

    expect(reloadOnceForStaleChunk(staleChunk())).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());

    expect(order).toEqual(['write', 'reload']);
  });

  it('declines when the guard cannot be stored, rather than reloading unguarded', () => {
    // Some privacy modes throw on any storage access. Without somewhere to
    // record that a reload has happened there is no way to stop at one, and an
    // endless reload is worse than the error screen.
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });

    expect(reloadOnceForStaleChunk(staleChunk())).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('wasStaleChunkReload', () => {
  it('is true only between the recovery reload and the next chunk arriving', () => {
    expect(wasStaleChunkReload()).toBe(false);
    reloadOnceForStaleChunk(new Error('Failed to fetch dynamically imported module: /assets/TimesheetView-a.js'));
    expect(wasStaleChunkReload()).toBe(true);
    noteChunkLoaded();
    expect(wasStaleChunkReload()).toBe(false);
  });
});
