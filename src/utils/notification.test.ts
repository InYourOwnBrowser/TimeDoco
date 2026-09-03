import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestNotificationPermission, sendNotification } from './notification';

describe('notification utils', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requestNotificationPermission returns unsupported if window.Notification is missing', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'Notification');
    delete (window as any).Notification;

    const res = await requestNotificationPermission();
    expect(res).toBe('unsupported');

    if (original) Object.defineProperty(window, 'Notification', original);
  });

  it('requestNotificationPermission calls Notification.requestPermission when available', async () => {
    const mockRequest = vi.fn().mockResolvedValue('granted');
    const mockNotification = vi.fn();
    (mockNotification as any).requestPermission = mockRequest;
    vi.stubGlobal('Notification', mockNotification);

    const res = await requestNotificationPermission();
    expect(res).toBe('granted');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('sendNotification does nothing if permission is not granted', async () => {
    const mockNotification = vi.fn();
    (mockNotification as any).permission = 'denied';
    vi.stubGlobal('Notification', mockNotification);

    await sendNotification('Test');
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it('sendNotification uses serviceWorker.showNotification when available', async () => {
    const showNotificationMock = vi.fn().mockResolvedValue(undefined);
    const mockNotificationClass = vi.fn();
    (mockNotificationClass as any).permission = 'granted';
    vi.stubGlobal('Notification', mockNotificationClass);

    const mockSWReg = { showNotification: showNotificationMock };
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(mockSWReg),
      },
    });

    await sendNotification('SW Test', { body: 'Hello' });
    expect(showNotificationMock).toHaveBeenCalledWith('SW Test', { body: 'Hello' });
    expect(mockNotificationClass).not.toHaveBeenCalled();
  });

  it('sendNotification falls back to new Notification without throwing if SW is not available', async () => {
    const mockNotificationClass = vi.fn();
    (mockNotificationClass as any).permission = 'granted';
    vi.stubGlobal('Notification', mockNotificationClass);

    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(null),
      },
    });

    await sendNotification('Fallback Test', { body: 'World' });
    expect(mockNotificationClass).toHaveBeenCalledWith('Fallback Test', { body: 'World' });
  });

  it('sendNotification catches constructor errors gracefully (Android Chrome)', async () => {
    const mockNotificationClass = vi.fn().mockImplementation(() => {
      throw new TypeError('Illegal constructor');
    });
    (mockNotificationClass as any).permission = 'granted';
    vi.stubGlobal('Notification', mockNotificationClass);

    vi.stubGlobal('navigator', {});

    await expect(sendNotification('Android Fail Test')).resolves.not.toThrow();
  });
});
