import { createHash } from "node:crypto";
import { atPointer } from "./assertions.mjs";
import { strandsEnvelopes } from "./tool-controls.mjs";

export function jsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const escape = (value) => value.replaceAll("~", "~0").replaceAll("/", "~1");
const formats = {
  png: "image/png",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  wav: "audio/wav",
  mp4: "video/mp4",
};
function mediaBytes(value) {
  if (Array.isArray(value)) return Buffer.from(value);
  if (typeof value !== "string") return null;
  const base64 = value.startsWith("data:") ? value.split(",", 2)[1] : value;
  if (
    !/^[A-Za-z0-9+/_-]*={0,2}$/.test(base64) ||
    base64.replace(/=+$/, "").length % 4 === 1
  )
    return null;
  return Buffer.from(base64, "base64url");
}
function digest(value) {
  const bytes = mediaBytes(value);
  return bytes === null
    ? { sha256: null, byteLength: null }
    : {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.length,
      };
}

/** Independent native projection. Retain the entire original snapshot alongside
 * these pointers. Unknown native parts are visible, never silently discarded.
 */
export function nativeInventory(framework, snapshot) {
  const envelopes =
    framework === "mastra"
      ? (snapshot.records.messages ?? []).map((value, index) => ({
          value,
          record: "messages",
          pointer: `/${index}`,
        }))
      : strandsEnvelopes(snapshot);
  const items = [];
  for (const envelope of envelopes) {
    const mastra = framework === "mastra";
    const parts = mastra
      ? envelope.value.content?.parts
      : envelope.value.content;
    for (const [index, part] of (parts ?? []).entries()) {
      const pointer = `${envelope.pointer}/content${mastra ? "/parts" : ""}/${index}`;
      const add = (value) =>
        items.push({ value, source: { record: envelope.record, pointer } });
      if (part.text !== undefined && (!mastra || part.type === "text"))
        add({ kind: "text", role: envelope.value.role, text: part.text });
      else if (mastra && part.type === "reasoning")
        add({ kind: "reasoning", text: part.reasoning ?? part.text });
      else if (part.reasoningContent)
        add({
          kind: "reasoning",
          text:
            part.reasoningContent.reasoningText?.text ??
            part.reasoningContent.text,
        });
      else if (part.toolInvocation || part.toolUse) {
        const call = part.toolInvocation ?? part.toolUse;
        const id = call.toolCallId ?? call.toolUseId;
        add({
          kind: "call",
          id,
          name: call.toolName ?? call.name,
          args: call.args ?? call.input,
        });
        if (Object.hasOwn(call, "result"))
          add({ kind: "result", id, value: jsonValue(call.result) });
      } else if (part.toolResult) {
        const result = part.toolResult;
        const content = result.content ?? [];
        add({
          kind: "result",
          id: result.toolUseId,
          value:
            content.length === 1 && Object.hasOwn(content[0], "text")
              ? jsonValue(content[0].text)
              : content.length === 1 && Object.hasOwn(content[0], "json")
                ? content[0].json
                : content,
        });
      } else {
        const type = ["image", "document", "audio", "video"].find(
          (kind) => part[kind],
        );
        if (type || (mastra && ["file", "image"].includes(part.type))) {
          const body = type ? part[type] : part;
          const mime =
            body.mimeType ??
            formats[body.format] ??
            /^data:([^;,]+)/.exec(
              body.data ?? body.url ?? body.image ?? "",
            )?.[1] ??
            null;
          const mediaType =
            type ??
            (mime?.startsWith("application/")
              ? "document"
              : mime?.split("/")[0]) ??
            "unknown";
          const attachments =
            envelope.value.metadata?.custom?.["ag-ui"]?.attachments ?? [];
          const sidecar = attachments.find(
            (item) => item.index === index && item.type === mediaType,
          );
          const bytes =
            body.source?.bytes ?? body.data ?? body.url ?? body.image;
          const embeddedMime =
            typeof bytes === "string"
              ? /^data:([^;,]+)/.exec(bytes)?.[1]
              : undefined;
          add({
            kind: "media",
            type: mediaType,
            ...digest(bytes),
            mime,
            ...(embeddedMime && embeddedMime !== mime
              ? { mimeConflict: embeddedMime }
              : {}),
            filename: sidecar?.filename ?? body.filename ?? body.name ?? null,
            reference:
              body.source?.url ??
              body.source?.fileId ??
              (typeof bytes === "string" && /^https?:/.test(bytes)
                ? bytes
                : null),
          });
        } else add({ kind: "unknown-native-part", value: part });
      }
    }
  }
  const states = [];
  if (framework === "mastra") {
    for (const record of ["threads", "resources"])
      for (const [index, value] of (snapshot.records[record] ?? []).entries()) {
        const memory = value.metadata?.workingMemory ?? value.workingMemory;
        if (memory !== undefined)
          states.push({
            value: jsonValue(memory),
            source: {
              record,
              pointer: `/${index}/${value.metadata?.workingMemory !== undefined ? "metadata/" : ""}workingMemory`,
            },
          });
      }
  } else
    for (const [record, value] of Object.entries(snapshot.records)) {
      // SDK snapshots serialize agent.appState as data.state. appData is a
      // separate extension envelope; preserve both without merging namespaces.
      states.push({
        value: value.appData,
        source: { record, pointer: "/appData" },
      });
      states.push({
        value: value.data?.state,
        source: { record, pointer: "/data/state" },
      });
    }
  return { items, states };
}

/** Source messages must be reconstructed from framework-bound inputs and raw
 * framework events by the common capture layer, never from native/Intelligence.
 * This projection preserves every actual call/result and original media name.
 */
export function sourceInventory(messages) {
  const items = [];
  for (const [index, message] of messages.entries()) {
    const source = {
      artifact: "framework-capture.json",
      pointer: `/messages/${index}`,
    };
    const add = (value) => items.push({ value, source });
    if (message.role === "tool")
      add({
        kind: "result",
        id: message.toolCallId,
        value: jsonValue(message.content),
      });
    else if (typeof message.content === "string" && message.content)
      add({
        kind: message.role === "reasoning" ? "reasoning" : "text",
        ...(message.role === "reasoning" ? {} : { role: message.role }),
        text: message.content,
      });
    else if (Array.isArray(message.content))
      for (const part of message.content) {
        if (part.type === "text")
          add({ kind: "text", role: message.role, text: part.text });
        else if (part.source) {
          const bytes =
            part.source.type === "data"
              ? part.source.value
              : part.resolvedBase64;
          if (bytes === undefined || digest(bytes).sha256 === null)
            throw new Error(
              "Source media requires captured original bytes, including URL/provider-file variants",
            );
          add({
            kind: "media",
            type: part.type,
            ...digest(bytes),
            mime: part.source.mimeType ?? null,
            filename: part.metadata?.filename ?? null,
            reference: part.source.type === "data" ? null : part.source.value,
          });
        } else add({ kind: "unknown-source-part", value: part });
      }
    for (const call of message.toolCalls ?? [])
      add({
        kind: "call",
        id: call.id,
        name: call.function.name,
        args: jsonValue(call.function.arguments),
      });
  }
  return items;
}

export function inventoryObservations({
  framework,
  snapshot,
  messages,
  witnesses = [],
  scenarioId,
  state,
  stateCategory = "shared-state-write",
}) {
  const native = nativeInventory(framework, snapshot);
  const expected = sourceInventory(messages);
  const observations = [];
  const projection = {
    items: native.items.map((item) => item.value),
    states: native.states.map((item) => item.value),
  };
  // A global sequence check catches duplicates and reordering across rich tool
  // surfaces. The original locations are retained for every native value.
  observations.push({
    name: `${scenarioId}-native-order`,
    category: "user-text",
    record: "inspection",
    pointer: "/items",
    expected: expected.map((item) => item.value),
    source: { artifact: "framework-capture.json", pointer: "/messages" },
  });
  for (const { category, pointer } of witnesses) {
    const message = atPointer({ messages }, pointer);
    if (!message || !/^\/messages\/\d+$/.test(pointer))
      throw new Error(
        `Native category witness must identify a source message: ${category}`,
      );
    const kinds = sourceInventory([message]).map((item) => item.value.kind);
    const toolCategories = [
      "chart-pie",
      "chart-bar",
      "flight-card",
      "dashboard-a2ui",
      "calculator-iframe",
      "ordinary-tool",
      "mcp-tool",
      "mcp-app",
    ];
    const mediaType = category.split(":")[0];
    const valid =
      category === "user-text"
        ? message.role === "user" && kinds.includes("text")
        : category === "assistant-text"
          ? message.role === "assistant" && kinds.includes("text")
          : category === "reasoning"
            ? kinds.includes("reasoning")
            : toolCategories.includes(category)
              ? kinds.includes("call") || kinds.includes("result")
              : ["image", "document", "audio", "video"].includes(mediaType)
                ? message.content?.some(
                    (part) =>
                      part.type === mediaType &&
                      part.source?.type === category.split(":")[1],
                  )
                : false;
    // Non-message surfaces require independent witnesses, never a text turn.
    if (!valid) continue;
    observations.push({
      name: `${scenarioId}-${category}`,
      category,
      record: "inspection",
      pointer: "/items",
      expected: expected.map((item) => item.value),
      source: { artifact: "framework-capture.json", pointer: "/messages" },
    });
  }
  if (state !== undefined)
    for (const [key, value] of Object.entries(state)) {
      // Locate keys only. Expected values are always the captured source state;
      // a missing key uses an impossible pointer and therefore fails comparison.
      const index = native.states.findIndex(
        (entry) => entry.value && Object.hasOwn(entry.value, key),
      );
      observations.push({
        name: `${scenarioId}-${stateCategory}-${key}`,
        category: stateCategory,
        record: "inspection",
        pointer: `/states/${index}/${escape(key)}`,
        expected: value,
        source: {
          artifact: "framework-capture.json",
          pointer: `/state/${escape(key)}`,
        },
      });
    }
  return {
    observations,
    projection,
    nativeLocations: native,
    sourceItems: expected,
  };
}
