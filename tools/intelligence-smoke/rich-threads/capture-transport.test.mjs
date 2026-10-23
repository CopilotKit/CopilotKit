import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureHandler, createCapture } from "./capture/transport.mjs";

test("remote capture exports original scoped bytes only with the private bearer token", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capture-http-"));
  const token = "capture-private-".repeat(3);
  const original = {
    type: "CUSTOM",
    threadId: "thread-1",
    value: { nested: [1, 2] },
    metadata: { cpki_event_id: "original-id" },
  };
  try {
    await writeFile(
      join(directory, "ingestion.jsonl"),
      JSON.stringify({ name: "event", payload: original }) + "\n",
    );
    const handler = captureHandler({ directory, token });
    const request = (authorization, id = "thread-1") => {
      const result = {};
      const response = {
        writeHead(status, headers) {
          Object.assign(result, { status, headers });
          return this;
        },
        end(body) {
          result.body = body;
        },
      };
      assert.equal(
        handler(
          {
            url: `/rich-thread-capture/${id}`,
            method: "GET",
            headers: { authorization },
          },
          response,
        ),
        true,
      );
      return result;
    };
    assert.equal(request("Bearer wrong").status, 401);
    assert.equal(request(`Bearer ${token}`, "../secret").status, 400);
    const source = request(`Bearer ${token}`);
    assert.deepEqual(JSON.parse(source.body).events, [original]);
    assert.equal(source.headers["cache-control"], "no-store");
    const client = createCapture({
      provider: "railway",
      scope: {
        capture: { url: "https://owned.example/rich-thread-capture", token },
      },
      fetchImpl: async (url, options) => {
        assert.equal(url.pathname, "/rich-thread-capture/thread-1");
        assert.equal(options.redirect, "error");
        return new Response(request(options.headers.authorization).body);
      },
    });
    assert.deepEqual((await client.read("thread-1")).events, [original]);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("remote failures cannot leak endpoint credentials or fall back to empty evidence", async () => {
  const token = "secret-token-".repeat(3);
  const capture = { url: "https://owned.example/rich-thread-capture", token };
  const client = createCapture({
    provider: "railway",
    scope: { capture },
    fetchImpl: async () => {
      throw new Error(token);
    },
  });
  await assert.rejects(
    client.read("thread-1"),
    (error) =>
      !error.message.includes(token) && error.message.includes("failed"),
  );
  assert.throws(
    () =>
      createCapture({
        provider: "railway",
        scope: { capture: { ...capture, url: "http://owned.example" } },
      }),
    /HTTPS/,
  );
});
