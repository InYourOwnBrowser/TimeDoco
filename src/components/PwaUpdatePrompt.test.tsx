import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, act, fireEvent, renderHook, waitFor } from '@testing-library/react';

const pwa = vi.hoisted(() => ({
  updateSW: vi.fn(async () => {}),
  options: null as { onNeedRefresh?: () => void; onRegisterError?: (error: unknown) => void } | null,
  registerSW: vi.fn(),
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: { onNeedRefresh?: () => void; onRegisterError?: (error: unknown) => void }) => {
    pwa.registerSW(options);
    pwa.options = options;
    return pwa.updateSW;
  },
}));

const load = async () => {
  const module = await import('./PwaUpdatePrompt');
  return module.PwaUpdatePrompt;
};

const banner = 'A new version of TimeDoco is ready.';

beforeEach(() => {
  vi.resetModules();
  pwa.updateSW.mockClear();
  pwa.registerSW.mockClear();
  pwa.options = null;
});

describe('PwaUpdatePrompt', () => {
  it('registers the worker and shows nothing until an update is waiting', async () => {
    const PwaUpdatePrompt = await load();
    render(<PwaUpdatePrompt />);

    expect(pwa.registerSW).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(banner)).toBeNull();
  });

  it('registers once even when effects run twice', async () => {
    // StrictMode mounts, unmounts and remounts. Registering twice races two
    // Workbox instances over the same worker.
    const PwaUpdatePrompt = await load();
    render(
      <StrictMode>
        <PwaUpdatePrompt />
      </StrictMode>,
    );

    expect(pwa.registerSW).toHaveBeenCalledTimes(1);
  });

  it('offers the update when one is waiting, and applies it only when accepted', async () => {
    const PwaUpdatePrompt = await load();
    render(<PwaUpdatePrompt />);

    act(() => pwa.options?.onNeedRefresh?.());
    expect(await screen.findByText(banner)).not.toBeNull();
    expect(pwa.updateSW).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Reload/ }));
    // Awaited rather than asserted outright: pending writes are flushed before
    // the worker is handed the page, so the call lands a microtask later.
    await waitFor(() => expect(pwa.updateSW).toHaveBeenCalledWith(true));
  });

  it('saves what the user was part-way through typing before handing over', async () => {
    // The banner says so in as many words. This is the only place that can keep
    // that promise: the registration reloads on `controlling`, and React runs no
    // effect cleanup for a reload — so the note on a running timer, and every
    // `SettingField` inside its debounce window, would go down with the page.
    const PwaUpdatePrompt = await load();
    // From the same module graph `load` just built: `vi.resetModules` gives the
    // component a fresh `useDeferredWrite`, and the registry of pending flushes
    // is module state. A statically imported hook would register into a
    // different one and nothing would be found to flush.
    const { useDeferredWrite } = await import('../hooks/useDeferredWrite');

    const write = vi.fn();
    const { result } = renderHook(() => useDeferredWrite(1000));
    act(() => result.current.schedule(write));

    render(<PwaUpdatePrompt />);
    act(() => pwa.options?.onNeedRefresh?.());
    fireEvent.click(screen.getByRole('button', { name: /Reload/ }));

    await waitFor(() => expect(write).toHaveBeenCalled());
    // And the flush comes first: handing over before it defeats the point.
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(pwa.updateSW.mock.invocationCallOrder[0]);
  });

  it('lets the update be declined, leaving the running build alone', async () => {
    const PwaUpdatePrompt = await load();
    render(<PwaUpdatePrompt />);

    act(() => pwa.options?.onNeedRefresh?.());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }));

    expect(screen.queryByText(banner)).toBeNull();
    expect(pwa.updateSW).not.toHaveBeenCalled();
  });

  it('reports a registration failure instead of leaving it unhandled', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const PwaUpdatePrompt = await load();
    render(<PwaUpdatePrompt />);

    pwa.options?.onRegisterError?.(new Error('no service worker here'));

    expect(consoleError).toHaveBeenCalledWith('Service worker registration failed', expect.any(Error));
    consoleError.mockRestore();
  });
});
