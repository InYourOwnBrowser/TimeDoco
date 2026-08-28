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

  describe('regression: gaps that previously failed silently', () => {
    it('rejects paused segments that are not segment objects', () => {
      // `[1, 2, 3]` passed Array.isArray, then became NaN in the duration maths.
      const bad = { ...validPayload, entries: [{ ...validPayload.entries[0], pausedSegments: [1, 2, 3] }] };
      expect(() => validateBackupPayload(bad)).toThrow('malformed paused segment');
    });

    it('rejects a paused segment with an unparseable start', () => {
      const bad = {
        ...validPayload,
        entries: [{ ...validPayload.entries[0], pausedSegments: [{ pauseStart: 'nonsense', pauseEnd: null }] }],
      };
      expect(() => validateBackupPayload(bad)).toThrow('invalid start');
    });

    it('accepts a well-formed paused segment', () => {
      const ok = {
        ...validPayload,
        entries: [{
          ...validPayload.entries[0],
          pausedSegments: [{ pauseStart: '2025-01-01T10:10:00.000Z', pauseEnd: '2025-01-01T10:20:00.000Z' }],
        }],
      };
      expect(() => validateBackupPayload(ok)).not.toThrow();
    });

    it('rejects an entry that ends before it starts', () => {
      const bad = {
        ...validPayload,
        entries: [{ ...validPayload.entries[0], endTime: '2025-01-01T09:00:00.000Z' }],
      };
      expect(() => validateBackupPayload(bad)).toThrow('ends before it starts');
    });

    it('rejects a settings object that is not an object', () => {
      expect(() => validateBackupPayload({ ...validPayload, settings: [] })).toThrow('"settings" must be an object');
    });

    it('rejects an invalid rounding rule in settings', () => {
      expect(() => validateBackupPayload({ ...validPayload, settings: { roundingRule: '7min' } }))
        .toThrow('invalid rounding rule');
    });

    it('rejects a non-finite tax rate in settings', () => {
      expect(() => validateBackupPayload({ ...validPayload, settings: { taxRate: 'lots' } }))
        .toThrow('invalid tax rate');
    });

    it('rejects a logo that points at a remote URL', () => {
      // A privacy-first app must not be talked into an outbound request by an
      // imported backup, and a shared backup must not carry a tracking pixel.
      expect(() => validateBackupPayload({
        ...validPayload,
        settings: { userLogoBase64: 'https://tracker.example.com/pixel.png' },
      })).toThrow('invalid logo image');
    });

    it('accepts an inline image data URL as a logo', () => {
      expect(() => validateBackupPayload({
        ...validPayload,
        settings: { userLogoBase64: 'data:image/png;base64,ZmFrZQ==' },
      })).not.toThrow();
    });

    it('still accepts a payload with no settings at all', () => {
      expect(() => validateBackupPayload({ ...validPayload, settings: undefined })).not.toThrow();
    });
  });
});
