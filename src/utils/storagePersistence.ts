export type PersistenceState = 'persisted' | 'best-effort' | 'unsupported';

/**
 * How long to wait before asking again after a denial. Chromium decides on
 * accrued site engagement, so a denial minutes into first use says nothing
 * about a request next week.
 */
export const PERSISTENCE_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The origin also serves the marketing site, so everything the app owns is
// namespaced.
const GRANTED_KEY = 'timedoco.persistence.granted';
const LAST_ATTEMPT_KEY = 'timedoco.persistence.lastAttempt';

// Written by earlier versions. `persistenceAttempted` recorded that a request
// had been made rather than how it went, which made a single early denial
// permanent; it is dropped rather than carried forward, so the next commitment
// gesture asks again.
const LEGACY_GRANTED_KEY = 'persistenceGranted';
const LEGACY_ATTEMPTED_KEY = 'persistenceAttempted';

/** localStorage itself throws when site data is blocked, not just its methods. */
const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const readKey = (key: string): string | null => {
  const s = store();
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};

const writeKey = (key: string, value: string): void => {
  const s = store();
  if (!s) return;
  try {
    s.setItem(key, value);
  } catch {
    // A full or blocked store must not break the caller: the record is a
    // cache of a browser-level fact, and checkPersistence re-derives it.
  }
};

const removeKey = (key: string): void => {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // As above.
  }
};

let migrated = false;
const migrateLegacyKeys = (): void => {
  if (migrated) return;
  migrated = true;
  if (readKey(LEGACY_GRANTED_KEY) === 'true' && readKey(GRANTED_KEY) === null) {
    writeKey(GRANTED_KEY, 'true');
  }
  removeKey(LEGACY_GRANTED_KEY);
  removeKey(LEGACY_ATTEMPTED_KEY);
};

/** Exposed for tests; the migration is one-shot per page load. */
export const resetPersistenceMigrationForTests = (): void => {
  migrated = false;
};

/** What the app last observed about the grant. Outcomes only — never attempts. */
export const persistenceRecord = (): { granted: boolean; lastAttempt: number | null } => {
  migrateLegacyKeys();
  const raw = readKey(LAST_ATTEMPT_KEY);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return {
    granted: readKey(GRANTED_KEY) === 'true',
    lastAttempt: Number.isFinite(parsed) ? parsed : null,
  };
};

const recordGranted = (): void => {
  migrateLegacyKeys();
  writeKey(GRANTED_KEY, 'true');
  // A grant clears the back-off: if it is ever lost we should ask again at the
  // next gesture, not sit out a day left over from an old denial.
  removeKey(LAST_ATTEMPT_KEY);
};

/**
 * @param attempted true when persist() was actually called. A plain
 *   `persisted()` check is not an attempt — it runs on every load, and
 *   stamping it would push the retry window forward forever.
 */
const recordNotGranted = (attempted: boolean, now: number): void => {
  migrateLegacyKeys();
  removeKey(GRANTED_KEY);
  if (attempted) writeKey(LAST_ATTEMPT_KEY, String(now));
};

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
    // Reconcile: Safari can drop the grant on a session reset, and without this
    // the app goes on believing a stale `granted`.
    if (isPersisted) recordGranted();
    else recordNotGranted(false, Date.now());
    return isPersisted ? 'persisted' : 'best-effort';
  } catch (e) {
    console.error('Failed to check persistence', e);
    return 'unsupported';
  }
};

/**
 * May prompt in Firefox. Call from a user gesture, when the grant is already
 * held, or to reclaim one this origin held before and has since lost.
 *
 * That third case is `resumePersistence`, and it is why this is not simply
 * "only from a user gesture": Safari drops the grant on a session reset, and
 * without re-asking the app goes on believing it is persisted when it is not.
 * The user has answered this question affirmatively for this origin already, so
 * a Firefox prompt on the load after a reset is a re-confirmation rather than a
 * cold request. Never call it at load time without that prior grant.
 *
 * @param now the timestamp a denial is stamped with, so the back-off window is
 *   measured against the same clock the caller used to decide to ask.
 */
export const requestPersistence = async (now: number = Date.now()): Promise<PersistenceState> => {
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
    if (isPersisted) recordGranted();
    else recordNotGranted(true, now);
    return isPersisted ? 'persisted' : 'best-effort';
  } catch (e) {
    console.error('Failed to request persistence', e);
    // persist() was called and did not grant. Back off like a denial so a
    // consistently throwing browser is not asked on every gesture.
    recordNotGranted(true, now);
    return 'unsupported';
  }
};

/**
 * Ask for persistence from a commitment gesture — a first stopped timer, a
 * first timecode. Asking at the earliest gesture and never again is close to
 * the cold-boot request the timing was meant to avoid, so a denial is recorded
 * with its time and a later gesture tries again. A retry costs the user
 * nothing: persist() is silent in Chromium and Safari, and Firefox remembers a
 * denial without re-prompting.
 *
 * Returns 'skipped' when the policy declined to ask.
 */
export const requestPersistenceOnCommitment = async (
  now: number = Date.now(),
): Promise<PersistenceState | 'skipped'> => {
  const { granted, lastAttempt } = persistenceRecord();
  if (granted) return 'skipped';
  // Absolute difference, so a clock moved backwards cannot park the retry
  // window in the future and suppress every later request.
  if (lastAttempt !== null && Math.abs(now - lastAttempt) < PERSISTENCE_RETRY_INTERVAL_MS) {
    return 'skipped';
  }
  return requestPersistence(now);
};

/**
 * Load-time reconciliation. The check is free and refreshes the stored record;
 * if a grant we previously held is gone — Safari drops it on a session reset —
 * ask for it back. That origin has been granted once already, so this is not a
 * cold request.
 */
export const resumePersistence = async (): Promise<PersistenceState> => {
  const hadGrant = persistenceRecord().granted;
  const state = await checkPersistence();
  if (state === 'best-effort' && hadGrant) return requestPersistence();
  return state;
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
