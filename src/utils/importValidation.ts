export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_IMPORT_ENTRIES = 50000;
/** ~4MB of base64, comfortably above the 1MB upload cap after encoding. */
export const MAX_LOGO_DATA_URL_LENGTH = 4 * 1024 * 1024;

/** Data URLs only — never a remote reference that would make the app phone home. */
const isSafeImageDataUrl = (value: string): boolean =>
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);

/**
 * Parses a date string based on an explicit format selection.
 * Supported formats:
 * - 'iso': ISO 8601 string or standard YYYY-MM-DD / ISO format
 * - 'dmy': Day/Month/Year e.g., DD/MM/YYYY or DD-MM-YYYY (with optional time)
 * - 'mdy': Month/Day/Year e.g., MM/DD/YYYY or MM-DD-YYYY (with optional time)
 */
export function parseCSVDate(dateStr: string, format: 'iso' | 'dmy' | 'mdy' = 'iso'): Date {
  if (!dateStr || typeof dateStr !== 'string') {
    return new Date(NaN);
  }
  const str = dateStr.trim();
  if (!str) return new Date(NaN);

  if (format === 'iso') {
    const d = new Date(str);
    return d;
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

  let isoStr = `${paddedYear}-${paddedMonth}-${paddedDay}`;
  if (timePart) {
    isoStr += `T${timePart}`;
  }

  return new Date(isoStr);
}

/**
 * @param knownTimecodeIds Timecode ids that will exist after the import but are
 *   not carried in the payload — in merge mode, the ones already stored
 *   locally. Omitted for a replace, where nothing survives that is not in the
 *   file.
 */
export function validateBackupPayload(parsed: any, knownTimecodeIds?: Set<string>): void {
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
    if (tc.hourlyRate !== undefined && tc.hourlyRate !== null) {
      if (typeof tc.hourlyRate !== 'number' || Number.isNaN(tc.hourlyRate)) {
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
      if (typeof e.duration !== 'number' || Number.isNaN(e.duration)) {
        throw new Error(`Import failed: entry at index ${i} has an invalid duration.`);
      }
    }

    if (e.manualAmount !== undefined && e.manualAmount !== null) {
      if (typeof e.manualAmount !== 'number' || Number.isNaN(e.manualAmount)) {
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
  }

  const allowConcurrent = Boolean(parsed.settings?.allowConcurrentTimers);
  if (!allowConcurrent && runningCount > 1) {
    throw new Error(`Import failed: Backup contains ${runningCount} running entries while concurrent timers are disabled.`);
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

  if (settings.taxRate !== undefined && settings.taxRate !== null) {
    if (typeof settings.taxRate !== 'number' || !Number.isFinite(settings.taxRate)) {
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
