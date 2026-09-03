/**
 * One rule for what a failure is allowed to say to the user.
 *
 * Four surfaces report a failure: the two storage-mutation wrappers in
 * `TimeTrackerContext`, the backup import, the CSV import and the timecode
 * merge. Three of them used to print `error.message` raw, so a `TypeError`
 * raised anywhere beneath them ("x is not a function") reached the user
 * verbatim. They all route through here instead — a provider-local helper
 * could not be reached by the components, nor tested on its own.
 */

/**
 * The ceiling on a passed-through message.
 *
 * 500 rather than 200 because the backup validator legitimately writes long
 * sentences: an entry naming a timecode the backup does not contain quotes the
 * id back at the user, and `MAX_ID_CHARS` is 200, so that one message runs to
 * roughly 350 characters while still being written for them. Every
 * app-authored message fits under 500; a dependency dumping a stack trace into
 * `message` is still bounded.
 */
export const MAX_USER_MESSAGE_CHARS = 500;

/**
 * An error whose message is written for the user and must reach them intact.
 *
 * The escape hatch from every rule below — no length cap, no constructor
 * check. For a failure whose message carries a fact the user needs in order to
 * know what state their data is now in (how many rows of an import committed
 * before it stopped, say), a generic "your change was not saved" is not an
 * acceptable substitute: it is false.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
    // Down-levelled `extends Error` breaks the prototype chain, and every
    // `instanceof` on a subclass then quietly returns false. One of those
    // decides whether a failed CSV import rolls back the timecodes its
    // committed rows point at, so this failing open would delete data.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Turns a thrown value into something safe to put in front of the user.
 *
 * `action` completes the fallback sentence — "save the entry", "import this
 * CSV" — so it reads as a phrase, not a label.
 */
export const describeUserFacingError = (error: unknown, action: string): string => {
  // App-authored and load-bearing: returned before any cap or heuristic can
  // reach it.
  if (error instanceof UserFacingError) {
    return error.message;
  }

  const name = (error as { name?: string } | null)?.name;
  const message = error instanceof Error ? error.message : String(error ?? '');

  // Running out of quota is the one case with an obvious remedy, and it is
  // also the one most likely to hit a long-running local-first database, so it
  // gets its own message rather than a generic "could not save".
  if (name === 'QuotaExceededError' || /quota/i.test(message)) {
    return `Could not ${action}: this browser is out of storage for TimeDoco. Export a backup from Settings, then clear the trash or remove old entries to free space.`;
  }

  // Passed through only for an error the app raised itself — `new Error(...)`
  // with a sentence written for the user, like a refused merge or a backup
  // that names a timecode it does not contain. `error.constructor === Error`
  // is what draws that line: a TypeError or a RangeError is a bug, and its
  // message is not something to show anyone. A DOMException, an IndexedDB
  // error and every Error subclass fail that test on their own, so none of
  // them needs a check of its own.
  if (error instanceof Error && error.constructor === Error) {
    // Truncated, not discarded. The opening of a message is the part that says
    // what went wrong, and replacing a long one wholesale with the generic
    // fallback throws away the only detail the user could act on.
    return message.length > MAX_USER_MESSAGE_CHARS
      ? `${message.slice(0, MAX_USER_MESSAGE_CHARS - 1)}…`
      : message;
  }

  return `Could not ${action}. Your change was not saved.`;
};
