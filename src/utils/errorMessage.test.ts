import { describe, it, expect } from 'vitest';
import {
  describeUserFacingError,
  UserFacingError,
  MAX_USER_MESSAGE_CHARS,
} from './errorMessage';
import { validateBackupPayload, MAX_ID_CHARS } from './importValidation';

const GENERIC = (action: string) => `Could not ${action}. Your change was not saved.`;

describe('describeUserFacingError', () => {
  it('passes through a message the app wrote for the user', () => {
    const message = 'Import failed: entry at index 3 has an invalid start time.';
    expect(describeUserFacingError(new Error(message), 'import this backup')).toBe(message);
  });

  // The reason the constructor check exists: "x is not a function" describes a
  // bug in the app, not anything the user did or can act on.
  it('hides a TypeError behind the generic fallback', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'foo')");
    const text = describeUserFacingError(error, 'save the entry');
    expect(text).toBe(GENERIC('save the entry'));
    expect(text).not.toContain('undefined');
  });

  it('hides a DOMException behind the generic fallback', () => {
    const error = new DOMException('The transaction was aborted.');
    expect(describeUserFacingError(error, 'stop the timer')).toBe(GENERIC('stop the timer'));
  });

  it('gives running out of quota its own remedy', () => {
    const error = new DOMException('persistent storage', 'QuotaExceededError');
    const text = describeUserFacingError(error, 'save the entry');
    expect(text).toContain('out of storage for TimeDoco');
    expect(text).toContain('Export a backup');
  });

  // Replacing a long message with the fallback throws away the part that says
  // what went wrong. The opening is the half worth keeping.
  it('truncates an over-long message rather than discarding it', () => {
    const opening = 'Import failed: entry at index 3 refers to a timecode that is not in this backup.';
    const message = opening + ' '.repeat(600 - opening.length - 1) + '.';
    expect(message).toHaveLength(600);

    const text = describeUserFacingError(new Error(message), 'import this backup');

    expect(text).not.toBe(GENERIC('import this backup'));
    expect(text.startsWith(opening)).toBe(true);
    expect(text).toHaveLength(MAX_USER_MESSAGE_CHARS);
    expect(text.endsWith('…')).toBe(true);
  });

  // The message that forced the ceiling up from 200. Thrown by the real
  // validator rather than reproduced here, so a change to its wording cannot
  // leave this test asserting against a string the app no longer raises.
  it('returns the backup validator’s longest message intact', () => {
    const longId = 'x'.repeat(MAX_ID_CHARS);
    const payload = {
      groups: [],
      timecodes: [{ id: 'tc1', name: 'Code 1', hourlyRate: 50 }],
      entries: Array.from({ length: 13 }, (_, i) => ({
        id: `e${i}`,
        // Index 12 is the first to name a timecode the backup does not carry,
        // which is what makes the message its full length.
        timecodeId: i === 12 ? longId : 'tc1',
        startTime: '2025-01-01T10:00:00.000Z',
        endTime: '2025-01-01T11:00:00.000Z',
        duration: 3600,
        manualAmount: null,
        note: 'Valid note',
        tags: [],
        pausedSegments: [],
      })),
    };

    let thrown: unknown;
    try {
      validateBackupPayload(payload);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // Longer than the 200 the cap used to be, so the old rule replaced it.
    expect(message.length).toBeGreaterThan(200);
    expect(message.length).toBeLessThanOrEqual(MAX_USER_MESSAGE_CHARS);
    expect(describeUserFacingError(thrown, 'import this backup')).toBe(message);
  });

  it('reaches the user intact when it is a UserFacingError, at any length', () => {
    const message = 'A'.repeat(MAX_USER_MESSAGE_CHARS + 200);
    expect(describeUserFacingError(new UserFacingError(message), 'import this CSV')).toBe(message);
  });

  it('falls back for a thrown value that is not an Error at all', () => {
    expect(describeUserFacingError('boom', 'save the entry')).toBe(GENERIC('save the entry'));
    expect(describeUserFacingError(null, 'save the entry')).toBe(GENERIC('save the entry'));
  });
});
