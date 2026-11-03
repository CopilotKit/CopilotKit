import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { Hono } from "hono";
import { CopilotRuntime } from "@copilotkit/runtime";
import { createCopilotNodeListener, createCopilotNodeListener as createCopilotEndpointSingleRouteExpress } from "@copilotkit/runtime/node";
import { createCopilotRuntimeHandler, createCopilotRuntimeHandler as createCopilotEndpointSingleRoute } from "@copilotkit/runtime";

const paths: string[] = [];
const hooks = { onRequest: ({ request }: { request: Request }) => { paths.push(new URL(request.url).pathname); } };
const runtime = new CopilotRuntime({ agents: {} });
const app = express();
app.use(express.json());
const nodeEndpoint = createCopilotNodeListener({ runtime, hooks, basePath: "/api", cors: { allowMethods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"], origin: "https://example.com", credentials: true, allowHeaders: ["authorization", "content-type"] } });
const copilotListener = createCopilotEndpointSingleRouteExpress({ mode: "single-route", runtime, hooks, basePath: "/", cors: false });
const copilotRouter_ = express.Router();
copilotRouter_.post("/", copilotListener);
copilotRouter_.options("/", copilotListener);
app.use("/api/rpc", copilotRouter_);
app.get("/api/rpc", (_req, res) => { res.json({ fallback: true }); });
app.get("/api/rpc/child", (_req, res) => { res.json({ child: true }); });
const copilotRouter = express.Router();
copilotRouter.all(new RegExp("^/api(/.*)?$"), nodeEndpoint);
app.use(copilotRouter);
app.get("/health", (_req, res) => { res.json({ ok: true }); });
const hono = new Hono();
const copilotHandler = createCopilotRuntimeHandler({ cors: true, runtime, basePath: "/api" });
hono.all("/api/*", (copilotContext) => copilotHandler(copilotContext.req.raw));
const single = createCopilotEndpointSingleRoute({ cors: true, mode: "single-route", runtime, basePath: "/rpc" });
hono.all("/rpc/*", (copilotContext_) => single(copilotContext_.req.raw));
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
