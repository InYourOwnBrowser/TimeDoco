import { createHash } from 'node:crypto';
import { cpSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** A throwaway copy of the built site, so a test can deploy over it. */
export const copySite = (from: string, to: string): string => {
  cpSync(from, to, { recursive: true });
  return resolve(to);
};

const REWRITABLE = new Set(['.js', '.html', '.css', '.webmanifest', '.json']);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/**
 * Deploy a new build of one lazy-loaded chunk over a served site.
 *
 * A deploy gives a changed chunk a new content hash and stops serving the old
 * one. That is the whole failure: a tab that loaded before the deploy still
 * holds the old name, and asks for a file that no longer exists. Renaming the
 * chunk and rewriting every reference to it reproduces that exactly, without
 * needing a second `vite build` inside a test.
 */
export const redeployChunk = (root: string, chunkPrefix: string): { oldName: string; newName: string } => {
  const assets = join(root, 'assets');
  const pattern = new RegExp(`^${chunkPrefix}-[A-Za-z0-9_-]+\\.js$`);
  const oldName = readdirSync(assets).find((name) => pattern.test(name));
  if (!oldName) throw new Error(`No built chunk for ${chunkPrefix} in ${assets}`);

  const newName = `${chunkPrefix}-redeployed.js`;
  renameSync(join(assets, oldName), join(assets, newName));

  for (const file of walk(root)) {
    if (!REWRITABLE.has(file.slice(file.lastIndexOf('.')))) continue;
    const before = readFileSync(file, 'utf8');
    if (!before.includes(oldName)) continue;
    writeFileSync(file, before.split(oldName).join(newName));
  }

  return { oldName, newName };
};

/**
 * Stop serving a chunk without deploying a replacement — a broken deploy, or a
 * bad upload. Reloading cannot fix this one, which is the case the recovery
 * guard has to recognise instead of reloading forever.
 */
export const removeChunk = (root: string, chunkPrefix: string): string => {
  const assets = join(root, 'assets');
  const pattern = new RegExp(`^${chunkPrefix}-[A-Za-z0-9_-]+\\.js$`);
  const name = readdirSync(assets).find((file) => pattern.test(file));
  if (!name) throw new Error(`No built chunk for ${chunkPrefix} in ${assets}`);
  rmSync(join(assets, name));
  return name;
};

/**
 * Deploy a changed copy of one precached file.
 *
 * The precache manifest identifies a file that has no content hash in its name
 * by a revision, and an entry whose revision has not moved is one the next
 * worker adopts from the previous cache rather than re-fetching. So the
 * revision has to move with the content, exactly as it does in a real build —
 * otherwise the "new" worker installs the old bytes and the test proves
 * nothing.
 */
export const redeployAsset = (
  root: string,
  relativePath: string,
  transform: (content: string) => string,
): void => {
  const file = join(root, relativePath);
  const updated = transform(readFileSync(file, 'utf8'));
  writeFileSync(file, updated);

  const swPath = join(root, 'sw.js');
  const sw = readFileSync(swPath, 'utf8');
  const entry = new RegExp(`\\{url:"${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",revision:"[0-9a-f]{32}"\\}`);
  if (!entry.test(sw)) throw new Error(`${relativePath} is not a revisioned precache entry`);
  const revision = createHash('md5').update(updated).digest('hex');
  writeFileSync(swPath, sw.replace(entry, `{url:"${relativePath}",revision:"${revision}"}`));
};
