import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInstallPrompt } from './useInstallPrompt';

describe('useInstallPrompt', () => {
  const originalMatchMedia = window.matchMedia;
  const originalUserAgent = navigator.userAgent;
  const originalMaxTouchPoints = navigator.maxTouchPoints;

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

  const setUserAgent = (ua: string, maxTouchPoints = 0, standalone = false) => {
    Object.defineProperty(navigator, 'userAgent', {
      value: ua,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: maxTouchPoints,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'standalone', {
      value: standalone,
      configurable: true,
      writable: true,
    });
  };

  beforeEach(() => {
    mockMatchMedia(false);
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  });

  afterEach(() => {
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: originalMatchMedia,
      });
    }
    setUserAgent(originalUserAgent, originalMaxTouchPoints);
    delete (navigator as any).standalone;
    vi.restoreAllMocks();
  });

  it('initializes with canInstall=false and installed=false when standalone mode is false', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(false);
    expect(result.current.isIOS).toBe(false);
    expect(result.current.needsManualInstall).toBe(false);
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

  it('detects iPhone/iPad user agents and sets canInstall and needsManualInstall to true', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isIOS).toBe(true);
    expect(result.current.canInstall).toBe(true);
    expect(result.current.needsManualInstall).toBe(true);
    expect(result.current.installed).toBe(false);
  });

  it('detects iPadOS 13+ desktop Mac user agent with touch points', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 5);
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isIOS).toBe(true);
    expect(result.current.canInstall).toBe(true);
    expect(result.current.needsManualInstall).toBe(true);
  });

  it('returns installed=true and canInstall=false on iOS when in navigator.standalone mode', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      0,
      true
    );
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isIOS).toBe(true);
    expect(result.current.installed).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });
});
