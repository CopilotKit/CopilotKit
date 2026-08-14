import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";

import {
  createBrowserRequestGuard,
  createFrameAncestorHeaders,
  DEFAULT_FRAME_ANCESTORS,
} from "./deploymentSecurity.ts";

async function startTestServer(allowedOrigins?: readonly string[]) {
  const app = express();
  app.use(createFrameAncestorHeaders(DEFAULT_FRAME_ANCESTORS));
  app.use("/api/copilotkit", createBrowserRequestGuard(allowedOrigins));
  app.get("/", (_request, response) => {
    response.sendStatus(204);
  });
  app.post("/api/copilotkit", (_request, response) => {
    response.sendStatus(204);
  });

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

test("allows only same-origin browser requests when an origin allowlist is configured", async (t) => {
  const deploymentOrigin = "https://claude-cookbook.example.com";
  const { server, url } = await startTestServer([deploymentOrigin]);
  t.after(() => server.close());

  const allowedResponse = await fetch(`${url}/api/copilotkit`, {
    method: "POST",
    headers: {
      origin: deploymentOrigin,
      "sec-fetch-site": "same-origin",
    },
  });
  const missingOriginResponse = await fetch(`${url}/api/copilotkit`, {
    method: "POST",
  });
  const wrongOriginResponse = await fetch(`${url}/api/copilotkit`, {
    method: "POST",
    headers: {
      origin: "https://attacker.example.com",
      "sec-fetch-site": "same-origin",
    },
  });
  const crossSiteResponse = await fetch(`${url}/api/copilotkit`, {
    method: "POST",
    headers: {
      origin: deploymentOrigin,
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(allowedResponse.status, 204);
  assert.equal(missingOriginResponse.status, 403);
  assert.equal(wrongOriginResponse.status, 403);
  assert.equal(crossSiteResponse.status, 403);
});

test("keeps headerless local requests working when no origin allowlist is configured", async (t) => {
  const { server, url } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(`${url}/api/copilotkit`, { method: "POST" });

  assert.equal(response.status, 204);
});

test("allows the cookbook to be framed only by CopilotKit docs and local previews", async (t) => {
  const { server, url } = await startTestServer();
  t.after(() => server.close());

  const response = await fetch(url);

  assert.equal(
    response.headers.get("content-security-policy"),
    "frame-ancestors https://docs.copilotkit.ai https://*.copilotkit.ai http://localhost:* http://127.0.0.1:*",
  );
});
