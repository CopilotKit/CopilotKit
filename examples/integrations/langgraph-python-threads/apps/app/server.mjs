import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.join("apps", "app", "dist");
const port = Number(process.env.PORT) || 3000;
const runtimeUrl =
  process.env.COPILOTKIT_RUNTIME_URL ?? "http://localhost:4000/api/copilotkit";

const app = new Hono();

const proxyHandler = async (c) => {
  const requestUrl = new URL(c.req.url);
  const upstreamBase = new URL(
    runtimeUrl.endsWith("/") ? runtimeUrl : `${runtimeUrl}/`,
  );
  const upstreamPath = requestUrl.pathname.replace(/^\/api\/copilotkit\/?/, "");
  const upstreamUrl = new URL(
    `${upstreamPath}${requestUrl.search}`,
    upstreamBase,
  );
  const request = new Request(upstreamUrl, {
    method: c.req.raw.method,
    headers: c.req.raw.headers,
    body:
      c.req.raw.method === "GET" || c.req.raw.method === "HEAD"
        ? undefined
        : c.req.raw.body,
    duplex: "half",
  });

  return fetch(request);
};

app.all("/api/copilotkit", proxyHandler);
app.all("/api/copilotkit/*", proxyHandler);

app.use(
  "*",
  serveStatic({
    root: distRoot,
    rewriteRequestPath: (requestPath) =>
      requestPath.startsWith("/") ? requestPath.slice(1) : requestPath,
  }),
);

app.get("*", serveStatic({ root: distRoot, path: "./index.html" }));

serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    console.log(`[app-server] ready at http://0.0.0.0:${port}`);
  },
);
