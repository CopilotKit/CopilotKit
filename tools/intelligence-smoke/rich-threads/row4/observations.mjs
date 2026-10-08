import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const json = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Only documented importer ID encoding is decoded; the raw capture is retained. */
export function messageId(id) {
  assert.equal(typeof id, "string", "Observed message identity required");
  const match = /^native:("(?:[^"\\]|\\.)*"):segment:\d+$/.exec(id);
  return match ? JSON.parse(match[1]) : id;
}

/** Normalize the row3 args spelling, without changing native payload values. */
export function occurrences(items) {
  return items.map((item) => {
    if (item.kind !== "call") return structuredClone(item);
    const payload = item.payload;
    assert.ok(
      Object.hasOwn(payload, "arguments") || Object.hasOwn(payload, "args"),
    );
    if (Object.hasOwn(payload, "arguments") && Object.hasOwn(payload, "args"))
      assert.deepEqual(
        payload.arguments,
        payload.args,
        "Conflicting tool argument representations",
      );
    const { args, ...rest } = payload;
    return {
      ...item,
      payload: {
        ...rest,
        arguments: Object.hasOwn(payload, "arguments")
          ? payload.arguments
          : args,
      },
    };
  });
}

/** Framework-bound input + emitted final messages; never built from saved stores. */
export function messageOccurrences(messages, resolvedMedia = {}) {
  const items = [];
  for (const message of messages) {
    const id = messageId(message.id);
    if (message.role === "tool") {
      assert.ok(message.toolCallId, "Observed result needs original call ID");
      items.push({
        id: `${message.toolCallId}:result`,
        kind: "result",
        callId: message.toolCallId,
        payload: json(message.content),
      });
      continue;
    }
    if (typeof message.content === "string" && message.content)
      items.push({
        id,
        kind: message.role === "reasoning" ? "reasoning" : "text",
        role: message.role,
        payload: message.content,
      });
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        const partId = id;
        if (part.type === "text")
          items.push({
            id: partId,
            kind: "text",
            role: message.role,
            payload: part.text,
          });
        else if (part.type === "reasoning")
          items.push({
            id: partId,
            kind: "reasoning",
            role: message.role,
            payload: part.text,
          });
        else {
          assert.ok(
            ["image", "document", "audio", "video"].includes(part.type),
            `Unprojected framework content: ${part.type}`,
          );
          assert.ok(
            part.source && ["data", "url", "file"].includes(part.source.type),
            "Media transport missing",
          );
          const data =
            part.source.type === "data"
              ? part.source.value
              : resolvedMedia[part.source.value];
          assert.equal(
            typeof data,
            "string",
            "Independent media bytes missing",
          );
          const uri = /^data:([^;,]+);base64,([\s\S]*)$/.exec(data);
          if (uri && part.source.mimeType)
            assert.equal(uri[1], part.source.mimeType, "Media MIME mismatch");
          const base64 = uri ? uri[2] : data;
          assert.match(
            base64,
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
            "Invalid media bytes",
          );
          const bytes = Buffer.from(base64, "base64");
          assert.ok(bytes.length, "Empty media");
          items.push({
            id: partId,
            kind: "media",
            role: message.role,
            payload: {
              type: part.type,
              mimeType: part.source.mimeType ?? uri?.[1] ?? null,
              filename: part.metadata?.filename ?? null,
              base64: bytes.toString("base64"),
              byteLength: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          });
        }
      }
    } else
      assert.ok(
        message.content === undefined ||
          message.content === null ||
          message.content === "",
        "Unknown framework content envelope",
      );
    for (const tool of message.toolCalls ?? []) {
      const name = tool.function?.name ?? tool.name;
      const args = tool.function?.arguments ?? tool.args;
      assert.ok(
        tool.id && name && args !== undefined,
        "Incomplete emitted tool call",
      );
      items.push({
        id: tool.id,
        kind: "call",
        payload: { name, arguments: json(args) },
      });
    }
  }
  return items;
}

/** Enumerate the leased durable native store independently of Intelligence. */
export async function nativeSessions(framework, native) {
  assert.ok(
    native.location && !/:memory:/i.test(native.location),
    "Leased durable native store required",
  );
  if (framework === "mastra") {
    const db = new DatabaseSync(native.location, { readOnly: true });
    try {
      return db
        .prepare("SELECT id FROM mastra_threads ORDER BY id")
        .all()
        .map((row) => row.id);
    } finally {
      db.close();
    }
  }
  assert.equal(
    framework,
    "strands-typescript",
    "Native session inventory adapter unavailable",
  );
  return (await readdir(native.location, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function observedMapping(imported) {
  const identity = imported.nativeIdentity;
  assert.ok(
    imported.threadId && identity?.threadId && identity.agentId,
    "Durable original mapping is missing",
  );
  return {
    intelligenceId: imported.threadId,
    nativeId: identity.threadId,
    userId: identity.userId ?? null,
    appId: identity.appId ?? null,
    agentId: imported.agentId ?? identity.agentId,
    nativeAgentId: identity.agentId,
    resourceId: identity.resourceId ?? null,
  };
}

/** Select runs not present before the click/send, including genuine error runs. */
export function newRuns(before, after) {
  assert.ok(
    Array.isArray(before.frameworkRuns) && Array.isArray(after.frameworkRuns),
    "Capture must retain per-run inputs and events",
  );
  const ids = new Set(before.frameworkRuns.map((run) => run.input.runId));
  const runs = after.frameworkRuns.filter((run) => !ids.has(run.input.runId));
  assert.ok(runs.length, "Browser action produced no new framework run");
  assert.equal(
    new Set(runs.map((run) => run.input.runId)).size,
    runs.length,
    "Duplicate captured run identity",
  );
  for (const run of runs) {
    assert.ok(
      run.input.runId && run.input.threadId,
      "Missing actual framework input identity",
    );
    assert.ok(
      Array.isArray(run.events) && run.events.length,
      "Empty framework event capture",
    );
  }
  return runs;
}

/** Bind a submitted tool answer to the independently read original checkpoint.
 * The checkpoint comes from the pre-action durable snapshot, not the fixture plan.
 */
export function observedResume(beforeNative, runs) {
  const pending = beforeNative.pending;
  assert.equal(
    pending.length,
    1,
    "Expected exactly one durable pending interaction",
  );
  const original = pending[0];
  assert.ok(
    original.id && (original.checkpointId || original.checkpoint?.id),
    "Original durable checkpoint identity missing",
  );
  const answers = [];
  for (const run of runs) {
    if (original.kind === "native") {
      for (const resume of run.input.resume ?? []) {
        assert.equal(
          resume.interruptId,
          original.id,
          "Resume targets a different original interrupt",
        );
        assert.equal(
          resume.status,
          "resolved",
          "Native interrupt was not resolved",
        );
        answers.push(resume.payload);
      }
      if (Object.hasOwn(run.input.forwardedProps?.command ?? {}, "resume")) {
        const event = run.input.forwardedProps.interruptEvent;
        assert.equal(
          event?.id ?? event?.interruptId,
          original.id,
          "Legacy resume lacks original interrupt identity",
        );
        answers.push(run.input.forwardedProps.command.resume);
      }
    } else {
      answers.push(
        ...(run.input.messages ?? [])
          .filter(
            (message) =>
              message.role === "tool" && message.toolCallId === original.callId,
          )
          .map((message) => json(message.content)),
      );
    }
  }
  assert.ok(answers.length, "No answer submitted on original pending identity");
  for (const answer of answers)
    assert.deepEqual(
      answer,
      answers[0],
      "Conflicting answers submitted for original pending control",
    );
  return {
    resumedId: original.id,
    checkpointId: original.checkpointId ?? original.checkpoint.id,
    answer: answers[0],
  };
}

/** Imported history may be supplied in input or loaded by native memory. Only
 * newly emitted/input occurrences form this turn's suffix; any included historic
 * occurrence must match exactly. Both stores separately retain the full prefix.
 */
export function newActivity(historical, observed) {
  const remaining = historical.map((item, index) => ({ item, index }));
  const fresh = [];
  let previous = -1;
  for (const item of observed) {
    const keyMatches = remaining.filter(
      (entry) => entry.item.id === item.id && entry.item.kind === item.kind,
    );
    if (!keyMatches.length) {
      assert.ok(
        !historical.some((old) => old.id === item.id && old.kind === item.kind),
        "Capture duplicated a historical occurrence",
      );
      fresh.push(item);
      continue;
    }
    const entry = keyMatches[0];
    assert.deepEqual(
      item,
      entry.item,
      "Capture changed an original historical occurrence",
    );
    assert.ok(
      entry.index > previous,
      "Capture reordered historical occurrences",
    );
    previous = entry.index;
    remaining.splice(remaining.indexOf(entry), 1);
  }
  return fresh;
}
