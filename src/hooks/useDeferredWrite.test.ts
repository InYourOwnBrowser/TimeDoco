import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDeferredWrite, flushDeferredWrites } from './useDeferredWrite';

/**
 * The registry behind `flushDeferredWrites`, which exists for one caller: a
 * reload the app starts itself, where React runs no effect cleanup and a draft
 * still waiting out its debounce would otherwise go down with the page.
 */
describe('flushDeferredWrites', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('performs a write that is still waiting out its debounce', () => {
    const write = vi.fn();
    const { result } = renderHook(() => useDeferredWrite(5000));

    act(() => result.current.schedule(write));
    expect(write).not.toHaveBeenCalled();

    flushDeferredWrites();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('hands back what each write returned, so the caller can wait on it', async () => {
    const { result } = renderHook(() => useDeferredWrite(5000));
    act(() => result.current.schedule(() => Promise.resolve('stored')));

    const results = flushDeferredWrites();

    expect(results).toHaveLength(1);
    await expect(results[0]).resolves.toBe('stored');
  });

  it('deregisters on unmount, so a write is performed once and not after', () => {
    const write = vi.fn();
    const { result, unmount } = renderHook(() => useDeferredWrite(5000));
    act(() => result.current.schedule(write));

    // Unmount already flushes; the registry must not hold a second reference.
    unmount();
    expect(write).toHaveBeenCalledTimes(1);

    flushDeferredWrites();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('flushes every mounted field, not just the most recent', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = renderHook(() => useDeferredWrite(5000));
    const b = renderHook(() => useDeferredWrite(5000));

    act(() => a.result.current.schedule(first));
    act(() => b.result.current.schedule(second));

    flushDeferredWrites();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
