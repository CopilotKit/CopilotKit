import assert from "node:assert/strict";
import test from "node:test";
import {
  readNativeEvents,
  verifyNativeRun,
} from "../import/drivers/native-run.mjs";
import {
  nativeContent,
  importedContent,
  nativeState,
  mediaPayload,
} from "../import/drivers/content.mjs";

const input = { threadId: "original-thread", runId: "original-run" };
const start = { type: "RUN_STARTED", ...input };
const finish = { type: "RUN_FINISHED", ...input };
function response(chunks) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("native SSE preserves Unicode across byte/CRLF boundaries and multiline frames", async () => {
  const expected = [
    start,
    { type: "TEXT_MESSAGE_CONTENT", delta: "café ☀️" },
    finish,
  ];
  const wire = new TextEncoder().encode(
    ": heartbeat\r\n\r\n" +
      expected
        .map(
          (event) =>
            `data: ${JSON.stringify(event, null, 2).replaceAll("\n", "\r\ndata: ")}\r\n\r\n`,
        )
        .join(""),
  );
  const events = [];
  await readNativeEvents(
    response([...wire].map((byte) => new Uint8Array([byte]))),
    (event) => events.push(event),
  );
  assert.deepEqual(events, expected);
  assert.deepEqual(verifyNativeRun(input, events), finish);
});

test("native stream truncation, malformed JSON and identity changes cannot pass", async () => {
  for (const wire of [
    'data: {"type":"RUN_FINISHED"}',
    'data: {"type":"RUN_FINISHED"}\n',
    "data: {oops}\n\n",
  ])
    await assert.rejects(
      readNativeEvents(response([new TextEncoder().encode(wire)]), () => {}),
    );
  assert.throws(() => verifyNativeRun(input, [start]));
  assert.throws(() =>
    verifyNativeRun(input, [start, { ...finish, threadId: "different" }]),
  );
  assert.throws(() =>
    verifyNativeRun(input, [
      start,
      finish,
      { type: "RUN_ERROR", message: "failed" },
    ]),
  );
});

const base64 = Buffer.from("independently specified media bytes").toString(
  "base64",
);
const tool = {
  toolCallId: "call-1",
  toolName: "pieChart",
  args: { data: [{ label: "A", value: 7 }] },
  state: "result",
  result: { rendered: true },
};
const source = [
  {
    id: "user-1",
    role: "user",
    content: {
      parts: [
        { type: "text", text: "Read this PDF" },
        {
          type: "file",
          data: `data:application/pdf;base64,${base64}`,
          mimeType: "application/pdf",
          filename: "original.pdf",
        },
      ],
    },
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: {
      parts: [
        { type: "tool-invocation", toolInvocation: tool },
        { type: "tool-invocation", toolInvocation: tool },
      ],
    },
  },
];
const imported = [
  {
    id: "user-1",
    role: "user",
    content: [
      { type: "text", text: "Read this PDF" },
      {
        type: "document",
        source: { type: "data", value: base64, mimeType: "application/pdf" },
        metadata: { filename: "original.pdf" },
      },
    ],
  },
  ...[0, 1].flatMap(() => [
    {
      id: "assistant-1",
      role: "assistant",
      toolCalls: [
        {
          id: tool.toolCallId,
          name: tool.toolName,
          args: JSON.stringify(tool.args),
        },
      ],
    },
    {
      id: "result-1",
      role: "tool",
      toolCallId: tool.toolCallId,
      content: JSON.stringify(tool.result),
    },
  ]),
];

test("rich import compares ordered original media and repeated complete tool occurrences", () => {
  const expected = nativeContent("mastra", source);
  assert.deepEqual(importedContent(imported), expected);
  for (const mutate of [
    (value) => (value[0].content[1].metadata.filename = "renamed.pdf"),
    (value) =>
      (value[0].content[1].source.value =
        Buffer.from("different bytes").toString("base64")),
    (value) => (value[0].content[1].source.mimeType = "image/png"),
    (value) => value.splice(3, 2),
    (value) => value.splice(0, value.length, ...value.toReversed()),
    (value) => (value[2].toolCallId = "other-call"),
  ]) {
    const changed = structuredClone(imported);
    mutate(changed);
    assert.notDeepEqual(importedContent(changed), expected);
  }
});

test("Strands full message sidecars preserve filenames; missing source names stay missing", () => {
  const message = {
    trackingId: "source:user",
    role: "user",
    content: [
      {
        document: {
          format: "pdf",
          source: { bytes: [...Buffer.from(base64, "base64")] },
        },
      },
    ],
    metadata: {
      custom: {
        "ag-ui": {
          attachments: [
            { index: 0, type: "document", filename: "original.pdf" },
          ],
        },
      },
    },
  };
  const api = [
    {
      id: `native:${JSON.stringify(message.trackingId)}:segment:0`,
      role: "user",
      content: [imported[0].content[1]],
    },
  ];
  assert.deepEqual(
    nativeContent("strands-typescript", [message]),
    importedContent(api),
  );
  delete message.metadata;
  const missing = nativeContent("strands-typescript", [message]);
  assert.equal(missing[0].payload.filename, null);
  assert.notDeepEqual(missing, importedContent(api));
});

test("remote media requires independent resolved bytes; invalid or unknown content fails", () => {
  const reference = "https://media.example.test/original.pdf";
  assert.throws(() => mediaPayload({ type: "document", reference }));
  assert.deepEqual(
    mediaPayload(
      {
        type: "document",
        reference,
        mimeType: "application/pdf",
        filename: "original.pdf",
      },
      { [reference]: base64 },
    ),
    nativeContent("mastra", source)[1].payload,
  );
  assert.throws(() => mediaPayload({ type: "image", data: "broken%%%" }));
  assert.throws(() => mediaPayload({ type: "image", data: [999] }));
  assert.throws(() =>
    nativeContent("mastra", [
      {
        id: "id",
        role: "assistant",
        content: { parts: [{ type: "future-content", value: 1 }] },
      },
    ]),
  );
});

test("application state never falls back to unrelated Strands SDK state", () => {
  const snapshot = {
    records: {
      session: {
        appData: { todos: [{ title: "Original" }] },
        data: { state: { unrelated: true } },
      },
    },
  };
  assert.deepEqual(
    nativeState("strands-typescript", snapshot),
    snapshot.records.session.appData,
  );
  delete snapshot.records.session.appData;
  assert.equal(nativeState("strands-typescript", snapshot), undefined);
  assert.deepEqual(
    nativeState("mastra", {
      records: {
        threads: [{ metadata: { workingMemory: '{"todos":[]}' } }],
        resources: [],
      },
    }),
    { todos: [] },
  );
});
