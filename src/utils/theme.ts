/**
 * Which theme to paint.
 *
 * `public/theme-init.js` makes this same decision before hydration — hand-
 * inlined, because it has to run before any module loads and before first
 * paint. Two implementations of one rule is a standing invitation to drift, and
 * they did: this side asked for `(prefers-color-scheme: dark)` where the script
 * asked for `(prefers-color-scheme: light)` and negated it. Those differ
 * wherever neither query matches, so the script painted dark and React
 * repainted light — the flash the script exists to prevent. This side also had
 * no `matchMedia` guard, so it threw where the script quietly chose dark.
 *
 * The rule lives here now, and `theme.test.ts` executes the real script against
 * this function over the whole matrix, so the two cannot drift again silently.
 */
export type ThemeSetting = 'light' | 'dark' | 'system';

/** The OS preference, asked exactly as the boot script asks it. */
export const prefersDarkScheme = (): boolean =>
  !(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);

/**
 * The class to put on `<html>`: an explicit choice wins, 'system' follows the
 * OS, and nothing stored means the app's own default of dark.
 */
export const resolveActiveTheme = (stored: ThemeSetting | null | undefined): 'light' | 'dark' => {
  if (stored === 'light') return 'light';
  if (stored === 'system') return prefersDarkScheme() ? 'dark' : 'light';
  return 'dark';
};
