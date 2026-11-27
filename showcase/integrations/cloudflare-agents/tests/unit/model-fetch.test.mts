/**
 * `probeHeaderFetch` (src/lib/cloudflare-agents.ts): the fetch of the voice
 * route's transcription client. It carries the probe's aimock and diagnostic
 * headers, so a test stack that points transcription at aimock replays it
 * under this integration's context, and nothing else from the browser
 * request. It adds no aimock context of its own: outside a probe, the
 * transcription goes to the provider as is.
 *
 * This app has no vitest harness, so the test is self-contained:
 *
 *     node --import tsx --test tests/unit/model-fetch.test.mts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as lib from "../../src/lib/cloudflare-agents.ts";

// The app's sources load as CommonJS under tsx, where Node puts the exports
// on `default`.
const { probeHeaderFetch, withForwardedHeaders } =
  (lib as typeof lib & { default?: typeof lib }).default ?? lib;

function captureFetch() {
  const seen: Headers[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return new Response("{}");
  }) as typeof fetch;
  return seen;
}

test("adds the probe's aimock and diagnostic headers, and no other x- header", async () => {
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
    probeHeaderFetch("http://aimock.test/v1/audio/transcriptions", {
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

test("adds no aimock context to traffic that carries none", async () => {
  const seen = captureFetch();
  const inbound = new Request("http://app.test/api/copilotkit-voice/transcribe", {
    method: "POST",
  });

  await withForwardedHeaders(inbound, () =>
    probeHeaderFetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
    }),
  );

  assert.equal(seen[0]!.get("x-aimock-context"), null);
  assert.equal(seen[0]!.get("x-test-id"), null);
});

test("works outside a request scope and without init", async () => {
  const seen = captureFetch();
  await probeHeaderFetch("https://api.openai.com/v1/models");
  assert.equal(seen[0]!.get("x-aimock-context"), null);
});
