import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveActiveTheme, type ThemeSetting } from './theme';

/**
 * The boot script and the React effect decide the same thing in two places, and
 * the script cannot import the shared rule — it has to run before any module
 * loads. So this executes the real `public/theme-init.js` and checks it lands on
 * the same answer as `resolveActiveTheme` for every combination that matters.
 * Drift between them is a visible flash on load, which no other test would catch.
 */
const BOOT_SCRIPT = readFileSync(resolve(__dirname, '../../public/theme-init.js'), 'utf-8');

type MediaState = 'light' | 'dark' | 'neither' | 'no-matchMedia';

const applyMediaState = (state: MediaState) => {
  if (state === 'no-matchMedia') {
    // Some engines, and any non-browser host, have no matchMedia at all.
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    return;
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      // 'neither' is the case the two implementations used to disagree on.
      matches: state === 'neither' ? false : query.includes(`prefers-color-scheme: ${state}`),
      media: query,
    }),
  });
};

/** Run the real boot script and report the class it put on <html>. */
const runBootScript = (): 'light' | 'dark' => {
  document.documentElement.classList.remove('light', 'dark');
  // Executing the shipped file is the entire point: a copy of its logic here
  // could drift from it exactly as the React side did, which is what this test
  // exists to catch. The input is our own repository file, not user data.
  // eslint-disable-next-line typescript/no-implied-eval, no-implied-eval
  new Function(BOOT_SCRIPT)();
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
};

const STORED: (ThemeSetting | null)[] = [null, 'light', 'dark', 'system'];
const MEDIA: MediaState[] = ['light', 'dark', 'neither', 'no-matchMedia'];

describe('theme-init.js agrees with resolveActiveTheme', () => {
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  });

  for (const stored of STORED) {
    for (const media of MEDIA) {
      it(`stored=${stored ?? 'none'} media=${media}`, () => {
        applyMediaState(media);
        if (stored) localStorage.setItem('theme', stored);

        expect(runBootScript()).toBe(resolveActiveTheme(stored));
      });
    }
  }
});

describe('resolveActiveTheme', () => {
  it('defaults to dark when nothing is stored', () => {
    applyMediaState('light');
    expect(resolveActiveTheme(null)).toBe('dark');
    expect(resolveActiveTheme(undefined)).toBe('dark');
  });

  it('lets an explicit choice override the OS preference', () => {
    applyMediaState('dark');
    expect(resolveActiveTheme('light')).toBe('light');
    applyMediaState('light');
    expect(resolveActiveTheme('dark')).toBe('dark');
  });

  it('does not throw where matchMedia is missing', () => {
    applyMediaState('no-matchMedia');
    expect(() => resolveActiveTheme('system')).not.toThrow();
    expect(resolveActiveTheme('system')).toBe('dark');
  });
});
