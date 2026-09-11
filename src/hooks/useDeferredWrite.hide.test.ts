import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The draft still in the debounce when the page goes away.
 *
 * `useDeferredWrite` was written to stop a write being dropped on unmount, and
 * it does. The document going away is not unmount: React runs no effect cleanup
 * for it, so a pending write went down with the page. Two of the app's own
 * reloads had been taught to flush first, but closing the tab, reloading by
 * hand and switching apps on a phone — the three ordinary ways a page ends —
 * had not, and each of them silently discarded up to a second of typing.
 */

const load = () => import('./useDeferredWrite');

beforeEach(() => {
  vi.resetModules();
  // Back to visible, so a previous test's hidden state cannot make the next
  // one pass without doing anything.
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

const hide = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('a draft still inside its debounce when the page ends', () => {
  it('is written when the page is hidden — switching tabs, or an app going to the background', async () => {
    const { useDeferredWrite } = await load();
    const written: string[] = [];
    const { result } = renderHook(() => useDeferredWrite(1000));

    act(() => { result.current.schedule(() => written.push('half a sentence')); });
    expect(written).toEqual([]);

    act(() => { hide(); });
    expect(written).toEqual(['half a sentence']);
  });

  it('is written on pagehide, for a close where the page was never hidden first', async () => {
    const { useDeferredWrite } = await load();
    const written: string[] = [];
    const { result } = renderHook(() => useDeferredWrite(1000));

    act(() => { result.current.schedule(() => written.push('half a sentence')); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });

    expect(written).toEqual(['half a sentence']);
  });

  it('does nothing when the page merely becomes visible again', async () => {
    const { useDeferredWrite } = await load();
    const written: string[] = [];
    const { result } = renderHook(() => useDeferredWrite(1000));

    act(() => { result.current.schedule(() => written.push('half a sentence')); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(written).toEqual([]);
  });

  it('commits every mounted field, not just the first', async () => {
    const { useDeferredWrite } = await load();
    const written: string[] = [];
    const a = renderHook(() => useDeferredWrite(1000));
    const b = renderHook(() => useDeferredWrite(500));

    act(() => {
      a.result.current.schedule(() => written.push('note'));
      b.result.current.schedule(() => written.push('setting'));
    });
    act(() => { hide(); });

    expect(written.sort()).toEqual(['note', 'setting']);
  });

  it('writes the fields after one that throws — this is their last chance too', async () => {
    const { useDeferredWrite } = await load();
    const written: string[] = [];
    const a = renderHook(() => useDeferredWrite(1000));
    const b = renderHook(() => useDeferredWrite(1000));

    act(() => {
      a.result.current.schedule(() => { throw new Error('storage full'); });
      b.result.current.schedule(() => written.push('setting'));
    });
    act(() => { expect(() => hide()).not.toThrow(); });

    expect(written).toEqual(['setting']);
  });

  it('does not write again on a second hide, having already committed', async () => {
    const { useDeferredWrite } = await load();
    const written: string[] = [];
    const { result } = renderHook(() => useDeferredWrite(1000));

    act(() => { result.current.schedule(() => written.push('once')); });
    act(() => { hide(); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });

    expect(written).toEqual(['once']);
  });
});
