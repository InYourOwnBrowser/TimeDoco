import { describe, it, expect } from 'vitest';
import { validateBackupPayload } from './importValidation';

describe('validateBackupPayload', () => {
  const validPayload = {
    groups: [{ id: 'g1', name: 'Group 1' }],
    timecodes: [{ id: 'tc1', name: 'Code 1', hourlyRate: 50 }],
    entries: [
      {
        id: 'e1',
        timecodeId: 'tc1',
        startTime: '2025-01-01T10:00:00.000Z',
        endTime: '2025-01-01T11:00:00.000Z',
        duration: 3600,
        manualAmount: null,
        note: 'Valid note',
        tags: ['work', 'client'],
        pausedSegments: [],
      },
    ],
  };

  it('passes on valid payload structure', () => {
    expect(() => validateBackupPayload(validPayload)).not.toThrow();
  });

  it('rejects null or non-object payloads', () => {
    expect(() => validateBackupPayload(null)).toThrow('Import failed: Backup data is not a valid JSON object.');
    expect(() => validateBackupPayload('string')).toThrow('Import failed: Backup data is not a valid JSON object.');
  });

  it('rejects when groups, timecodes, or entries are missing or not arrays', () => {
    expect(() => validateBackupPayload({ groups: 'not an array', timecodes: [], entries: [] })).toThrow('"groups" must be an array');
    expect(() => validateBackupPayload({ groups: [], timecodes: {}, entries: [] })).toThrow('"timecodes" must be an array');
    expect(() => validateBackupPayload({ groups: [], timecodes: [], entries: null })).toThrow('"entries" must be an array');
  });

  it('rejects invalid numeric fields (NaN or non-number)', () => {
    const invalidRate = {
      ...validPayload,
      timecodes: [{ id: 'tc1', name: 'Code 1', hourlyRate: 'abc' as any }],
    };
    expect(() => validateBackupPayload(invalidRate)).toThrow('has an invalid hourly rate');

    const invalidDuration = {
      ...validPayload,
      entries: [{ ...validPayload.entries[0], duration: 'not a number' as any }],
    };
    expect(() => validateBackupPayload(invalidDuration)).toThrow('has an invalid duration');

    const invalidManualAmount = {
      ...validPayload,
      entries: [{ ...validPayload.entries[0], manualAmount: NaN }],
    };
    expect(() => validateBackupPayload(invalidManualAmount)).toThrow('has an invalid manual amount');
  });

  it('rejects invalid date strings in startTime or endTime', () => {
    const invalidStart = {
      ...validPayload,
      entries: [{ ...validPayload.entries[0], startTime: 'invalid-date' }],
    };
    expect(() => validateBackupPayload(invalidStart)).toThrow('has an invalid start time');

    const invalidEnd = {
      ...validPayload,
      entries: [{ ...validPayload.entries[0], endTime: 'invalid-date' }],
    };
    expect(() => validateBackupPayload(invalidEnd)).toThrow('has an invalid end time');
  });

  it('rejects non-array pausedSegments', () => {
    const invalidPaused = {
      ...validPayload,
      entries: [{ ...validPayload.entries[0], pausedSegments: 'not an array' as any }],
    };
    expect(() => validateBackupPayload(invalidPaused)).toThrow('has invalid paused segments');
  });

  it('rejects note over 2000 characters', () => {
    const longNote = {
      ...validPayload,
      entries: [{ ...validPayload.entries[0], note: 'a'.repeat(2001) }],
    };
    expect(() => validateBackupPayload(longNote)).toThrow('note exceeds maximum length of 2000 characters');
  });

  it('rejects tags with more than 20 items or total length over 500 characters', () => {
    const tooManyTags = {
      ...validPayload,
      entries: [{ ...validPayload.entries[0], tags: Array(21).fill('tag') }],
    };
    expect(() => validateBackupPayload(tooManyTags)).toThrow('has more than 20 tags');

    const longTagsString = {
      ...validPayload,
      entries: [{ ...validPayload.entries[0], tags: ['a'.repeat(501)] }],
    };
    expect(() => validateBackupPayload(longTagsString)).toThrow('tags exceed maximum length of 500 characters');
  });
});
