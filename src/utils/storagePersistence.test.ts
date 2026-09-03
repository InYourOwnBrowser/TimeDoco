import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkPersistence,
  requestPersistence,
  requestPersistenceOnCommitment,
  resumePersistence,
  persistenceRecord,
  resetPersistenceMigrationForTests,
  storageEstimate,
  PERSISTENCE_RETRY_INTERVAL_MS,
} from './storagePersistence';

const GRANTED_KEY = 'timedoco.persistence.granted';
const LAST_ATTEMPT_KEY = 'timedoco.persistence.lastAttempt';

describe('storagePersistence', () => {
  let originalNavigator: any;
  let originalWindow: any;

  beforeEach(() => {
    originalNavigator = global.navigator;
    originalWindow = global.window;

    global.window = { isSecureContext: true } as any;
    localStorage.clear();
    resetPersistenceMigrationForTests();
  });

  afterEach(() => {
    global.navigator = originalNavigator;
    global.window = originalWindow;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const navigatorWith = (storage: Record<string, unknown>) => {
    global.navigator = { storage } as any;
  };

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
      navigatorWith({});
      expect(await checkPersistence()).toBe('unsupported');
    });

    it('returns unsupported if not secure context', async () => {
      navigatorWith({ persisted: vi.fn() });
      global.window.isSecureContext = false;
      expect(await checkPersistence()).toBe('unsupported');
    });

    it('returns persisted if navigator.storage.persisted returns true', async () => {
      navigatorWith({ persisted: vi.fn().mockResolvedValue(true) });
      expect(await checkPersistence()).toBe('persisted');
    });

    it('returns best-effort if navigator.storage.persisted returns false', async () => {
      navigatorWith({ persisted: vi.fn().mockResolvedValue(false) });
      expect(await checkPersistence()).toBe('best-effort');
    });

    it('returns unsupported if navigator.storage.persisted throws', async () => {
      navigatorWith({ persisted: vi.fn().mockRejectedValue(new Error('test')) });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await checkPersistence()).toBe('unsupported');
      consoleSpy.mockRestore();
    });

    it('clears a stale granted record when the grant is gone', async () => {
      localStorage.setItem(GRANTED_KEY, 'true');
      navigatorWith({ persisted: vi.fn().mockResolvedValue(false) });

      expect(await checkPersistence()).toBe('best-effort');
      expect(persistenceRecord().granted).toBe(false);
    });

    it('records a grant observed without a request', async () => {
      navigatorWith({ persisted: vi.fn().mockResolvedValue(true) });

      await checkPersistence();
      expect(persistenceRecord().granted).toBe(true);
    });

    it('does not count as an attempt, so it cannot push the retry window forward', async () => {
      navigatorWith({ persisted: vi.fn().mockResolvedValue(false) });

      await checkPersistence();
      expect(persistenceRecord().lastAttempt).toBeNull();
    });
  });

  describe('requestPersistence', () => {
    it('returns unsupported if navigator.storage.persist is undefined', async () => {
      navigatorWith({});
      expect(await requestPersistence()).toBe('unsupported');
    });

    it('returns unsupported if not secure context', async () => {
      navigatorWith({ persist: vi.fn() });
      global.window.isSecureContext = false;
      expect(await requestPersistence()).toBe('unsupported');
    });

    it('records the grant when granted, and clears any back-off', async () => {
      localStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now()));
      navigatorWith({ persist: vi.fn().mockResolvedValue(true) });

      expect(await requestPersistence()).toBe('persisted');
      expect(persistenceRecord()).toEqual({ granted: true, lastAttempt: null });
    });

    it('records when the denial happened rather than that one happened', async () => {
      navigatorWith({ persist: vi.fn().mockResolvedValue(false) });

      const before = Date.now();
      expect(await requestPersistence()).toBe('best-effort');
      const { granted, lastAttempt } = persistenceRecord();
      expect(granted).toBe(false);
      expect(lastAttempt).not.toBeNull();
      expect(lastAttempt as number).toBeGreaterThanOrEqual(before);
    });

    it('returns unsupported and backs off if navigator.storage.persist throws', async () => {
      navigatorWith({ persist: vi.fn().mockRejectedValue(new Error('test')) });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await requestPersistence()).toBe('unsupported');
      consoleSpy.mockRestore();
      expect(persistenceRecord().lastAttempt).not.toBeNull();
    });
  });

  describe('requestPersistenceOnCommitment', () => {
    it('asks on the first gesture', async () => {
      const persist = vi.fn().mockResolvedValue(false);
      navigatorWith({ persist });

      expect(await requestPersistenceOnCommitment()).toBe('best-effort');
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('does not ask again within the retry interval', async () => {
      const persist = vi.fn().mockResolvedValue(false);
      navigatorWith({ persist });
      const t0 = 1_000_000_000_000;

      await requestPersistenceOnCommitment(t0);
      const result = await requestPersistenceOnCommitment(t0 + PERSISTENCE_RETRY_INTERVAL_MS - 1);

      expect(result).toBe('skipped');
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('asks again on a later gesture once the interval has passed', async () => {
      const persist = vi.fn().mockResolvedValue(false);
      navigatorWith({ persist });
      const t0 = 1_000_000_000_000;

      await requestPersistenceOnCommitment(t0);
      await requestPersistenceOnCommitment(t0 + PERSISTENCE_RETRY_INTERVAL_MS + 1);

      expect(persist).toHaveBeenCalledTimes(2);
    });

    it('eventually succeeds when engagement has accrued', async () => {
      const persist = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      navigatorWith({ persist });
      const t0 = 1_000_000_000_000;

      expect(await requestPersistenceOnCommitment(t0)).toBe('best-effort');
      expect(await requestPersistenceOnCommitment(t0 + PERSISTENCE_RETRY_INTERVAL_MS + 1)).toBe('persisted');
      expect(persistenceRecord().granted).toBe(true);
    });

    it('skips once the grant is held', async () => {
      const persist = vi.fn().mockResolvedValue(true);
      navigatorWith({ persist });

      await requestPersistenceOnCommitment();
      expect(await requestPersistenceOnCommitment()).toBe('skipped');
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('is not suppressed forever by a clock that moved backwards', async () => {
      const persist = vi.fn().mockResolvedValue(false);
      navigatorWith({ persist });
      // A denial stamped from a clock that was running far ahead.
      localStorage.setItem(LAST_ATTEMPT_KEY, String(2_000_000_000_000));

      const result = await requestPersistenceOnCommitment(1_000_000_000_000);
      expect(result).toBe('best-effort');
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('ignores an unparseable stored timestamp', async () => {
      const persist = vi.fn().mockResolvedValue(false);
      navigatorWith({ persist });
      localStorage.setItem(LAST_ATTEMPT_KEY, 'not-a-number');

      expect(await requestPersistenceOnCommitment()).toBe('best-effort');
    });
  });

  describe('legacy key migration', () => {
    it('carries a granted flag forward under the namespaced key', () => {
      localStorage.setItem('persistenceGranted', 'true');

      expect(persistenceRecord().granted).toBe(true);
      expect(localStorage.getItem(GRANTED_KEY)).toBe('true');
      expect(localStorage.getItem('persistenceGranted')).toBeNull();
    });

    it('drops persistenceAttempted so a previously denied user is asked again', async () => {
      localStorage.setItem('persistenceAttempted', 'true');
      const persist = vi.fn().mockResolvedValue(true);
      navigatorWith({ persist });

      expect(await requestPersistenceOnCommitment()).toBe('persisted');
      expect(localStorage.getItem('persistenceAttempted')).toBeNull();
    });
  });

  describe('resumePersistence', () => {
    it('re-requests a grant that has been dropped since it was given', async () => {
      localStorage.setItem(GRANTED_KEY, 'true');
      const persist = vi.fn().mockResolvedValue(true);
      navigatorWith({ persisted: vi.fn().mockResolvedValue(false), persist });

      expect(await resumePersistence()).toBe('persisted');
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('does not request when the grant is still held', async () => {
      localStorage.setItem(GRANTED_KEY, 'true');
      const persist = vi.fn().mockResolvedValue(true);
      navigatorWith({ persisted: vi.fn().mockResolvedValue(true), persist });

      expect(await resumePersistence()).toBe('persisted');
      expect(persist).not.toHaveBeenCalled();
    });

    // W-8: `checkPersistence` clears the current-grant flag the moment the
    // browser reports the grant gone — which is exactly when this needs to know
    // it once existed. Reading that flag made reclamation one-shot: a single
    // refusal erased the only evidence that reclaiming was licensed at all.
    it('still tries to reclaim on a later load after a reclaim was refused', async () => {
      localStorage.setItem(GRANTED_KEY, 'true');
      const persist = vi.fn().mockResolvedValue(false);
      navigatorWith({ persisted: vi.fn().mockResolvedValue(false), persist });

      // This load: the grant is gone, and the reclaim is refused.
      expect(await resumePersistence()).toBe('best-effort');
      expect(persist).toHaveBeenCalledTimes(1);
      // The refusal clears the *current* grant, which is correct.
      expect(localStorage.getItem(GRANTED_KEY)).toBeNull();

      // A later load, past the back-off: the prior grant still licenses a retry.
      localStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now() - PERSISTENCE_RETRY_INTERVAL_MS - 1));
      resetPersistenceMigrationForTests();

      expect(await resumePersistence()).toBe('best-effort');
      expect(persist).toHaveBeenCalledTimes(2);
    });

    it('does not ask again inside the back-off window', async () => {
      // Reclaiming is licensed by a prior grant, not unlimited: without this a
      // browser that keeps refusing would be asked on every load, and in
      // Firefox that is a prompt every time.
      localStorage.setItem(GRANTED_KEY, 'true');
      localStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now() - 1000));
      const persist = vi.fn().mockResolvedValue(true);
      navigatorWith({ persisted: vi.fn().mockResolvedValue(false), persist });

      expect(await resumePersistence()).toBe('best-effort');
      expect(persist).not.toHaveBeenCalled();
    });

    it('does not request for a user who never had a grant', async () => {
      const persist = vi.fn().mockResolvedValue(true);
      navigatorWith({ persisted: vi.fn().mockResolvedValue(false), persist });

      expect(await resumePersistence()).toBe('best-effort');
      expect(persist).not.toHaveBeenCalled();
    });
  });

  describe('storageEstimate', () => {
    it('returns null if navigator.storage.estimate is undefined', async () => {
      navigatorWith({});
      expect(await storageEstimate()).toBeNull();
    });

    it('returns the estimate if supported', async () => {
      const mockEstimate = { usage: 100, quota: 1000 };
      navigatorWith({ estimate: vi.fn().mockResolvedValue(mockEstimate) });

      expect(await storageEstimate()).toEqual(mockEstimate);
    });

    it('returns null if navigator.storage.estimate throws', async () => {
      navigatorWith({ estimate: vi.fn().mockRejectedValue(new Error('test')) });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await storageEstimate()).toBeNull();
      consoleSpy.mockRestore();
    });
  });
});
