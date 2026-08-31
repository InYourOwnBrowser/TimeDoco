export type PersistenceState = 'persisted' | 'best-effort' | 'unsupported';

/** Free, silent, no prompt in any browser. Safe to call on every load. */
export const checkPersistence = async (): Promise<PersistenceState> => {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    !navigator.storage.persisted
  ) {
    return 'unsupported';
  }

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'unsupported';
  }

  try {
    const isPersisted = await navigator.storage.persisted();
    return isPersisted ? 'persisted' : 'best-effort';
  } catch (e) {
    console.error('Failed to check persistence', e);
    return 'unsupported';
  }
};

/** May prompt in Firefox. Call only from a user gesture, or when already granted. */
export const requestPersistence = async (): Promise<PersistenceState> => {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    !navigator.storage.persist
  ) {
    return 'unsupported';
  }

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'unsupported';
  }

  try {
    const isPersisted = await navigator.storage.persist();
    if (isPersisted) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('persistenceGranted', 'true');
      }
    }
    return isPersisted ? 'persisted' : 'best-effort';
  } catch (e) {
    console.error('Failed to request persistence', e);
    return 'unsupported';
  }
};

/** Quota headroom, for the Settings readout and pre-emptive warnings. */
export const storageEstimate = async (): Promise<{ usage: number; quota: number } | null> => {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    !navigator.storage.estimate
  ) {
    return null;
  }

  try {
    const est = await navigator.storage.estimate();
    if (typeof est.usage === 'number' && typeof est.quota === 'number') {
      return { usage: est.usage, quota: est.quota };
    }
    return null;
  } catch (e) {
    console.error('Failed to estimate storage', e);
    return null;
  }
};
