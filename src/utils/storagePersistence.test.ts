import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkPersistence, requestPersistence, storageEstimate } from './storagePersistence';

describe('storagePersistence', () => {
  let originalNavigator: any;
  let originalWindow: any;

  beforeEach(() => {
    originalNavigator = global.navigator;
    originalWindow = global.window;

    global.window = { isSecureContext: true } as any;
  });

  afterEach(() => {
    global.navigator = originalNavigator;
    global.window = originalWindow;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('checkPersistence', () => {
    it('returns unsupported if navigator is undefined', async () => {
      // @ts-ignore
      delete global.navigator;
      expect(await checkPersistence()).toBe('unsupported');
    });

    it('returns unsupported if navigator.storage is undefined', async () => {
      global.navigator = {} as any;
      expect(await checkPersistence()).toBe('unsupported');
    });

    it('returns unsupported if navigator.storage.persisted is undefined', async () => {
      global.navigator = { storage: {} } as any;
      expect(await checkPersistence()).toBe('unsupported');
    });

    it('returns unsupported if not secure context', async () => {
      global.navigator = { storage: { persisted: vi.fn() } } as any;
      global.window.isSecureContext = false;
      expect(await checkPersistence()).toBe('unsupported');
    });

    it('returns persisted if navigator.storage.persisted returns true', async () => {
      global.navigator = {
        storage: {
          persisted: vi.fn().mockResolvedValue(true)
        }
      } as any;
      expect(await checkPersistence()).toBe('persisted');
    });

    it('returns best-effort if navigator.storage.persisted returns false', async () => {
      global.navigator = {
        storage: {
          persisted: vi.fn().mockResolvedValue(false)
        }
      } as any;
      expect(await checkPersistence()).toBe('best-effort');
    });

    it('returns unsupported if navigator.storage.persisted throws', async () => {
      global.navigator = {
        storage: {
          persisted: vi.fn().mockRejectedValue(new Error('test'))
        }
      } as any;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await checkPersistence()).toBe('unsupported');
      consoleSpy.mockRestore();
    });
  });

  describe('requestPersistence', () => {
    it('returns unsupported if navigator.storage.persist is undefined', async () => {
      global.navigator = { storage: {} } as any;
      expect(await requestPersistence()).toBe('unsupported');
    });

    it('returns unsupported if not secure context', async () => {
      global.navigator = { storage: { persist: vi.fn() } } as any;
      global.window.isSecureContext = false;
      expect(await requestPersistence()).toBe('unsupported');
    });

    it('returns persisted and sets localStorage if granted', async () => {
      global.navigator = {
        storage: {
          persist: vi.fn().mockResolvedValue(true)
        }
      } as any;

      expect(await requestPersistence()).toBe('persisted');
      expect(localStorage.getItem('persistenceGranted')).toBe('true');
    });

    it('returns best-effort and does not set localStorage if denied', async () => {
      global.navigator = {
        storage: {
          persist: vi.fn().mockResolvedValue(false)
        }
      } as any;

      expect(await requestPersistence()).toBe('best-effort');
      expect(localStorage.getItem('persistenceGranted')).toBeNull();
    });

    it('returns unsupported if navigator.storage.persist throws', async () => {
      global.navigator = {
        storage: {
          persist: vi.fn().mockRejectedValue(new Error('test'))
        }
      } as any;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await requestPersistence()).toBe('unsupported');
      consoleSpy.mockRestore();
    });
  });

  describe('storageEstimate', () => {
    it('returns null if navigator.storage.estimate is undefined', async () => {
      global.navigator = { storage: {} } as any;
      expect(await storageEstimate()).toBeNull();
    });

    it('returns the estimate if supported', async () => {
      const mockEstimate = { usage: 100, quota: 1000 };
      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate)
        }
      } as any;

      expect(await storageEstimate()).toEqual(mockEstimate);
    });

    it('returns null if navigator.storage.estimate throws', async () => {
      global.navigator = {
        storage: {
          estimate: vi.fn().mockRejectedValue(new Error('test'))
        }
      } as any;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await storageEstimate()).toBeNull();
      consoleSpy.mockRestore();
    });
  });
});
