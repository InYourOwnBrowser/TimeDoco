import { UserFacingError } from './errorMessage';

/**
 * Raised when a bulk import stopped with some of its rows already committed.
 *
 * `bulkAddManualEntries` writes in chunks, each its own transaction, so that a
 * 50,000-row import is not one enormous one. That means a failure part way
 * through leaves the earlier chunks on disk — they cannot be rolled back, and
 * this is how the caller finds out.
 *
 * A type rather than a message the caller string-matches, because the branch it
 * drives is destructive: the CSV importer's cleanup path hard-deletes the
 * timecodes the import created, and `hardDeleteTimecode` cascades to entries.
 * Run against a partial commit, it permanently deletes the rows that landed.
 *
 * Extends `UserFacingError` so the committed count survives the sanitiser
 * intact. It is the data-integrity-relevant fact — the user has rows in their
 * timesheet either way, and needs to be told so.
 */
export class PartialImportError extends UserFacingError {
  /** Rows written and committed before the failure. Always greater than zero. */
  readonly committed: number;
  /** Rows the import attempted to write, after malformed and overlapping ones were dropped. */
  readonly attempted: number;

  constructor(committed: number, attempted: number) {
    super(
      `Import stopped after ${committed} of ${attempted} entries were saved. ` +
      `Those entries are in your timesheet; the rest were not imported.`
    );
    this.name = 'PartialImportError';
    this.committed = committed;
    this.attempted = attempted;
  }
}
