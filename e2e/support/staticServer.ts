import { createServer, type Server } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticSite {
  readonly url: string;
  close(): Promise<void>;
}

const fileAt = (root: string, urlPath: string): string | null => {
  // `normalize` collapses `..`, and the prefix check refuses anything that
  // climbed out of the served directory anyway.
  const candidate = resolve(join(root, normalize(decodeURIComponent(urlPath))));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  try {
    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      const index = join(candidate, 'index.html');
      return statSync(index).isFile() ? index : null;
    }
    return stat.isFile() ? candidate : null;
  } catch {
    return null;
  }
};

/**
 * The built site, served the way Cloudflare Pages serves it: static files, a
 * directory index, and `/app/index.html` as the fallback for unknown paths
 * under `/app/` so client-side routes resolve.
 *
 * Each site gets its own directory, so a test that needs to deploy over itself
 * can mutate its copy without touching `dist/` or any other test's server.
 */
export const serveStatic = async (root: string): Promise<StaticSite> => {
  const rootPath = resolve(root);
  const server: Server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = fileAt(rootPath, urlPath) ??
      (urlPath.startsWith('/app/') ? fileAt(rootPath, '/app/index.html') : null);

    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // A stale chunk has to come from the server or the precache, never from
      // the HTTP cache, or the test is measuring the wrong layer.
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done, fail) => {
      server.closeAllConnections();
      server.close((error) => (error ? fail(error) : done()));
    }),
  };
};
