export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024; // 20MB
/** ~4MB of base64, comfortably above the 1MB upload cap after encoding. */
export const MAX_LOGO_DATA_URL_LENGTH = 4 * 1024 * 1024;

/** Data URLs only — never a remote reference that would make the app phone home. */
const isSafeImageDataUrl = (value: string): boolean =>
  /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value);

export function validateBackupPayload(parsed: any): void {
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

  // Validate groups
  for (let i = 0; i < parsed.groups.length; i++) {
    const g = parsed.groups[i];
    if (!g || typeof g !== 'object' || typeof g.id !== 'string' || typeof g.name !== 'string') {
      throw new Error(`Import failed: group at index ${i} is malformed.`);
    }
  }

  // Validate timecodes
  for (let i = 0; i < parsed.timecodes.length; i++) {
    const tc = parsed.timecodes[i];
    if (!tc || typeof tc !== 'object' || typeof tc.id !== 'string' || typeof tc.name !== 'string') {
      throw new Error(`Import failed: timecode at index ${i} is malformed.`);
    }
    if (tc.hourlyRate !== undefined && tc.hourlyRate !== null) {
      if (typeof tc.hourlyRate !== 'number' || Number.isNaN(tc.hourlyRate)) {
        throw new Error(`Import failed: timecode "${tc.name || i}" has an invalid hourly rate.`);
      }
    }
  }

  // Validate entries
  for (let i = 0; i < parsed.entries.length; i++) {
    const e = parsed.entries[i];
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.timecodeId !== 'string') {
      throw new Error(`Import failed: entry at index ${i} is malformed.`);
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

  validateSettings(parsed.settings);
}

function validateSettings(settings: any): void {
  if (settings === undefined || settings === null) return;

  if (typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Import failed: "settings" must be an object.');
  }

  if (settings.roundingRule !== undefined && settings.roundingRule !== null) {
    if (!['none', '5min', '10min', '15min'].includes(settings.roundingRule)) {
      throw new Error('Import failed: settings contain an invalid rounding rule.');
    }
  }

  if (settings.taxRate !== undefined && settings.taxRate !== null) {
    if (typeof settings.taxRate !== 'number' || !Number.isFinite(settings.taxRate)) {
      throw new Error('Import failed: settings contain an invalid tax rate.');
    }
  }

  if (settings.templates !== undefined && settings.templates !== null) {
    if (!Array.isArray(settings.templates)) {
      throw new Error('Import failed: settings templates must be an array.');
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
