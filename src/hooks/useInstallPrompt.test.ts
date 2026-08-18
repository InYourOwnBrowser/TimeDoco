import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInstallPrompt } from './useInstallPrompt';

describe('useInstallPrompt', () => {
  const originalMatchMedia = window.matchMedia;

  const mockMatchMedia = (matches: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(display-mode: standalone)' ? matches : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  };

  beforeEach(() => {
    mockMatchMedia(false);
  });

  afterEach(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    }
    vi.restoreAllMocks();
  });

  it('initializes with canInstall=false and installed=false when standalone mode is false', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(false);
  });

  it('initializes with installed=true when app is in standalone mode', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(true);
  });

  it('captures beforeinstallprompt event and sets canInstall to true', () => {
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.canInstall).toBe(false);

    const event = new Event('beforeinstallprompt');
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(result.current.canInstall).toBe(true);
  });

  it('updates installed state on appinstalled event', () => {
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.installed).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.installed).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('removes event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useInstallPrompt());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'beforeinstallprompt',
      expect.any(Function)
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'appinstalled',
      expect.any(Function)
    );
  });

  it('triggers prompt and awaits userChoice when promptInstall is called', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    const mockPrompt = vi.fn();
    const mockUserChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });

    const beforeInstallEvent = new Event('beforeinstallprompt') as any;
    beforeInstallEvent.prompt = mockPrompt;
    beforeInstallEvent.userChoice = mockUserChoice;

    act(() => {
      window.dispatchEvent(beforeInstallEvent);
    });

    expect(result.current.canInstall).toBe(true);

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(false);
  });

  it('handles promptInstall gracefully when no deferredPrompt is set', async () => {
    const { result } = renderHook(() => useInstallPrompt());

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(result.current.canInstall).toBe(false);
  });
});
