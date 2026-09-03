import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';

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
    expect(pwa.updateSW).toHaveBeenCalledWith(true);
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
