export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024; // 20MB

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
}
