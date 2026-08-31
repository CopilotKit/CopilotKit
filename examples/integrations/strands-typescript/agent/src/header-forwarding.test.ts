import assert from "node:assert/strict";
import test from "node:test";

import type { Request } from "express";

import { forwardingFetch, withForwardedHeaders } from "./header-forwarding.js";

function requestWithHeaders(headers: Request["headers"]): Request {
  return { headers } as Request;
}

test("forwards only AIMock and diagnostic probe headers", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedHeaders: Headers | undefined;

  globalThis.fetch = async (_input, init) => {
    forwardedHeaders = new Headers(init?.headers);
    return new Response(null, { status: 204 });
  };

  try {
    await withForwardedHeaders(
      requestWithHeaders({
        "x-aimock-context": "strands-typescript",
        "x-aimock-fixture": "starter-smoke",
        "x-aimock-strict": "true",
        "x-test-id": "probe-123",
        "x-diag-run-id": "run-123",
        "x-diag-hops": "harness",
        "x-forwarded-for": "203.0.113.7",
        "x-user-id": "private-user",
        "x-api-key": "secret",
        authorization: "Bearer secret",
      }),
      () => forwardingFetch("https://api.openai.com/v1/chat/completions"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(forwardedHeaders?.get("x-aimock-context"), "strands-typescript");
  assert.equal(forwardedHeaders?.get("x-aimock-fixture"), "starter-smoke");
  assert.equal(forwardedHeaders?.get("x-aimock-strict"), "true");
  assert.equal(forwardedHeaders?.get("x-test-id"), "probe-123");
  assert.equal(forwardedHeaders?.get("x-diag-run-id"), "run-123");
  assert.equal(forwardedHeaders?.get("x-diag-hops"), "harness");
  assert.equal(forwardedHeaders?.has("x-forwarded-for"), false);
  assert.equal(forwardedHeaders?.has("x-user-id"), false);
  assert.equal(forwardedHeaders?.has("x-api-key"), false);
  assert.equal(forwardedHeaders?.has("authorization"), false);
});

test("does not overwrite headers configured by the model client", async () => {
  const originalFetch = globalThis.fetch;
  let forwardedHeaders: Headers | undefined;

  globalThis.fetch = async (_input, init) => {
    forwardedHeaders = new Headers(init?.headers);
    return new Response(null, { status: 204 });
  };

  try {
    await withForwardedHeaders(
      requestWithHeaders({ "x-aimock-context": "request-context" }),
      () =>
        forwardingFetch("http://aimock:4010/v1/chat/completions", {
          headers: { "x-aimock-context": "configured-context" },
        }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(forwardedHeaders?.get("x-aimock-context"), "configured-context");
});
