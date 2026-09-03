type LoggedError = { message: string; stack?: string; timestamp: string; context?: string };
const KEY = 'timedoco-error-log';
const MAX = 20;

export function logError(error: Error, context?: string) {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
    const entries: LoggedError[] = Array.isArray(stored) ? stored : [];
    entries.unshift({ message: error.message, stack: error.stack, timestamp: new Date().toISOString(), context });
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch (e) {
    console.error('Failed to log error to localStorage:', e);
  }
}

export function getErrorLog(): LoggedError[] {
  try {
    // A tampered or truncated key can parse to a non-array (e.g. `5`), which
    // would then blow up in .map at the call site.
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Remove the stored error log. Part of the app's delete-everything guarantee. */
export function clearErrorLog() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    console.error('Failed to clear error log:', e);
  }
}

export function formatErrorLogForClipboard(): string {
  return getErrorLog().map(e => `[${e.timestamp}]${e.context ? ` (${e.context})` : ''} ${e.message}\n${e.stack || ''}`).join('\n\n');
}
