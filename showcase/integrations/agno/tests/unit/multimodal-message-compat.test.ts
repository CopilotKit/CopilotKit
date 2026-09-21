import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpAgent } from "@ag-ui/client";
import {
  createAgnoMultimodalFetch,
  normalizeMultimodalRequestBody,
} from "../../src/app/api/copilotkit-multimodal/multimodal-message-compat";

function modern(mimeType: string, value = "Ynl0ZXM=", mode = "data") {
  return {
    type: mimeType.startsWith("image/") ? "image" : "document",
    source: { type: mode, value, mimeType },
    metadata: { filename: "sample" },
  };
}

function request(content: unknown) {
  return {
    threadId: "thread",
    runId: "run",
    state: { preserved: true },
    tools: [],
    context: [],
    forwardedProps: { trace: "keep" },
    messages: [
      { id: "previous", role: "assistant", content: "Earlier answer" },
      { id: "current", role: "user", content },
    ],
  };
}

function assertNormalized(parts: unknown[], expected: unknown[]) {
  const input = request(parts);
  const original = JSON.stringify(input);
  assert.deepEqual(
    JSON.parse(normalizeMultimodalRequestBody(original)),
    request(expected),
  );
  assert.equal(JSON.stringify(input), original);
}

for (const mimeType of ["image/png", "application/pdf"]) {
  test(`removes only the redundant ${mimeType} legacy mirror`, () => {
    const part = modern(mimeType);
    const text = { type: "text", text: "Describe this attachment" };
    assertNormalized(
      [text, part, { type: "binary", mimeType, data: part.source.value }],
      [text, part],
    );
  });

  for (const mode of ["data", "url"]) {
    test(`converts legacy-only ${mimeType} ${mode} without losing metadata`, () => {
      const value = mode === "url" ? "https://example.test/sample" : "Ynl0ZXM=";
      assertNormalized(
        [
          {
            type: "binary",
            mimeType,
            [mode]: value,
            id: "attachment",
            metadata: { filename: "sample" },
          },
        ],
        [{ ...modern(mimeType, value, mode), id: "attachment" }],
      );
    });
  }
}

test("retains distinct bytes and source modes instead of dropping attachments", () => {
  const part = modern("image/png");
  assertNormalized(
    [
      part,
      { type: "binary", mimeType: "image/png", data: "b3RoZXI=" },
      { type: "binary", mimeType: "image/png", url: part.source.value },
    ],
    [
      part,
      {
        type: "image",
        source: { type: "data", value: "b3RoZXI=", mimeType: "image/png" },
      },
      {
        type: "image",
        source: {
          type: "url",
          value: part.source.value,
          mimeType: "image/png",
        },
      },
    ],
  );
});

test("does not match mirrors across MIME types or messages", () => {
  const image = modern("image/png");
  assertNormalized(
    [
      image,
      { type: "binary", mimeType: "application/pdf", data: image.source.value },
    ],
    [
      image,
      {
        type: "document",
        source: {
          type: "data",
          value: image.source.value,
          mimeType: "application/pdf",
        },
      },
    ],
  );
  const legacy = {
    type: "binary",
    mimeType: "image/png",
    data: image.source.value,
  };
  const input = {
    ...request([]),
    messages: [
      { id: "earlier", role: "user", content: [image] },
      { id: "later", role: "user", content: [legacy] },
    ],
  };
  assert.deepEqual(
    JSON.parse(normalizeMultimodalRequestBody(JSON.stringify(input))),
    {
      ...input,
      messages: [
        input.messages[0],
        {
          ...input.messages[1],
          content: [{ type: "image", source: image.source }],
        },
      ],
    },
  );
});

test("leaves modern, text-only, unsupported and malformed input intact", () => {
  for (const content of [
    "hello",
    [modern("image/png")],
    [{ type: "binary", mimeType: "audio/wav", data: "YQ==" }],
    [{ type: "binary", mimeType: "image/png", data: 42 }],
    [
      {
        type: "binary",
        mimeType: "image/png",
        data: "YQ==",
        url: "https://example.test/a",
      },
    ],
  ]) {
    const body = JSON.stringify(request(content), null, 2);
    assert.equal(normalizeMultimodalRequestBody(body), body);
  }
});

test("invalid JSON remains an explicit error", () => {
  assert.throws(() => normalizeMultimodalRequestBody("{"), SyntaxError);
});

test("fetch hook survives actual HttpAgent cloning and preserves request options", async () => {
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
  const response = new Response("unchanged response");
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  const agent = new HttpAgent({
    url: "http://localhost/agui",
    fetch: createAgnoMultimodalFetch(transport),
  });
  const clone = agent.clone();
  assert.equal(clone.fetch, agent.fetch);
  const part = modern("image/png");
  const init: RequestInit = {
    method: "POST",
    headers: { "x-trace": "retain" },
    signal: new AbortController().signal,
    credentials: "include",
    body: JSON.stringify(
      request([
        part,
        { type: "binary", mimeType: "image/png", data: part.source.value },
      ]),
    ),
  };
  assert.equal(await clone.fetch(clone.url, init), response);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, clone.url);
  assert.deepEqual(calls[0].init, {
    ...init,
    body: JSON.stringify(request([part])),
  });
  assert.equal(calls[0].init?.headers, init.headers);
  assert.equal(calls[0].init?.signal, init.signal);
  assert.equal(JSON.parse(String(init.body)).messages[1].content.length, 2);
});

test("transport failure is not swallowed", async () => {
  const failure = new Error("transport failed");
  const transport: typeof fetch = async () => {
    throw failure;
  };
  await assert.rejects(
    createAgnoMultimodalFetch(transport)("http://localhost/agui", {
      body: JSON.stringify(request("hello")),
    }),
    failure,
  );
});
