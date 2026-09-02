import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Refuse to run against a `dist/` older than the source it came from.
 *
 * Every spec here drives the built application, so a stale build tests code
 * that is no longer in the repository — and it fails, or passes, for reasons
 * that have nothing to do with the working tree. That is not a hypothetical:
 * a blur handler added minutes earlier was absent from `dist/`, and the spec
 * covering it failed as though the fix were wrong.
 *
 * `npm run test:e2e` builds first. This is what stops a bare `playwright test`
 * from quietly doing something else.
 */
const ROOT = resolve(import.meta.dirname, '..', '..');

const newestMtime = (path: string, skip: (name: string) => boolean = () => false): number => {
  let newest = 0;
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      if (skip(name)) continue;
      const child = join(current, name);
      const stat = statSync(child);
      if (stat.isDirectory()) walk(child);
      else newest = Math.max(newest, stat.mtimeMs);
    }
  };
  walk(path);
  return newest;
};

export default function assertBuildIsCurrent() {
  let built: number;
  try {
    built = newestMtime(join(ROOT, 'dist'));
  } catch {
    throw new Error('No dist/ to test. Run `npm run test:e2e`, which builds it first.');
  }

  const sources = Math.max(
    newestMtime(join(ROOT, 'src'), (name) => name.endsWith('.test.ts') || name.endsWith('.test.tsx')),
    ...['index.html', 'vite.config.ts', 'package.json'].map((file) => statSync(join(ROOT, file)).mtimeMs),
    newestMtime(join(ROOT, 'app')),
  );

  if (sources > built) {
    throw new Error(
      'dist/ is older than the source it was built from, so these specs would drive code that is no longer in the tree. ' +
      'Run `npm run test:e2e`, or `npm run build` first.',
    );
  }
}
