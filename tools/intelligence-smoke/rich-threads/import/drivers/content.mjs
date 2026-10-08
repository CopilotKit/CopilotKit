import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const formats = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
};
const json = (value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/** Resolve only bytes captured by the test's media transport. Never fetch arbitrary
 * native URLs, and never fill missing source metadata from imported output. */
export function mediaPayload(
  { type, data, mimeType, filename, reference },
  resolved = {},
) {
  if (reference !== undefined) {
    assert.ok(
      Object.hasOwn(resolved, reference),
      `No independent bytes captured for media reference ${reference}`,
    );
    data = resolved[reference];
  }
  let bytes;
  if (Array.isArray(data)) {
    assert.ok(
      data.every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 255,
      ),
      "Invalid media bytes",
    );
    bytes = Buffer.from(data);
  } else {
    assert.equal(typeof data, "string", "Native media bytes missing");
    const uri = /^data:([^;,]+);base64,([\s\S]*)$/.exec(data);
    if (uri) {
      if (mimeType)
        assert.equal(mimeType, uri[1], "Media MIME disagrees with data URI");
      mimeType = uri[1];
      data = uri[2];
    }
    assert.match(
      data,
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      "Invalid media base64",
    );
    bytes = Buffer.from(data, "base64");
  }
  assert.ok(bytes.length, "Empty native media is not a media fixture");
  return {
    type,
    mimeType: mimeType ?? null,
    filename: filename ?? null,
    base64: bytes.toString("base64"),
    byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const text = (id, role, value) => ({
  id,
  kind: role === "reasoning" ? "reasoning" : "text",
  role,
  payload: value,
});
const call = (id, name, args) => ({
  id,
  kind: "call",
  payload: { name, args: json(args) },
});
const result = (id, payload) => ({
  id: `${id}:result`,
  kind: "result",
  callId: id,
  payload: json(payload),
});

/** Native checkpoint projection, separate from the production importer. Native
 * repeated occurrences stay repeated; complete raw envelopes accompany this view.
 * Transport-only step markers have no visible content and remain in the raw file.
 */
export function nativeContent(framework, messages, resolved = {}) {
  assert.ok(["mastra", "strands-typescript"].includes(framework));
  const items = [];
  for (const message of messages) {
    const mastra = framework === "mastra";
    const id = mastra ? message.id : message.trackingId;
    assert.ok(id, "Native message identity missing");
    const parts = mastra ? message.content?.parts : message.content;
    assert.ok(Array.isArray(parts), "Native content parts missing");
    for (const [index, part] of parts.entries()) {
      if (mastra && part.type === "step-start") continue;
      if ((!mastra || part.type === "text") && part.text !== undefined)
        items.push(text(id, message.role, part.text));
      else if (mastra && part.type === "reasoning")
        items.push(text(id, "reasoning", part.reasoning ?? part.text));
      else if (part.reasoningContent) {
        const value =
          part.reasoningContent.reasoningText?.text ??
          part.reasoningContent.text;
        assert.equal(
          typeof value,
          "string",
          "Unknown/redacted reasoning must be classified explicitly",
        );
        items.push(text(id, "reasoning", value));
      } else if (part.toolInvocation || part.toolUse) {
        const tool = part.toolInvocation ?? part.toolUse;
        const callId = tool.toolCallId ?? tool.toolUseId;
        items.push(
          call(callId, tool.toolName ?? tool.name, tool.args ?? tool.input),
        );
        if (Object.hasOwn(tool, "result"))
          items.push(result(callId, tool.result));
      } else if (part.toolResult) {
        const values = part.toolResult.content;
        assert.ok(
          Array.isArray(values) && values.length,
          "Native result content missing",
        );
        const payload =
          values.length === 1 &&
          (Object.hasOwn(values[0], "text") || Object.hasOwn(values[0], "json"))
            ? (values[0].json ?? json(values[0].text))
            : values;
        items.push(result(part.toolResult.toolUseId, payload));
      } else {
        const kind = ["image", "document", "audio", "video"].find(
          (key) => typeof part[key] === "object" && part[key] !== null,
        );
        assert.ok(
          kind || (mastra && ["image", "file"].includes(part.type)),
          `Uncovered native content: ${JSON.stringify(part)}`,
        );
        const body = kind ? part[kind] : part;
        const mimeType =
          body.mimeType ??
          formats[body.format] ??
          /^data:([^;,]+)/.exec(body.data ?? body.url ?? body.image ?? "")?.[1];
        const type =
          kind ??
          (mimeType?.startsWith("application/")
            ? "document"
            : mimeType?.split("/")[0]);
        assert.ok(type, "Native media type missing");
        const attachment = message.metadata?.custom?.[
          "ag-ui"
        ]?.attachments?.find(
          (entry) => entry.index === index && entry.type === type,
        );
        const data = body.source?.bytes ?? body.data ?? body.url ?? body.image;
        const reference =
          body.source?.url ??
          body.source?.fileId ??
          (typeof data === "string" && /^https?:/.test(data)
            ? data
            : undefined);
        items.push({
          id,
          kind: "media",
          role: message.role,
          payload: mediaPayload(
            {
              type,
              data,
              mimeType,
              filename: attachment?.filename ?? body.filename ?? body.name,
              reference,
            },
            resolved,
          ),
        });
      }
    }
  }
  return items;
}

/** API wire projection. Decode only the documented native identity wrapper;
 * occurrence order, call IDs and every content payload are still compared. */
export function importedContent(messages, resolved = {}) {
  const items = [];
  for (const message of messages) {
    const encoded = /^native:("(?:[^"\\]|\\.)*"):segment:\d+$/.exec(message.id);
    const id = encoded ? JSON.parse(encoded[1]) : message.id;
    if (message.role === "tool") {
      items.push(result(message.toolCallId, message.content));
      continue;
    }
    if (typeof message.content === "string") {
      if (message.content) items.push(text(id, message.role, message.content));
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text") items.push(text(id, message.role, part.text));
        else {
          assert.ok(
            ["image", "document", "audio", "video"].includes(part.type) &&
              part.source,
            "Uncovered imported content",
          );
          assert.ok(
            ["data", "url", "file"].includes(part.source.type),
            "Unknown imported media source",
          );
          items.push({
            id,
            kind: "media",
            role: message.role,
            payload: mediaPayload(
              {
                type: part.type,
                data:
                  part.source.type === "data" ? part.source.value : undefined,
                reference:
                  part.source.type === "data" ? undefined : part.source.value,
                mimeType: part.source.mimeType,
                filename: part.metadata?.filename,
              },
              resolved,
            ),
          });
        }
      }
    } else
      assert.ok(
        message.content === undefined || message.content === null,
        "Unknown imported message content",
      );
    for (const tool of message.toolCalls ?? [])
      items.push(
        call(
          tool.id,
          tool.name ?? tool.function?.name,
          tool.args ?? tool.function?.arguments,
        ),
      );
  }
  return items;
}

/** Working memory and appData are application state; SDK internal state is kept
 * in the raw checkpoint and must never silently replace absent application state. */
export function nativeState(framework, snapshot) {
  if (framework === "mastra") {
    const threads = snapshot.records.threads;
    assert.equal(
      threads.length,
      1,
      "Exactly one native source thread required",
    );
    const thread = threads[0].metadata?.workingMemory;
    if (thread !== undefined) return json(thread);
    const memories = (snapshot.records.resources ?? []).filter(
      (resource) =>
        resource.workingMemory !== undefined ||
        resource.metadata?.workingMemory !== undefined,
    );
    assert.ok(memories.length <= 1, "Ambiguous resource working memory");
    return memories.length
      ? json(memories[0].workingMemory ?? memories[0].metadata.workingMemory)
      : undefined;
  }
  assert.equal(framework, "strands-typescript");
  const sessions = Object.values(snapshot.records);
  assert.equal(
    sessions.length,
    1,
    "Exactly one complete native session required",
  );
  return sessions[0].appData;
}
