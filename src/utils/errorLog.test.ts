import { describe, it, expect, beforeEach } from 'vitest';
import { logError, getErrorLog, formatErrorLogForClipboard } from './errorLog';

describe('errorLog utility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('logs errors to localStorage and caps at 20 entries', () => {
    for (let i = 1; i <= 25; i++) {
      logError(new Error(`Test error ${i}`), `context-${i}`);
    }

    const log = getErrorLog();
    expect(log.length).toBe(20);
    expect(log[0].message).toBe('Test error 25');
    expect(log[0].context).toBe('context-25');
    expect(log[19].message).toBe('Test error 6');
  });

  it('formats error log for clipboard correctly', () => {
    logError(new Error('Sample error'), 'unit-test');
    const formatted = formatErrorLogForClipboard();
    expect(formatted).toContain('(unit-test) Sample error');
  });
});
