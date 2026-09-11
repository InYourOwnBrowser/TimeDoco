/**
 * One mutation at a time across every tab, not just within one.
 *
 * `useSerialQueue` serialises the read-modify-write mutations inside a single
 * tab, which is what stops two clicks in the same window racing. It is a
 * promise chain on a ref, so it knows nothing about the other tabs sharing the
 * database — and every whole-record writer in this app reads the record, edits
 * a field and writes the whole thing back. Two tabs interleaved on that
 * sequence lose one of the two edits, and both report success: a note typed in
 * one window disappeared under a tag added in the other, with a green "Changes
 * saved" on both.
 *
 * The Web Locks API is the origin-wide version of the same queue, so the two
 * compose: the in-tab chain still orders this tab's work, and the lock orders
 * it against every other tab's.
 */

/** Every mutation takes the same lock — they share one database. */
const LOCK_NAME = 'timedoco-mutations';

/**
 * How long to wait for another tab to finish before going ahead without the
 * lock.
 *
 * A held lock is only ever a few IndexedDB operations long, so reaching this
 * means a tab is wedged rather than busy — and the one way that happens here is
 * a tab whose `openDB` is waiting on a version standoff it cannot resolve (see
 * `ConnectionBlock` in src/db). Blocking every other tab's writes behind that
 * one would turn a stalled tab into a stalled browser. Giving up and proceeding
 * unlocked is exactly the behaviour that existed before this file, so the worst
 * case is no worse than it was; the common case is correct.
 */
const ACQUIRE_TIMEOUT_MS = 5_000;

/**
 * `navigator.locks` where it exists, and a straight passthrough where it does
 * not — it needs a secure context, and jsdom does not implement it at all. The
 * fallback is single-tab-correct, which is what the in-tab queue already gave.
 */
type LockManagerLike = {
  request: (
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<unknown>,
  ) => Promise<unknown>;
};

const lockManager = (): LockManagerLike | null => {
  const locks = (globalThis.navigator as Navigator & { locks?: LockManagerLike } | undefined)?.locks;
  return typeof locks?.request === 'function' ? locks : null;
};

export const withCrossTabLock = async <T>(task: () => Promise<T>): Promise<T> => {
  const locks = lockManager();
  if (!locks) return task();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACQUIRE_TIMEOUT_MS);

  try {
    return (await locks.request(LOCK_NAME, { signal: controller.signal }, async () => {
      // Granted. The timeout guards the wait, not the work — a mutation that
      // takes longer than the budget must not have its lock pulled out from
      // under it half way through a read-modify-write.
      clearTimeout(timer);
      return task();
    })) as T;
  } catch (error) {
    // Only the wait was abandoned. An error the task itself threw belongs to
    // the caller, which is watching for exactly that.
    if (controller.signal.aborted) return task();
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
