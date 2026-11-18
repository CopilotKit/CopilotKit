import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { Hono } from "hono";
import { CopilotRuntime } from "@copilotkit/runtime";
import { createCopilotExpressHandler, createCopilotEndpointSingleRouteExpress } from "@copilotkit/runtime/v2/express";
import { createCopilotHonoHandler, createCopilotEndpointSingleRoute } from "@copilotkit/runtime/v2/hono";

const paths: string[] = [];
const hooks = { onRequest: ({ request }: { request: Request }) => { paths.push(new URL(request.url).pathname); } };
const runtime = new CopilotRuntime({ agents: {} });
const app = express();
app.use(express.json());
const nodeEndpoint = createCopilotExpressHandler({ runtime, hooks, basePath: "/api", cors: { origin: "https://example.com", credentials: true, allowedHeaders: ["authorization", "content-type"] } });
app.use("/api/rpc", createCopilotEndpointSingleRouteExpress({ runtime, hooks, basePath: "/", cors: false }));
app.get("/api/rpc", (_req, res) => { res.json({ fallback: true }); });
app.get("/api/rpc/child", (_req, res) => { res.json({ child: true }); });
app.use(nodeEndpoint);
app.get("/health", (_req, res) => { res.json({ ok: true }); });
const hono = new Hono();
hono.route("/", createCopilotHonoHandler({ runtime, basePath: "/api" }));
const single = createCopilotEndpointSingleRoute({ runtime, basePath: "/rpc" });
hono.route("/", single);
hono.get("/health", (c) => c.json({ ok: true }));

async function verify() {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/info`)).status, 200);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const preflight = await fetch(`${base}/api/info`, { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST", "access-control-request-headers": "authorization" } });
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://example.com");
    assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
    assert.ok(preflight.headers.get("access-control-allow-headers")?.includes("authorization"));
    const rpc = await fetch(`${base}/api/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "info" }) });
    assert.equal(rpc.status, 200);
    assert.ok(paths.includes("/api/info"));
    assert.ok(paths.includes("/"));
    assert.deepEqual(await (await fetch(`${base}/api/rpc`)).json(), { fallback: true });
    assert.deepEqual(await (await fetch(`${base}/api/rpc/child`)).json(), { child: true });
    assert.equal(rpc.headers.get("access-control-allow-origin"), null);
    assert.equal((await hono.request("/api/info")).status, 200);
    assert.equal((await hono.request("/health")).status, 200);
    assert.equal((await hono.request("/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "info" }) })).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
void verify();
