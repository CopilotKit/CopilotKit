/**
 * `modelFetch` (src/lib/cloudflare-agents.ts): the fetch of the model clients
 * the Next.js app calls itself, which is the voice route's transcription
 * client. It must carry the integration's aimock context and the probe's
 * aimock/diagnostic headers, and nothing else from the browser request.
 *
 * This app has no vitest harness, so the test is self-contained:
 *
 *     node --import tsx tests/unit/model-fetch.test.mts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as lib from "../../src/lib/cloudflare-agents.ts";

// The app's sources load as CommonJS under tsx, where Node puts the exports
// on `default`.
const { modelFetch, withForwardedHeaders } =
  (lib as typeof lib & { default?: typeof lib }).default ?? lib;

function captureFetch() {
  const seen: Headers[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return new Response("{}");
  }) as typeof fetch;
  return seen;
}

test("adds the probe's aimock and diagnostic headers, and the integration's context", async () => {
  const seen = captureFetch();
  const inbound = new Request("http://app.test/api/copilotkit-voice/transcribe", {
    method: "POST",
    headers: {
      "x-aimock-strict": "1",
      "x-test-id": "t-1",
      "x-diag-run-id": "run-1",
      "x-aimock-context": "cloudflare-agents",
      "x-forwarded-for": "10.0.0.1",
      "x-copilotkit-runtime-client-gql-version": "1",
    },
  });

  await withForwardedHeaders(inbound, () =>
    modelFetch("http://aimock.test/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: "Bearer test" },
    }),
  );

  const headers = seen[0]!;
  assert.equal(headers.get("x-aimock-context"), "cloudflare-agents");
  assert.equal(headers.get("x-aimock-strict"), "1");
  assert.equal(headers.get("x-test-id"), "t-1");
  assert.equal(headers.get("x-diag-run-id"), "run-1");
  assert.equal(headers.get("authorization"), "Bearer test");
  assert.equal(headers.get("x-forwarded-for"), null);
  assert.equal(headers.get("x-copilotkit-runtime-client-gql-version"), null);
});

test("sends the integration's context on browser traffic that carries no headers", async () => {
  const seen = captureFetch();
  const inbound = new Request("http://app.test/api/copilotkit-voice/transcribe", {
    method: "POST",
  });

  await withForwardedHeaders(inbound, () =>
    modelFetch("http://aimock.test/v1/audio/transcriptions", { method: "POST" }),
  );

  assert.equal(seen[0]!.get("x-aimock-context"), "cloudflare-agents");
  assert.equal(seen[0]!.get("x-test-id"), null);
});

test("works outside a request scope and without init", async () => {
  const seen = captureFetch();
  await modelFetch("http://aimock.test/v1/models");
  assert.equal(seen[0]!.get("x-aimock-context"), "cloudflare-agents");
});
