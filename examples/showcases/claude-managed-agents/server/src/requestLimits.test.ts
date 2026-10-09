import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";

import { createCopilotRequestBodyParser } from "./runtimeLimits.ts";
import {
  configureDemoRunLimits,
  DEMO_RUN_ROUTE,
  GLOBAL_LIMIT_MESSAGE,
  PER_IP_LIMIT_MESSAGE,
} from "./requestLimits.ts";

interface TestServerOptions {
  perIpLimit: number;
  globalLimit: number;
  railway?: boolean;
}

async function startTestServer(options: TestServerOptions) {
  const app = express();
  const rawParser = createCopilotRequestBodyParser();
  let parsedRequests = 0;
  configureDemoRunLimits(
    app,
    (request, response, next) => {
      parsedRequests += 1;
      rawParser(request, response, next);
    },
    {
      perIpLimit: options.perIpLimit,
      globalLimit: options.globalLimit,
      railwayEnvironmentId: options.railway ? "test-environment" : "",
    },
  );
  app.post(DEMO_RUN_ROUTE, (request, response) => {
    response.sendStatus(Number(request.get("x-test-status") ?? 204));
  });
  app.get("/api/copilotkit/info", (_request, response) => {
    response.sendStatus(204);
  });
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 413
      ) {
        response.sendStatus(413);
        return;
      }
      next(error);
    },
  );

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    parsedRequests: () => parsedRequests,
  };
}

function startRun(
  url: string,
  options: {
    path?: string;
    realIp?: string;
    forwardedFor?: string;
    status?: number;
    body?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.realIp) headers["x-real-ip"] = options.realIp;
  if (options.forwardedFor) {
    headers["x-forwarded-for"] = options.forwardedFor;
  }
  if (options.status) headers["x-test-status"] = String(options.status);

  return fetch(`${url}${options.path ?? DEMO_RUN_ROUTE}`, {
    method: "POST",
    headers,
    body: options.body ?? "{}",
  });
}

test("rejects every runtime run alias and the unused suggestion route", async (t) => {
  const testServer = await startTestServer({
    perIpLimit: 20,
    globalLimit: 10,
  });
  t.after(() => testServer.server.close());

  const rejectedPaths = [
    "/api/copilotkit/prefix/agent/financial-assistant/run",
    "/api/copilotkit//agent/financial-assistant/run",
    "/api/copilotkit/agent/financial-assistant/run//",
    "/api/copilotkit/agent/unknown/run",
    "/api/copilotkit/agent/financial-assistant/suggest",
  ];
  for (const path of rejectedPaths) {
    assert.equal((await startRun(testServer.url, { path })).status, 404, path);
  }

  assert.equal(testServer.parsedRequests(), 0);
  assert.equal((await startRun(testServer.url)).status, 204);
  assert.equal(testServer.parsedRequests(), 1);
});

test("applies the per-IP limit before parsing without spending global quota", async (t) => {
  const { server, url } = await startTestServer({
    perIpLimit: 1,
    globalLimit: 1,
    railway: true,
  });
  t.after(() => server.close());

  const oversized = await startRun(url, {
    realIp: "198.51.100.10",
    body: JSON.stringify({ payload: "x".repeat(256 * 1024) }),
  });
  const sameClient = await startRun(url, { realIp: "198.51.100.10" });
  const accepted = await startRun(url, { realIp: "198.51.100.11" });
  const globallyRejected = await startRun(url, {
    realIp: "198.51.100.12",
  });

  assert.equal(oversized.status, 413);
  assert.equal(sameClient.status, 429);
  assert.deepEqual(await sameClient.json(), { error: PER_IP_LIMIT_MESSAGE });
  assert.equal(accepted.status, 204);
  assert.equal(globallyRejected.status, 429);
  assert.deepEqual(await globallyRejected.json(), {
    error: GLOBAL_LIMIT_MESSAGE,
  });
});

test("keys Railway clients from X-Real-IP and ignores X-Forwarded-For", async (t) => {
  const { server, url } = await startTestServer({
    perIpLimit: 1,
    globalLimit: 10,
    railway: true,
  });
  t.after(() => server.close());

  const first = await startRun(url, {
    realIp: "198.51.100.20",
    forwardedFor: "203.0.113.1",
  });
  const sameClient = await startRun(url, {
    realIp: "198.51.100.20",
    forwardedFor: "203.0.113.2",
  });
  const otherClient = await startRun(url, {
    realIp: "198.51.100.21",
    forwardedFor: "203.0.113.1",
  });

  assert.equal(first.status, 204);
  assert.equal(sameClient.status, 429);
  assert.equal(otherClient.status, 204);
});

test("normalizes Railway IPv6 and buckets invalid client headers together", async (t) => {
  const { server, url } = await startTestServer({
    perIpLimit: 1,
    globalLimit: 10,
    railway: true,
  });
  t.after(() => server.close());

  assert.equal((await startRun(url)).status, 204);
  assert.equal((await startRun(url, { realIp: "not-an-ip" })).status, 429);
  assert.equal(
    (await startRun(url, { realIp: "2001:db8:abcd:1200::1" })).status,
    204,
  );
  assert.equal(
    (await startRun(url, { realIp: "2001:db8:abcd:12ff::2" })).status,
    429,
  );
  assert.equal(
    (await startRun(url, { realIp: "2001:db8:abcd:1300::1" })).status,
    204,
  );
});

test("does not spend global allowance on per-IP or downstream rejections", async (t) => {
  const { server, url } = await startTestServer({
    perIpLimit: 1,
    globalLimit: 2,
    railway: true,
  });
  t.after(() => server.close());

  assert.equal(
    (await startRun(url, { realIp: "203.0.113.30", status: 400 })).status,
    400,
  );
  assert.equal((await startRun(url, { realIp: "203.0.113.30" })).status, 429);
  assert.equal((await startRun(url, { realIp: "203.0.113.31" })).status, 204);
  assert.equal((await startRun(url, { realIp: "203.0.113.32" })).status, 204);
  assert.equal((await startRun(url, { realIp: "203.0.113.33" })).status, 429);
});

test("does not spend either allowance on unrelated CopilotKit routes", async (t) => {
  const { server, url } = await startTestServer({
    perIpLimit: 1,
    globalLimit: 1,
  });
  t.after(() => server.close());

  assert.equal((await fetch(`${url}/api/copilotkit/info`)).status, 204);
  assert.equal((await fetch(`${url}/api/copilotkit/info`)).status, 204);
  assert.equal((await startRun(url)).status, 204);
  assert.equal((await startRun(url)).status, 429);
});

test("does not enable Express proxy trust on Railway", () => {
  const app = express();
  configureDemoRunLimits(app, createCopilotRequestBodyParser(), {
    railwayEnvironmentId: "test-environment",
  });

  assert.equal(app.get("trust proxy"), false);
});
