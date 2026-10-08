import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  compareCapture,
  compareMedia,
  coverageChecks,
} from "../row2/assertions.mjs";
import { readNativeJson, readNativeSqlite } from "../row2/native-store.mjs";
import { row } from "./row2.mjs";

function capture() {
  return {
    identity: { threadId: "fresh" },
    provenance: {
      input: "input.json",
      events: "events.json",
      fixture: "controlled",
    },
    before: { records: {} },
    after: {
      kind: "file",
      location: "/owned/session",
      records: {
        session: {
          messages: [
            { id: "u1", content: "hello" },
            {
              id: "a1",
              call: { id: "c1", name: "chart", args: { values: [3, 5] } },
            },
          ],
          pending: {
            taskId: "task1",
            interruptId: "i1",
            payload: { question: "Approve?" },
          },
        },
      },
    },
    observations: [
      {
        name: "ordered-messages",
        category: "text",
        record: "session",
        pointer: "/messages",
        expected: [
          { id: "u1", content: "hello" },
          {
            id: "a1",
            call: { id: "c1", name: "chart", args: { values: [3, 5] } },
          },
        ],
        source: { artifact: "events.json", pointer: "/messages" },
      },
      {
        name: "pending-control",
        category: "native-pending",
        record: "session",
        pointer: "/pending",
        expected: {
          taskId: "task1",
          interruptId: "i1",
          payload: { question: "Approve?" },
        },
        source: { artifact: "events.json", pointer: "/interrupt" },
      },
    ],
  };
}

test("detects reordered calls, altered arguments and missing native pending metadata", () => {
  assert.ok(
    compareCapture(capture()).every((check) => check.status === "passed"),
  );
  for (const mutate of [
    (value) => value.messages.reverse(),
    (value) => {
      value.messages[1].call.args.values[0] = 99;
    },
    (value) => {
      delete value.pending.taskId;
    },
    (value) => {
      value.pending.interruptId = "other";
    },
  ]) {
    const value = capture();
    mutate(value.after.records.session);
    assert.ok(compareCapture(value).some((check) => check.status === "failed"));
  }
});

test("rejects memory stores, reused native histories and vacuous observations", () => {
  const memory = capture();
  memory.after.location = "file::memory:";
  assert.throws(() => compareCapture(memory), /durable/);
  const reused = capture();
  reused.before.records.session = { messages: [] };
  assert.throws(() => compareCapture(reused), /absent/);
  const empty = capture();
  empty.observations = [];
  assert.throws(() => compareCapture(empty), /observations/);
});

test("media uses MIME/bytes and sibling sidecars, including URL-safe base64", () => {
  const bytes = Buffer.from([251, 255, 254]);
  const media = {
    bytes: { pointer: "/content/0/url", encoding: "data-uri" },
    filenamePointer: "/additional_kwargs/ag-ui/attachments/0/name",
    expected: {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
      mime: "video/mp4",
      filename: "original.mp4",
    },
  };
  const envelope = {
    content: [
      {
        type: "image_url",
        url: `data:video/mp4;base64,${bytes.toString("base64url")}`,
      },
    ],
    additional_kwargs: { "ag-ui": { attachments: [{ name: "original.mp4" }] } },
  };
  assert.equal(compareMedia(envelope, media).passed, true);
  envelope.additional_kwargs["ag-ui"].attachments[0].name = "renamed.mp4";
  assert.equal(compareMedia(envelope, media).passed, false);
  envelope.content[0].url = "data:image/png;base64,AAAA";
  assert.equal(compareMedia(envelope, media).passed, false);
});

test("partial coverage cannot produce a green row; exclusions need evidence", async () => {
  const saved = [];
  const report = await row.run({
    fixture: {
      row2: { coverage: { text: { required: ["ordered-messages"] } } },
    },
    services: { row2: { captureFresh: async () => [capture()] } },
    writeArtifact: async (...args) => saved.push(args),
  });
  assert.equal(report.status, "unvalidated");
  assert.equal(saved.length, 2);
  assert.throws(
    () =>
      coverageChecks(
        { audio: { status: "source-limitation", reason: "missing" } },
        [],
      ),
    /exclusion/,
  );
  assert.equal((await row.run({ services: {} })).status, "blocked");
});

test("direct SQLite reader retains JSON envelope/metadata and cannot mutate source", async () => {
  const root = await mkdtemp(join(tmpdir(), "row2-sqlite-"));
  try {
    const path = join(root, "native.db");
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE messages(id TEXT, thread TEXT, content TEXT, metadata TEXT)",
    );
    db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?)").run(
      "m1",
      "t1",
      '{"text":"hello"}',
      '{"attachments":[{"name":"a.png"}]}',
    );
    db.close();
    const snapshot = await readNativeSqlite({
      path,
      queries: [
        {
          key: "messages",
          sql: "SELECT * FROM messages WHERE thread = ? ORDER BY rowid",
          params: ["t1"],
          jsonColumns: ["content", "metadata"],
        },
      ],
    });
    assert.equal(
      snapshot.records.messages[0].metadata.attachments[0].name,
      "a.png",
    );
    assert.deepEqual(snapshot.records.messages[0].content, { text: "hello" });
    await assert.rejects(
      readNativeSqlite({
        path,
        queries: [{ key: "bad", sql: "DELETE FROM messages" }],
      }),
      /SELECT/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

test("JSON reader rejects out-of-store paths and keeps the complete session", async () => {
  const root = await mkdtemp(join(tmpdir(), "row2-json-"));
  try {
    const file = join(root, "session.json");
    const envelope = capture().after.records.session;
    await writeFile(file, JSON.stringify(envelope));
    const result = await readNativeJson({ root, files: [file] });
    assert.deepEqual(result.records["session.json"], envelope);
    await assert.rejects(
      readNativeJson({ root: join(root, "session.json"), files: [file] }),
      /outside/,
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
