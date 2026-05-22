import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

/**
 * Static-file HTTP server for the built SPA.
 *
 * - Serves files out of the provided `spaDir`.
 * - SPA fallback: any request that doesn't resolve to an existing file is
 *   served `index.html`. M0 doesn't use client-side routing yet, but the
 *   fallback keeps the behavior stable for M3+ when deep-link URLs land.
 * - Resolves and pins the served root so `..`-traversal can't escape it.
 *
 * The WebSocket server (`startWsServer`) attaches its upgrade handler to
 * the returned `Server`, so launcher boot needs to create this first, then
 * register WS, then `.listen()`.
 */

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export type HttpServerOptions = {
  spaDir: string;
  /**
   * Returned to a placeholder route when the SPA has not been built yet.
   * Lets `pnpm exec tsx bin/studio.ts` work without first running
   * `vite build`.
   */
  devPlaceholderHtml?: string;
};

export function createHttpServer(options: HttpServerOptions): Server {
  const root = resolve(options.spaDir);

  return createServer(async (req, res) => {
    const url = req.url ?? "/";
    const pathOnly = url.split("?")[0] ?? "/";

    // Inspector WS upgrade path is handled by ws-server.ts via `upgrade`
    // event listener. Plain HTTP requests against it just return 404.
    if (pathOnly.startsWith("/__inspector/")) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const file = await resolveStaticFile(root, pathOnly);

    if (file) {
      const contentType =
        MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
      try {
        const data = await fs.readFile(file);
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "no-store");
        res.end(data);
      } catch {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
      return;
    }

    // SPA fallback — index.html for any unresolved path.
    const indexPath = join(root, "index.html");
    try {
      const data = await fs.readFile(indexPath);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(data);
      return;
    } catch {
      // No built SPA yet — fall through to the dev placeholder.
    }

    if (options.devPlaceholderHtml) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(options.devPlaceholderHtml);
      return;
    }

    res.statusCode = 404;
    res.end("Not Found");
  });
}

/**
 * Resolve a URL path to a file inside `root`. Returns `null` when:
 *   - the resolved path escapes `root` (defense against `..` traversal)
 *   - the file doesn't exist
 *   - the resolved path is a directory (callers fall back to SPA index)
 */
async function resolveStaticFile(
  root: string,
  urlPath: string,
): Promise<string | null> {
  const decoded = (() => {
    try {
      return decodeURIComponent(urlPath);
    } catch {
      return urlPath;
    }
  })();

  // Strip leading slash so `join` doesn't reset to absolute root.
  const relative = decoded.replace(/^\/+/, "");
  const candidate = normalize(join(root, relative));

  // Defense against traversal — the resolved path must remain under `root`.
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;

  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) return candidate;
  } catch {
    // ENOENT etc.
  }
  return null;
}
