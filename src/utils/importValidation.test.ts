import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MAX_EDIT_HISTORY, MAX_EDIT_VALUE_CHARS, validateBackupPayload, parseCSVDate, MAX_IMPORT_ENTRIES } from './importValidation';

describe('parseCSVDate', () => {
  it('parses ISO format correctly', () => {
    const d = parseCSVDate('2024-01-02T10:00:00Z', 'iso');
    expect(d.getTime()).not.toBeNaN();
    expect(d.toISOString()).toBe('2024-01-02T10:00:00.000Z');
  });

  it('parses DMY format correctly (01/02/2024 -> 1 Feb 2024)', () => {
    const d = parseCSVDate('01/02/2024 10:00:00', 'dmy');
    expect(d.getTime()).not.toBeNaN();
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(1); // February (0-indexed)
    expect(d.getDate()).toBe(1);
  });

  it('parses MDY format correctly (01/02/2024 -> 2 Jan 2024)', () => {
    const d = parseCSVDate('01/02/2024 10:00:00', 'mdy');
    expect(d.getTime()).not.toBeNaN();
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(0); // January (0-indexed)
    expect(d.getDate()).toBe(2);
  });

  it('returns invalid date for malformed dates', () => {
    expect(parseCSVDate('invalid', 'dmy').getTime()).toBeNaN();
    expect(parseCSVDate('32/01/2024', 'dmy').getTime()).toBeNaN();
    expect(parseCSVDate('01/13/2024', 'dmy').getTime()).toBeNaN();
  });

  // A bare YYYY-MM-DD is UTC per the ES spec; the same date with a time is
  // local. If the importer does not normalise that, a date-only row and a timed
  // row in one file land on different calendar days. These assertions are on the
  // *local* calendar date, so they hold in every zone — including a UTC CI box,
  // where the bug they guard is invisible.
  describe.each(['Pacific/Auckland', 'America/Los_Angeles', 'UTC'])('in %s', (tz) => {
    const originalTz = process.env.TZ;
    beforeAll(() => { process.env.TZ = tz; });
    afterAll(() => { process.env.TZ = originalTz; });

    it('reads a date-only row as that calendar day', () => {
      for (const [input, fmt] of [
        ['2024-03-05', 'iso'],
        ['05/03/2024', 'dmy'],
        ['03/05/2024', 'mdy'],
      ] as const) {
        const d = parseCSVDate(input, fmt);
        expect(d.getTime()).not.toBeNaN();
        expect(d.getFullYear()).toBe(2024);
        expect(d.getMonth()).toBe(2); // March
        expect(d.getDate()).toBe(5);
        expect(d.getHours()).toBe(0);
      }
    });

    it('puts a date-only row and a timed row on the same calendar day', () => {
      for (const [dateOnly, timed, fmt] of [
        ['2024-03-05', '2024-03-05T09:30:00', 'iso'],
        ['05/03/2024', '05/03/2024 09:30:00', 'dmy'],
        ['03/05/2024', '03/05/2024 09:30:00', 'mdy'],
      ] as const) {
        const a = parseCSVDate(dateOnly, fmt);
        const b = parseCSVDate(timed, fmt);
        expect(a.getFullYear()).toBe(b.getFullYear());
        expect(a.getMonth()).toBe(b.getMonth());
        expect(a.getDate()).toBe(b.getDate());
      }
    });

    it('still honours an explicit UTC offset in an ISO row', () => {
      const d = parseCSVDate('2024-03-05T10:00:00Z', 'iso');
      expect(d.toISOString()).toBe('2024-03-05T10:00:00.000Z');
    });
  });
});

describe('validateBackupPayload', () => {
  it('throws error when entries count exceeds MAX_IMPORT_ENTRIES', () => {
    const payload = {
      groups: [],
      timecodes: [{ id: 'tc1', name: 'Work' }],
      entries: Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, i) => ({
        id: `e${i}`,
        timecodeId: 'tc1',
        startTime: '2024-01-01T10:00:00Z',
      })),
    };
    expect(() => validateBackupPayload(payload)).toThrow(/exceeding the maximum cap/);
  });
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

  describe('regression: timecode references must resolve', () => {
    it('rejects an entry whose timecode is absent from the backup', () => {
      // Such an entry reports hours under "Unknown" and, with no rate to bill
      // against, silently contributes nothing to the invoice total.
      const orphan = {
        ...validPayload,
        entries: [{ ...validPayload.entries[0], timecodeId: 'missing-tc' }],
      };
      expect(() => validateBackupPayload(orphan)).toThrow('not in this backup');
    });

    it('accepts an entry resolved by a timecode already stored locally', () => {
      // Merge mode: a partial backup may reference timecodes the user still has.
      const orphan = {
        ...validPayload,
        entries: [{ ...validPayload.entries[0], timecodeId: 'local-tc' }],
      };
      expect(() => validateBackupPayload(orphan, new Set(['local-tc']))).not.toThrow();
      expect(() => validateBackupPayload(orphan, new Set(['other-tc']))).toThrow('not in this backup');
    });

    it('still accepts a payload whose entries all resolve', () => {
      expect(() => validateBackupPayload(validPayload)).not.toThrow();
    });
  });

  describe('M11 validation additions', () => {
    it('rejects duplicate group IDs', () => {
      const payload = {
        ...validPayload,
        groups: [
          { id: 'g1', name: 'G1' },
          { id: 'g1', name: 'G2' },
        ],
      };
      expect(() => validateBackupPayload(payload)).toThrow('duplicate group ID "g1"');
    });

    it('rejects duplicate timecode IDs', () => {
      const payload = {
        ...validPayload,
        timecodes: [
          { id: 'tc1', name: 'TC1' },
          { id: 'tc1', name: 'TC2' },
        ],
      };
      expect(() => validateBackupPayload(payload)).toThrow('duplicate timecode ID "tc1"');
    });

    it('rejects duplicate entry IDs', () => {
      const payload = {
        ...validPayload,
        entries: [
          { ...validPayload.entries[0], id: 'e1' },
          { ...validPayload.entries[0], id: 'e1' },
        ],
      };
      expect(() => validateBackupPayload(payload)).toThrow('duplicate entry ID "e1"');
    });

    it('rejects multiple running entries when allowConcurrentTimers is false', () => {
      const payload = {
        ...validPayload,
        settings: { allowConcurrentTimers: false },
        entries: [
          { id: 'e1', timecodeId: 'tc1', startTime: '2025-01-01T10:00:00.000Z', isRunning: true, endTime: null, duration: 0 },
          { id: 'e2', timecodeId: 'tc1', startTime: '2025-01-01T11:00:00.000Z', isRunning: true, endTime: null, duration: 0 },
        ],
      };
      expect(() => validateBackupPayload(payload)).toThrow(/contains 2 running entries/);
    });

    it('judges concurrency by the setting that will be in force, not the file\'s', () => {
      // The file permits concurrent timers; the database being merged into does
      // not. In merge mode the local setting is the one that matters.
      const payload = {
        groups: [], timecodes: [{ id: 'tc1', name: 'TC', updatedAt: '2025-01-01T00:00:00.000Z' }],
        entries: [
          { id: 'e1', timecodeId: 'tc1', startTime: '2025-01-01T09:00:00.000Z', endTime: null, duration: 0, isRunning: true },
          { id: 'e2', timecodeId: 'tc1', startTime: '2025-01-01T10:00:00.000Z', endTime: null, duration: 0, isRunning: true },
        ],
        settings: { allowConcurrentTimers: true },
      };

      expect(() => validateBackupPayload(payload)).not.toThrow();
      expect(() => validateBackupPayload(payload, undefined, { allowConcurrentTimers: false }))
        .toThrow(/concurrent timers are disabled/);
    });

    it('counts timers already running locally toward the post-merge total', () => {
      // One running entry in the file is fine on its own, but not beside a
      // timer already running here.
      const payload = {
        groups: [], timecodes: [{ id: 'tc1', name: 'TC', updatedAt: '2025-01-01T00:00:00.000Z' }],
        entries: [
          { id: 'e1', timecodeId: 'tc1', startTime: '2025-01-01T09:00:00.000Z', endTime: null, duration: 0, isRunning: true },
        ],
        settings: { allowConcurrentTimers: false },
      };

      expect(() => validateBackupPayload(payload, undefined, { allowConcurrentTimers: false })).not.toThrow();
      expect(() =>
        validateBackupPayload(payload, undefined, { allowConcurrentTimers: false, existingRunningCount: 1 })
      ).toThrow(/already running here/);
    });

    it('accepts multiple running entries when allowConcurrentTimers is true', () => {
      const payload = {
        ...validPayload,
        settings: { allowConcurrentTimers: true },
        entries: [
          { id: 'e1', timecodeId: 'tc1', startTime: '2025-01-01T10:00:00.000Z', isRunning: true, endTime: null, duration: 0 },
          { id: 'e2', timecodeId: 'tc1', startTime: '2025-01-01T11:00:00.000Z', isRunning: true, endTime: null, duration: 0 },
        ],
      };
      expect(() => validateBackupPayload(payload)).not.toThrow();
    });

    it('rejects running entry with an end time', () => {
      const payload = {
        ...validPayload,
        entries: [
          { id: 'e1', timecodeId: 'tc1', startTime: '2025-01-01T10:00:00.000Z', isRunning: true, endTime: '2025-01-01T11:00:00.000Z', duration: 3600 },
        ],
      };
      expect(() => validateBackupPayload(payload)).toThrow('is marked running but has an end time');
    });

    it('validates settings.templates shape and timecode existence', () => {
      const payloadMissingTC = {
        ...validPayload,
        settings: {
          templates: [
            { id: 't1', title: 'T1', timecodeId: 'missing-tc' },
          ],
        },
      };
      expect(() => validateBackupPayload(payloadMissingTC)).toThrow('refers to timecode "missing-tc"');

      const payloadMalformed = {
        ...validPayload,
        settings: {
          templates: [
            null,
          ],
        },
      };
      expect(() => validateBackupPayload(payloadMalformed)).toThrow('template at index 0 is malformed');
    });

    it('validates settings numerical ranges and string lengths', () => {
      expect(() => validateBackupPayload({ ...validPayload, settings: { reminderIntervalDays: -5 } })).toThrow('invalid reminderIntervalDays');
      expect(() => validateBackupPayload({ ...validPayload, settings: { weeklyTargetHours: NaN } })).toThrow('invalid weeklyTargetHours');
      expect(() => validateBackupPayload({ ...validPayload, settings: { preparerName: 'a'.repeat(201) } })).toThrow('invalid preparerName');
      expect(() => validateBackupPayload({ ...validPayload, settings: { reportFooterText: 'a'.repeat(1001) } })).toThrow('invalid reportFooterText');
    });
  });

  describe('edit history', () => {
    const withHistory = (editHistory: unknown) => ({
      ...validPayload,
      entries: [{ ...validPayload.entries[0], editHistory }],
    });

    it('accepts a well-formed history', () => {
      expect(() =>
        validateBackupPayload(
          withHistory([{ field: 'note', oldValue: 'a', newValue: 'b', editedAt: '2025-01-01T10:00:00.000Z' }]),
        ),
      ).not.toThrow();
    });

    // The timestamp is formatted with date-fns inside the edit modal's own
    // body, which throws rather than degrading — so an entry carrying an
    // unparseable one could not be opened at all, and could not be repaired.
    it.each([
      ['an empty timestamp', ''],
      ['a non-date string', 'not-a-date'],
      ['a number', 1735725600000],
      ['a missing field', undefined],
    ])('rejects %s', (_label, editedAt) => {
      expect(() =>
        validateBackupPayload(withHistory([{ field: 'note', oldValue: 'a', newValue: 'b', editedAt }])),
      ).toThrow(/edit history record with an invalid timestamp/);
    });

    it('rejects a history that is not an array', () => {
      expect(() => validateBackupPayload(withHistory({ field: 'note' }))).toThrow(/invalid edit history/);
    });

    it('rejects a malformed record', () => {
      expect(() => validateBackupPayload(withHistory([null]))).toThrow(/malformed edit history record/);
    });

    it('rejects a non-string field name', () => {
      expect(() =>
        validateBackupPayload(withHistory([{ field: 42, editedAt: '2025-01-01T10:00:00.000Z' }])),
      ).toThrow(/edit history record with an invalid field name/);
    });

    it('caps the number of records', () => {
      const many = Array.from({ length: MAX_EDIT_HISTORY + 1 }, () => ({
        field: 'note',
        oldValue: 'a',
        newValue: 'b',
        editedAt: '2025-01-01T10:00:00.000Z',
      }));
      expect(() => validateBackupPayload(withHistory(many))).toThrow(/more than 1000 edit history records/);
    });

    it('caps the size of a recorded value', () => {
      expect(() =>
        validateBackupPayload(
          withHistory([
            {
              field: 'note',
              oldValue: 'a'.repeat(MAX_EDIT_VALUE_CHARS + 1),
              newValue: 'b',
              editedAt: '2025-01-01T10:00:00.000Z',
            },
          ]),
        ),
      ).toThrow(/oldValue is too large/);
    });
  });
});

describe('parseCSVDate time-of-day handling', () => {
  const local = (y: number, mo: number, d: number, h: number, mi = 0, sec = 0) =>
    new Date(y, mo - 1, d, h, mi, sec, 0).getTime();

  it('reads a 12-hour time in dmy mode', () => {
    // The shape a spreadsheet in a dd/mm/yyyy locale actually exports.
    expect(parseCSVDate('01/02/2024 2:30 PM', 'dmy').getTime()).toBe(local(2024, 2, 1, 14, 30));
    expect(parseCSVDate('01/02/2024 02:30:45 pm', 'dmy').getTime()).toBe(local(2024, 2, 1, 14, 30, 45));
    expect(parseCSVDate('01/02/2024 9:05 AM', 'dmy').getTime()).toBe(local(2024, 2, 1, 9, 5));
  });

  it('reads a 12-hour time in mdy mode', () => {
    expect(parseCSVDate('02/01/2024 2:30 PM', 'mdy').getTime()).toBe(local(2024, 2, 1, 14, 30));
  });

  it('puts noon and midnight on the right side of 12', () => {
    expect(parseCSVDate('01/02/2024 12:00 AM', 'dmy').getTime()).toBe(local(2024, 2, 1, 0, 0));
    expect(parseCSVDate('01/02/2024 12:30 AM', 'dmy').getTime()).toBe(local(2024, 2, 1, 0, 30));
    expect(parseCSVDate('01/02/2024 12:00 PM', 'dmy').getTime()).toBe(local(2024, 2, 1, 12, 0));
    expect(parseCSVDate('01/02/2024 12:45 PM', 'dmy').getTime()).toBe(local(2024, 2, 1, 12, 45));
  });

  it('accepts the punctuation and spacing exports vary on', () => {
    for (const time of ['2:30PM', '2:30 pm', '2:30 p.m.', '2:30 P M']) {
      expect(parseCSVDate(`01/02/2024 ${time}`, 'dmy').getTime()).toBe(local(2024, 2, 1, 14, 30));
    }
  });

  it('pads an unpadded 24-hour time rather than failing on it', () => {
    expect(parseCSVDate('01/02/2024 9:05', 'dmy').getTime()).toBe(local(2024, 2, 1, 9, 5));
    expect(parseCSVDate('01/02/2024 9', 'dmy').getTime()).toBe(local(2024, 2, 1, 9, 0));
  });

  it('still reads a padded 24-hour time', () => {
    expect(parseCSVDate('01/02/2024 14:30:00', 'dmy').getTime()).toBe(local(2024, 2, 1, 14, 30));
  });

  it('treats a date with no time as local midnight', () => {
    expect(parseCSVDate('01/02/2024', 'dmy').getTime()).toBe(local(2024, 2, 1, 0, 0));
  });

  it('rejects a time that is not one', () => {
    for (const time of ['25:00', '13:00 PM', '0:00 AM', '2:75', 'lunchtime', '2:30 XM']) {
      expect(Number.isNaN(parseCSVDate(`01/02/2024 ${time}`, 'dmy').getTime())).toBe(true);
    }
  });
});
