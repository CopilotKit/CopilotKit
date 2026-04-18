import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");
const port = Number(process.env.PORT) || 3000;
const runtimeUrl =
  process.env.COPILOTKIT_RUNTIME_URL ?? "http://localhost:4000/api/copilotkit";
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type":
      mimeTypes.get(ext) ?? "application/octet-stream; charset=utf-8",
  });
  fs.createReadStream(filePath).pipe(res);
}

async function proxyRequest(req, res) {
  const upstreamBase = new URL(
    runtimeUrl.endsWith("/") ? runtimeUrl : `${runtimeUrl}/`,
  );
  const incomingUrl = new URL(req.url ?? "/", "http://localhost");
  const suffix = incomingUrl.pathname.replace(/^\/api\/copilotkit\/?/, "");
  const target = new URL(`${suffix}${incomingUrl.search}`, upstreamBase);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || key === "host" || key === "content-length") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }
    headers.set(key, value);
  }

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : Readable.toWeb(req),
    duplex: "half",
  });

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  res.writeHead(upstream.status, responseHeaders);

  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url ?? "").startsWith("/api/copilotkit")) {
      await proxyRequest(req, res);
      return;
    }

    const incomingUrl = new URL(req.url ?? "/", "http://localhost");
    const requestedPath =
      incomingUrl.pathname === "/"
        ? "index.html"
        : incomingUrl.pathname.replace(/^\/+/, "");
    const assetPath = path.join(distDir, requestedPath);

    if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
      sendFile(res, assetPath);
      return;
    }

    sendFile(res, path.join(distDir, "index.html"));
  } catch (error) {
    console.error("[app-server] request failed", error);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[app-server] ready at http://0.0.0.0:${port}`);
});
