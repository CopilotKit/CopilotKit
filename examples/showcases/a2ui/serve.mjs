// Production server for the container. `vite build` emits a fetch handler
// (dist/server/server.js) and static assets (dist/client), not a listening
// server, so this file adapts Node's http server to that handler using only
// Node built-ins. It listens on $PORT (Railway sets it), default 3000.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const clientDir = resolve(root, "dist/client");
const { default: app } = await import(
  new URL("./dist/server/server.js", import.meta.url).href
);

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const types = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

// Serve a file from dist/client if the path names one; otherwise return false.
async function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = normalize(join(clientDir, pathname));
  if (!file.startsWith(clientDir + "/")) return false;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
  });
  if (req.method === "HEAD") return (res.end(), true);
  createReadStream(file).pipe(res);
  return true;
}

function toRequest(req, signal) {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined,
    signal,
  });
}

async function sendResponse(response, res) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") headers[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, response.statusText, headers);
  if (!response.body) return res.end();
  // Streaming (SSE) responses must reach the client as they are produced.
  res.flushHeaders();
  Readable.fromWeb(response.body).pipe(res);
}

createServer(async (req, res) => {
  try {
    if (await serveStatic(req, res)) return;
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    await sendResponse(await app.fetch(toRequest(req, abort.signal)), res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error");
  }
}).listen(port, host, () => {
  console.log(`web listening on http://${host}:${port}`);
});
