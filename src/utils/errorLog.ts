type LoggedError = { message: string; stack?: string; timestamp: string; context?: string };
const KEY = 'timedoco-error-log';
const MAX = 20;

export function logError(error: Error, context?: string) {
  try {
    const entries: LoggedError[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    entries.unshift({ message: error.message, stack: error.stack, timestamp: new Date().toISOString(), context });
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch (e) {
    console.error('Failed to log error to localStorage:', e);
  }
}

export function getErrorLog(): LoggedError[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function formatErrorLogForClipboard(): string {
  return getErrorLog().map(e => `[${e.timestamp}]${e.context ? ` (${e.context})` : ''} ${e.message}\n${e.stack || ''}`).join('\n\n');
}
