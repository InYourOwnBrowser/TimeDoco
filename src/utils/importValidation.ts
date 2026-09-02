export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_IMPORT_ENTRIES = 50000;
/** ~4MB of base64, comfortably above the 1MB upload cap after encoding. */
export const MAX_LOGO_DATA_URL_LENGTH = 4 * 1024 * 1024;

/**
 * Caps on an entry's edit history, which the app only ever appends to.
 *
 * Nothing in normal use approaches either: the history gains one record per
 * edited field per save. They exist because the array arrives from a file, and
 * an unbounded one is carried on every read of that entry for the life of the
 * database.
 */
export const MAX_EDIT_HISTORY = 1000;
export const MAX_EDIT_VALUE_CHARS = 10_000;

/** The only backup schema this build can read. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Reject a backup this build cannot migrate.
 *
 * Kept beside the checksum check so the preview and the import ask exactly the
 * same questions: the preview used to look at neither, so a hand-edited or
 * future-format file showed a clean green preview and then failed on import.
 */
export function assertSupportedSchemaVersion(version: unknown): void {
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${version}. Cannot migrate.`);
  }
}

/** The weak 32-bit hash used when the exporting context had no crypto.subtle. */
const fallbackHash = (payload: string): string => {
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(16);
};

/**
 * Verify a parsed backup's integrity checksum.
 *
 * Prefer SHA-256 always, and only fall back to the weak 32-bit hash when the
 * file actually declares it — a backup exported from a context without
 * crypto.subtle (plain-http dev, some embedded browsers) legitimately carries
 * one. Note the checksum is an integrity check, not a security boundary:
 * anyone crafting a backup can compute a valid digest under either algorithm.
 */
export async function verifyBackupChecksum(parsed: any): Promise<void> {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Import failed: Backup data is not a valid JSON object.');
  }
  if (!parsed.checksum) {
    throw new Error('No checksum found in backup file');
  }

  const { checksum, ...dataToVerify } = parsed;
  let payloadString: string = JSON.stringify(dataToVerify);

  let verified = false;
  let subtleAvailable = true;

  try {
    const msgUint8 = new TextEncoder().encode(payloadString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    verified = checksum === hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    subtleAvailable = false;
  }

  if (!verified && dataToVerify.checksumAlgorithm === 'fallback') {
    verified = checksum === fallbackHash(payloadString);
  }

  // The re-serialised payload is only needed for the checksum; drop it before
  // returning so it is not resident alongside the records being imported.
  payloadString = '';

  if (!verified) {
    if (!subtleAvailable && dataToVerify.checksumAlgorithm !== 'fallback') {
      throw new Error('Cannot verify SHA-256 backup checksum in this environment. Ensure you are on HTTPS.');
    }
    throw new Error(
      'Data corruption detected: Checksum mismatch. If you edited this backup by hand, re-export it from TimeDoco instead.'
    );
  }
}

/**
 * Read a backup file and run every check that is about the *file* rather than
 * its contents: size, parseability, schema version and checksum.
 *
 * The import preview and the import itself both call this, so the preview can
 * no longer pass a file the import will reject.
 *
 * @returns the parsed backup, for the caller to validate and migrate.
 */
export async function verifyBackupFile(file: File): Promise<any> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('Import failed: File size exceeds the 20MB limit.');
  }

  // file.text() rather than FileReader: a reader holds its own reference to the
  // decoded string for as long as it is alive, so the file text could not be
  // released after parsing. Here the local can be dropped, which matters when
  // the text, the parsed object and the re-serialised payload would otherwise
  // all be resident at once for a file up to 20MB.
  let content: string = await file.text();
  const parsed = JSON.parse(content);
  content = '';

  await verifyBackupChecksum(parsed);
  assertSupportedSchemaVersion(parsed?.schemaVersion);

  return parsed;
}

/** Data URLs only — never a remote reference that would make the app phone home. */
const isSafeImageDataUrl = (value: string): boolean =>
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);

/** A date with no time component, which the ES spec parses as UTC rather than local. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a date string based on an explicit format selection. Every supported
 * format resolves a date without a time to **local** midnight, so that two rows
 * in one file never disagree about what a calendar day means.
 * Supported formats:
 * - 'iso': ISO 8601 string or standard YYYY-MM-DD / ISO format
 * - 'dmy': Day/Month/Year e.g., DD/MM/YYYY or DD-MM-YYYY (with optional time)
 * - 'mdy': Month/Day/Year e.g., MM/DD/YYYY or MM-DD-YYYY (with optional time)
 */
/**
 * A CSV time-of-day, in whatever shape a spreadsheet exported it, as `HH:MM:SS`.
 *
 * A locale that writes dates as `dd/mm/yyyy` generally writes times as
 * `2:30 PM`, and those two go together in the same export. Pasting one straight
 * into an ISO string produced `...T2:30 PM`, which every engine rejects, so the
 * row failed to parse and disappeared into an undifferentiated skipped count —
 * the user was told their file was malformed when it was their own tool's
 * output. 24-hour times are normalised too: `9:05` is not valid ISO either.
 *
 * Returns null when the text is not a time at all, so the caller can say so
 * rather than producing an Invalid Date.
 */
export function normalizeTimePart(raw: string): string | null {
  const text = raw.trim();
  if (!text) return '00:00:00';

  const match = text.match(/^(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(?:([ap])\.?\s*m\.?)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] === undefined ? 0 : parseInt(match[2], 10);
  const seconds = match[3] === undefined ? 0 : parseInt(match[3], 10);
  const meridiem = match[4]?.toLowerCase();

  if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
  if (minutes > 59 || seconds > 59) return null;

  if (meridiem) {
    // 12-hour clock: 12am is midnight and 12pm is noon, so 12 maps to 0 before
    // the pm offset rather than after it.
    if (hours < 1 || hours > 12) return null;
    if (hours === 12) hours = 0;
    if (meridiem === 'p') hours += 12;
  } else if (hours > 23) {
    return null;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function parseCSVDate(dateStr: string, format: 'iso' | 'dmy' | 'mdy' = 'iso'): Date {
  if (!dateStr || typeof dateStr !== 'string') {
    return new Date(NaN);
  }
  const str = dateStr.trim();
  if (!str) return new Date(NaN);

  if (format === 'iso') {
    // A bare YYYY-MM-DD is parsed as UTC midnight by the ES spec, while the
    // same string with a time attached is parsed as local. Left alone, a
    // date-only row and a dated-and-timed row in the same file disagree by the
    // UTC offset — east of Greenwich that lands the date-only row on the
    // previous calendar day. Anchoring to local midnight makes every row in a
    // file mean the same thing, and matches how the report builds its custom
    // range (`new Date(customStart + 'T00:00:00')`).
    return new Date(DATE_ONLY_RE.test(str) ? `${str}T00:00:00` : str);
  }

  // Split date and time parts (e.g., "01/02/2024 14:30:00" or "01/02/2024")
  const parts = str.split(/\s+/);
  const datePart = parts[0];
  const timePart = parts.slice(1).join(' ');

  const dateTokens = datePart.split(/[/.-]/);
  if (dateTokens.length !== 3) {
    return new Date(NaN);
  }

  let day: number, month: number, year: number;
  if (format === 'dmy') {
    day = parseInt(dateTokens[0], 10);
    month = parseInt(dateTokens[1], 10);
    year = parseInt(dateTokens[2], 10);
  } else {
    // 'mdy'
    month = parseInt(dateTokens[0], 10);
    day = parseInt(dateTokens[1], 10);
    year = parseInt(dateTokens[2], 10);
  }

  if (isNaN(day) || isNaN(month) || isNaN(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return new Date(NaN);
  }

  // Two-digit year handling if present, otherwise assume full year
  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }

  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  const paddedYear = String(year).padStart(4, '0');

  // Always carry a time component: see the note in the 'iso' branch above. A
  // date-only row must mean local midnight, not UTC midnight.
  const normalizedTime = normalizeTimePart(timePart);
  if (normalizedTime === null) return new Date(NaN);

  return new Date(`${paddedYear}-${paddedMonth}-${paddedDay}T${normalizedTime}`);
}

export interface BackupValidationOptions {
  /**
   * Whether concurrent timers will be allowed **after** the import. In merge
   * mode that is the local setting, not the file's — the file's setting may not
   * even be applied. Defaults to the file's when omitted.
   */
  allowConcurrentTimers?: boolean;
  /**
   * Running entries already stored locally that this import will not overwrite.
   * They count toward the post-import running total in merge mode.
   */
  existingRunningCount?: number;
}

/**
 * @param knownTimecodeIds Timecode ids that will exist after the import but are
 *   not carried in the payload — in merge mode, the ones already stored
 *   locally. Omitted for a replace, where nothing survives that is not in the
 *   file.
 */
export function validateBackupPayload(
  parsed: any,
  knownTimecodeIds?: Set<string>,
  options?: BackupValidationOptions
): void {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Import failed: Backup data is not a valid JSON object.');
  }

  if (!Array.isArray(parsed.groups)) {
    throw new Error('Import failed: "groups" must be an array.');
  }
  if (!Array.isArray(parsed.timecodes)) {
    throw new Error('Import failed: "timecodes" must be an array.');
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error('Import failed: "entries" must be an array.');
  }

  if (parsed.entries.length > MAX_IMPORT_ENTRIES) {
    throw new Error(`Import failed: Backup contains ${parsed.entries.length} entries, exceeding the maximum cap of ${MAX_IMPORT_ENTRIES}.`);
  }

  // Validate duplicate IDs in groups
  const groupIds = new Set<string>();
  for (let i = 0; i < parsed.groups.length; i++) {
    const g = parsed.groups[i];
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || typeof g.name !== 'string') {
      throw new Error(`Import failed: group at index ${i} is malformed.`);
    }
    if (groupIds.has(g.id)) {
      throw new Error(`Import failed: duplicate group ID "${g.id}".`);
    }
    groupIds.add(g.id);
  }

  // Validate duplicate IDs in timecodes
  const resolvableTimecodeIds = new Set<string>(knownTimecodeIds ?? []);
  const timecodeIdsInPayload = new Set<string>();
  for (let i = 0; i < parsed.timecodes.length; i++) {
    const tc = parsed.timecodes[i];
    if (!tc || typeof tc !== 'object' || typeof tc.id !== 'string' || typeof tc.name !== 'string') {
      throw new Error(`Import failed: timecode at index ${i} is malformed.`);
    }
    if (timecodeIdsInPayload.has(tc.id)) {
      throw new Error(`Import failed: duplicate timecode ID "${tc.id}".`);
    }
    timecodeIdsInPayload.add(tc.id);
    // Finite and non-negative, matching every settings field and the app's own
    // rate editor, which stores null rather than a rate of zero or less.
    // `Number.isNaN` alone let `Infinity` through — 1e999 parses to it — and
    // `roundCurrency` then returns 0, so the timecode billed nothing on the
    // invoice with no error anywhere.
    if (tc.hourlyRate !== undefined && tc.hourlyRate !== null) {
      if (typeof tc.hourlyRate !== 'number' || !Number.isFinite(tc.hourlyRate) || tc.hourlyRate < 0) {
        throw new Error(`Import failed: timecode "${tc.name || i}" has an invalid hourly rate.`);
      }
    }
    resolvableTimecodeIds.add(tc.id);
  }

  // Validate entries
  const entryIds = new Set<string>();
  let runningCount = 0;
  for (let i = 0; i < parsed.entries.length; i++) {
    const e = parsed.entries[i];
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.timecodeId !== 'string') {
      throw new Error(`Import failed: entry at index ${i} is malformed.`);
    }

    if (entryIds.has(e.id)) {
      throw new Error(`Import failed: duplicate entry ID "${e.id}".`);
    }
    entryIds.add(e.id);

    if (e.isRunning === true) {
      runningCount++;
      if (e.endTime !== null && e.endTime !== undefined) {
        throw new Error(`Import failed: entry at index ${i} is marked running but has an end time.`);
      }
    }

    if (e.duration !== undefined && e.duration !== null) {
      if (typeof e.duration !== 'number' || !Number.isFinite(e.duration) || e.duration < 0) {
        throw new Error(`Import failed: entry at index ${i} has an invalid duration.`);
      }
    }

    // A negative manual amount is a credit, so only a non-numeric or non-finite
    // one is invalid here. The finite check still earns its place: 1e999 parses
    // to Infinity and `roundCurrency` would turn that into a silent 0. Hourly
    // rates above stay non-negative — a credit is a fixed amount, not a rate.
    if (e.manualAmount !== undefined && e.manualAmount !== null) {
      if (typeof e.manualAmount !== 'number' || !Number.isFinite(e.manualAmount)) {
        throw new Error(`Import failed: entry at index ${i} has an invalid manual amount.`);
      }
    }

    if (typeof e.startTime !== 'string' || !e.startTime.trim() || Number.isNaN(Date.parse(e.startTime))) {
      throw new Error(`Import failed: entry at index ${i} has an invalid start time.`);
    }

    if (e.endTime !== undefined && e.endTime !== null) {
      if (typeof e.endTime !== 'string' || Number.isNaN(Date.parse(e.endTime))) {
        throw new Error(`Import failed: entry at index ${i} has an invalid end time.`);
      }
    }

    if (e.pausedSegments !== undefined && e.pausedSegments !== null) {
      if (!Array.isArray(e.pausedSegments)) {
        throw new Error(`Import failed: entry at index ${i} has invalid paused segments.`);
      }
      // Array.isArray alone let `[1, 2, 3]` through, which then became NaN
      // inside the duration maths.
      for (const segment of e.pausedSegments) {
        if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
          throw new Error(`Import failed: entry at index ${i} has a malformed paused segment.`);
        }
        if (typeof segment.pauseStart !== 'string' || Number.isNaN(Date.parse(segment.pauseStart))) {
          throw new Error(`Import failed: entry at index ${i} has a paused segment with an invalid start.`);
        }
        if (segment.pauseEnd !== undefined && segment.pauseEnd !== null) {
          if (typeof segment.pauseEnd !== 'string' || Number.isNaN(Date.parse(segment.pauseEnd))) {
            throw new Error(`Import failed: entry at index ${i} has a paused segment with an invalid end.`);
          }
        }
      }
    }

    // An entry whose timecode does not resolve reports its hours under
    // "Unknown" and, having no rate to bill against, silently contributes
    // nothing to the invoice total.
    if (!resolvableTimecodeIds.has(e.timecodeId)) {
      throw new Error(
        `Import failed: entry at index ${i} refers to timecode "${e.timecodeId}", which is not in this backup. ` +
        `Re-export the backup so it includes every timecode its entries use.`
      );
    }

    if (typeof e.endTime === 'string' && e.endTime.trim()) {
      if (Date.parse(e.endTime) < Date.parse(e.startTime)) {
        throw new Error(`Import failed: entry at index ${i} ends before it starts.`);
      }
    }

    if (e.note !== undefined && e.note !== null) {
      if (typeof e.note !== 'string') {
        throw new Error(`Import failed: entry at index ${i} has an invalid note.`);
      }
      if (e.note.length > 2000) {
        throw new Error(`Import failed: entry at index ${i} note exceeds maximum length of 2000 characters.`);
      }
    }

    if (e.tags !== undefined && e.tags !== null) {
      if (!Array.isArray(e.tags) || e.tags.some((t: any) => typeof t !== 'string')) {
        throw new Error(`Import failed: entry at index ${i} has invalid tags.`);
      }
      if (e.tags.length > 20) {
        throw new Error(`Import failed: entry at index ${i} has more than 20 tags.`);
      }
      const tagsString = e.tags.join(', ');
      if (tagsString.length > 500) {
        throw new Error(`Import failed: entry at index ${i} tags exceed maximum length of 500 characters.`);
      }
    }

    // The edit modal formats `editedAt` with date-fns, which throws on an
    // invalid date rather than printing a placeholder. An unvalidated entry
    // carrying one made its own edit modal throw on every open, permanently,
    // with no way to repair it from the UI — so the timestamp is checked here
    // like every other date on the record.
    if (e.editHistory !== undefined && e.editHistory !== null) {
      if (!Array.isArray(e.editHistory)) {
        throw new Error(`Import failed: entry at index ${i} has an invalid edit history.`);
      }
      if (e.editHistory.length > MAX_EDIT_HISTORY) {
        throw new Error(
          `Import failed: entry at index ${i} has more than ${MAX_EDIT_HISTORY} edit history records.`
        );
      }
      for (const change of e.editHistory) {
        if (!change || typeof change !== 'object' || Array.isArray(change)) {
          throw new Error(`Import failed: entry at index ${i} has a malformed edit history record.`);
        }
        if (typeof change.field !== 'string' || change.field.length > 100) {
          throw new Error(
            `Import failed: entry at index ${i} has an edit history record with an invalid field name.`
          );
        }
        if (
          typeof change.editedAt !== 'string' ||
          !change.editedAt.trim() ||
          Number.isNaN(Date.parse(change.editedAt))
        ) {
          throw new Error(
            `Import failed: entry at index ${i} has an edit history record with an invalid timestamp.`
          );
        }
        // Rendered with `String(...)`, so anything is printable — but a deeply
        // nested or enormous value is still carried on every read of the entry.
        for (const key of ['oldValue', 'newValue'] as const) {
          const value = change[key];
          if (value !== undefined && value !== null && typeof value === 'object') {
            if (JSON.stringify(value)?.length > MAX_EDIT_VALUE_CHARS) {
              throw new Error(
                `Import failed: entry at index ${i} has an edit history record whose ${key} is too large.`
              );
            }
          } else if (typeof value === 'string' && value.length > MAX_EDIT_VALUE_CHARS) {
            throw new Error(
              `Import failed: entry at index ${i} has an edit history record whose ${key} is too large.`
            );
          }
        }
      }
    }
  }

  // The constraint that matters is the one in force after the import. Reading
  // it from the file meant a merge could pass validation on the file's
  // permissive setting and then land two running timers in a database whose own
  // setting forbids them.
  const allowConcurrent = options?.allowConcurrentTimers ?? Boolean(parsed.settings?.allowConcurrentTimers);
  const totalRunning = runningCount + (options?.existingRunningCount ?? 0);
  if (!allowConcurrent && totalRunning > 1) {
    const existingRunning = options?.existingRunningCount ?? 0;
    throw new Error(
      existingRunning > 0
        ? `Import failed: this would leave ${totalRunning} running timers (${runningCount} in the backup, ${existingRunning} already running here) while concurrent timers are disabled.`
        : `Import failed: Backup contains ${runningCount} running entries while concurrent timers are disabled.`
    );
  }

  validateSettings(parsed.settings, resolvableTimecodeIds);
}

function validateSettings(settings: any, resolvableTimecodeIds?: Set<string>): void {
  if (settings === undefined || settings === null) return;

  if (typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Import failed: "settings" must be an object.');
  }

  if (settings.id !== undefined && settings.id !== null && settings.id !== 'user-settings') {
    throw new Error('Import failed: "settings.id" must be "user-settings".');
  }

  if (settings.roundingRule !== undefined && settings.roundingRule !== null) {
    if (!['none', '5min', '10min', '15min'].includes(settings.roundingRule)) {
      throw new Error('Import failed: settings contain an invalid rounding rule.');
    }
  }

  if (settings.roundingScope !== undefined && settings.roundingScope !== null) {
    if (!['entry', 'day', 'timecode', 'invoice'].includes(settings.roundingScope)) {
      throw new Error('Import failed: settings contain an invalid rounding scope.');
    }
  }

  // A percentage, so bounded like the field that sets it (`min="0"`). Unbounded,
  // a hand-edited rate of 5000 silently multiplied every invoice total by 51.
  if (settings.taxRate !== undefined && settings.taxRate !== null) {
    if (
      typeof settings.taxRate !== 'number' ||
      !Number.isFinite(settings.taxRate) ||
      settings.taxRate < 0 ||
      settings.taxRate > 100
    ) {
      throw new Error('Import failed: settings contain an invalid tax rate.');
    }
  }

  if (settings.reminderIntervalDays !== undefined && settings.reminderIntervalDays !== null) {
    if (typeof settings.reminderIntervalDays !== 'number' || !Number.isFinite(settings.reminderIntervalDays) || settings.reminderIntervalDays < 0) {
      throw new Error('Import failed: settings contain an invalid reminderIntervalDays value.');
    }
  }

  if (settings.weeklyTargetHours !== undefined && settings.weeklyTargetHours !== null) {
    if (typeof settings.weeklyTargetHours !== 'number' || !Number.isFinite(settings.weeklyTargetHours) || settings.weeklyTargetHours < 0) {
      throw new Error('Import failed: settings contain an invalid weeklyTargetHours value.');
    }
  }

  if (settings.idleThresholdMinutes !== undefined && settings.idleThresholdMinutes !== null) {
    if (typeof settings.idleThresholdMinutes !== 'number' || !Number.isFinite(settings.idleThresholdMinutes) || settings.idleThresholdMinutes < 0) {
      throw new Error('Import failed: settings contain an invalid idleThresholdMinutes value.');
    }
  }

  if (settings.targetAlertMinutes !== undefined && settings.targetAlertMinutes !== null) {
    if (typeof settings.targetAlertMinutes !== 'number' || !Number.isFinite(settings.targetAlertMinutes) || settings.targetAlertMinutes < 0) {
      throw new Error('Import failed: settings contain an invalid targetAlertMinutes value.');
    }
  }

  if (settings.preparerName !== undefined && settings.preparerName !== null) {
    if (typeof settings.preparerName !== 'string' || settings.preparerName.length > 200) {
      throw new Error('Import failed: settings contain an invalid preparerName.');
    }
  }

  if (settings.preparerCompany !== undefined && settings.preparerCompany !== null) {
    if (typeof settings.preparerCompany !== 'string' || settings.preparerCompany.length > 200) {
      throw new Error('Import failed: settings contain an invalid preparerCompany.');
    }
  }

  if (settings.reportFooterText !== undefined && settings.reportFooterText !== null) {
    if (typeof settings.reportFooterText !== 'string' || settings.reportFooterText.length > 1000) {
      throw new Error('Import failed: settings contain an invalid reportFooterText.');
    }
  }

  if (settings.currencySymbol !== undefined && settings.currencySymbol !== null) {
    if (typeof settings.currencySymbol !== 'string' || settings.currencySymbol.length > 10) {
      throw new Error('Import failed: settings contain an invalid currencySymbol.');
    }
  }

  if (settings.taxLabel !== undefined && settings.taxLabel !== null) {
    if (typeof settings.taxLabel !== 'string' || settings.taxLabel.length > 50) {
      throw new Error('Import failed: settings contain an invalid taxLabel.');
    }
  }

  if (settings.customFields !== undefined && settings.customFields !== null) {
    if (!Array.isArray(settings.customFields)) {
      throw new Error('Import failed: settings customFields must be an array.');
    }
    for (const cf of settings.customFields) {
      if (!cf || typeof cf !== 'object' || typeof cf.id !== 'string' || typeof cf.label !== 'string' || typeof cf.value !== 'string') {
        throw new Error('Import failed: settings customFields contain a malformed item.');
      }
      if (cf.label.length > 200 || cf.value.length > 200) {
        throw new Error('Import failed: settings customFields item exceeds maximum length.');
      }
    }
  }

  if (settings.templates !== undefined && settings.templates !== null) {
    if (!Array.isArray(settings.templates)) {
      throw new Error('Import failed: settings templates must be an array.');
    }
    for (let i = 0; i < settings.templates.length; i++) {
      const tmpl = settings.templates[i];
      if (!tmpl || typeof tmpl !== 'object' || typeof tmpl.id !== 'string' || typeof tmpl.title !== 'string' || typeof tmpl.timecodeId !== 'string') {
        throw new Error(`Import failed: template at index ${i} is malformed.`);
      }
      if (resolvableTimecodeIds && !resolvableTimecodeIds.has(tmpl.timecodeId)) {
        throw new Error(`Import failed: template at index ${i} refers to timecode "${tmpl.timecodeId}", which is not in this backup.`);
      }
      if (tmpl.durationMinutes !== undefined && tmpl.durationMinutes !== null) {
        if (typeof tmpl.durationMinutes !== 'number' || !Number.isFinite(tmpl.durationMinutes) || tmpl.durationMinutes < 0) {
          throw new Error(`Import failed: template at index ${i} has an invalid durationMinutes.`);
        }
      }
      if (tmpl.expectedDurationMinutes !== undefined && tmpl.expectedDurationMinutes !== null) {
        if (typeof tmpl.expectedDurationMinutes !== 'number' || !Number.isFinite(tmpl.expectedDurationMinutes) || tmpl.expectedDurationMinutes < 0) {
          throw new Error(`Import failed: template at index ${i} has an invalid expectedDurationMinutes.`);
        }
      }
      if (tmpl.note !== undefined && tmpl.note !== null) {
        if (typeof tmpl.note !== 'string' || tmpl.note.length > 2000) {
          throw new Error(`Import failed: template at index ${i} has an invalid note.`);
        }
      }
      if (tmpl.tags !== undefined && tmpl.tags !== null) {
        if (!Array.isArray(tmpl.tags) || tmpl.tags.some((t: any) => typeof t !== 'string') || tmpl.tags.length > 20) {
          throw new Error(`Import failed: template at index ${i} has invalid tags.`);
        }
      }
    }
  }

  // A logo is rendered directly into an <img>. Anything other than an inline
  // data URL would make a privacy-first, offline app issue a network request,
  // and turns a shared backup file into a tracking pixel.
  if (settings.userLogoBase64 !== undefined && settings.userLogoBase64 !== null) {
    if (typeof settings.userLogoBase64 !== 'string' || !isSafeImageDataUrl(settings.userLogoBase64)) {
      throw new Error('Import failed: settings contain an invalid logo image.');
    }
    if (settings.userLogoBase64.length > MAX_LOGO_DATA_URL_LENGTH) {
      throw new Error('Import failed: settings contain an oversized logo image.');
    }
  }
}
