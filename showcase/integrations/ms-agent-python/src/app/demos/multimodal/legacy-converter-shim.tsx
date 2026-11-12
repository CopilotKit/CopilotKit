"use client";

/**
 * Media-dedupe shim.
 *
 * Outgoing attachments are sent exactly as the composer builds them: modern
 * `{ type: "image" | "document", source: { type, value, mimeType } }` parts.
 * Every showcase backend reads that shape. An earlier version also appended
 * a legacy `{ type: "binary" }` mirror for old LangChain converters; AG-UI
 * protocol 1.0 removed `binary`, so Python bridges on 1.0 reject the whole
 * run with HTTP 422. Do not reintroduce the mirror.
 *
 * Inbound, a round-tripped snapshot can carry the same attachment twice,
 * tag a PDF as `type: "image"` (which renders a broken `<img>`), or carry
 * legacy `binary` parts the chat cannot render. On every
 * `onMessagesSnapshotEvent` and `onRunFinalized` we upgrade legacy `binary`
 * parts to modern ones, dedupe media parts by `source.value`, and re-key the
 * `type` from the mimeType so PDFs route to `DocumentAttachment` and images
 * to `ImageAttachment`.
 */

import { useEffect, useMemo } from "react";
import { useAgent } from "@copilotkit/react-core";

/**
 * Minimal structural shape of an AG-UI message. `@ag-ui/client`'s
 * exported `Message` is a tagged union by role, but for the dedupe
 * we only care about the `user` branch and treat every other role as
 * pass-through. Keeping the type local avoids pulling `@ag-ui/client`
 * into this package's direct dependencies.
 */
type AgentMessage = {
  id?: string;
  role: string;
  content?: unknown;
};

/**
 * Normalize + dedupe media content parts within each user message:
 *
 * 1. **Type normalization.** The @ag-ui/langgraph round-trip through
 *    LangChain emits incoming media parts as `type: "image"` regardless
 *    of the actual mimeType — including `application/pdf` and other
 *    non-image documents — because the converter generates them from
 *    LangChain `image_url` parts indiscriminately. The chat
 *    user-message renderer dispatches by `type` to either
 *    `ImageAttachment` (renders an `<img>`) or `DocumentAttachment`
 *    (renders an icon + filename). A PDF tagged as `image` falls to
 *    `<img>`, fails to load, and shows "Failed to load image" instead
 *    of a PDF chip. Re-key the part type from the mimeType so the
 *    correct renderer fires.
 *
 * 2. **Dedupe by source value.** The same attachment ends up in the
 *    user message twice: once as the modern part the client added,
 *    once as the re-converted shape the snapshot pushes. Strip
 *    duplicates by `source.value` (or `source.url`) regardless of
 *    type so both forms collapse to a single chip.
 */
function normalizePartType(type: string, mimeType: string | undefined): string {
  if (type !== "image" && type !== "document") return type;
  if (!mimeType) return type;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

/**
 * Upgrade a legacy `{ type: "binary", mimeType, data | url }` part to the
 * modern `{ type: "image" | "document" | ..., source: { type, value, mimeType } }`
 * shape. Returns `null` when the part is not a legacy binary or lacks the
 * fields needed to produce a renderable modern part.
 *
 * Why: `agent_framework_ag_ui._normalize_snapshot_content` rewrites every
 * multimodal part on the outbound MESSAGES_SNAPSHOT to the legacy `binary`
 * shape (see `_message_adapters.py::_legacy_binary_part`). The chat
 * user-message renderer's `getMediaParts` only renders modern
 * `image|audio|video|document` parts — `binary` parts are invisible. Without
 * this upgrade, the very first user message loses its attachment chip the
 * moment a second turn's snapshot replaces conversation state, which is the
 * exact failure mode covered by the back-to-back specs.
 */
function modernPartFromLegacyBinary(part: unknown): unknown | null {
  if (!part || typeof part !== "object") return null;
  const p = part as {
    type?: string;
    mimeType?: string;
    data?: string;
    url?: string;
    id?: string;
  };
  if (p.type !== "binary") return null;
  const mimeType = p.mimeType ?? "application/octet-stream";
  const modernType = mimeType.startsWith("image/")
    ? "image"
    : mimeType.startsWith("audio/")
      ? "audio"
      : mimeType.startsWith("video/")
        ? "video"
        : "document";
  if (typeof p.data === "string" && p.data.length > 0) {
    return {
      type: modernType,
      source: { type: "data", value: p.data, mimeType },
    };
  }
  if (typeof p.url === "string" && p.url.length > 0) {
    return {
      type: modernType,
      source: { type: "url", url: p.url, mimeType },
    };
  }
  if (typeof p.id === "string" && p.id.length > 0) {
    return {
      type: modernType,
      source: { type: "id", id: p.id, mimeType },
    };
  }
  return null;
}

function dedupeUserMessageMedia(
  messages: ReadonlyArray<Readonly<AgentMessage>>,
): AgentMessage[] | null {
  let mutated = false;
  const next = messages.map((message) => {
    if (message.role !== "user") return message as AgentMessage;
    const content = message.content;
    if (!Array.isArray(content)) return message as AgentMessage;
    const seen = new Set<string>();
    const kept: unknown[] = [];
    let partMutated = false;
    for (const rawPart of content) {
      if (!rawPart || typeof rawPart !== "object") {
        kept.push(rawPart);
        continue;
      }
      // Upgrade legacy `{ type: "binary" }` parts to the modern
      // `{ type: "image|document|..." , source: { ... } }` shape that the
      // chat user-message renderer actually renders. We do this BEFORE the
      // media-vs-non-media branch so an upgraded part flows through the
      // same dedupe + type-normalize path as a natively-modern part.
      const upgraded = modernPartFromLegacyBinary(rawPart);
      const part = upgraded ?? rawPart;
      if (upgraded) {
        partMutated = true;
      }
      const p = part as {
        type?: string;
        source?: { value?: string; url?: string; mimeType?: string };
        data?: string;
        url?: string;
        mimeType?: string;
      };
      const isMedia =
        p.type === "image" ||
        p.type === "document" ||
        p.type === "audio" ||
        p.type === "video";
      if (!isMedia) {
        kept.push(part);
        continue;
      }
      const sourceValue = p.source?.value ?? p.source?.url ?? "";
      if (seen.has(sourceValue)) {
        partMutated = true;
        continue;
      }
      seen.add(sourceValue);
      const normalizedType = normalizePartType(
        p.type ?? "",
        p.source?.mimeType ?? p.mimeType,
      );
      if (normalizedType !== p.type) {
        kept.push({ ...p, type: normalizedType });
        partMutated = true;
      } else {
        kept.push(part);
      }
    }
    if (!partMutated) return message as AgentMessage;
    mutated = true;
    return { ...(message as object), content: kept } as AgentMessage;
  });
  return mutated ? next : null;
}

/**
 * Installs the subscribers on the active agent. Scoped to a small inner
 * component so it can use the `useAgent` hook the <CopilotChat> parent
 * already relies on — subscribing there means we dedupe messages on the
 * *same* agent instance CopilotChat dispatches through, even when threads
 * are cloned or swapped.
 */
export function LegacyConverterShim() {
  const { agent } = useAgent({ agentId: "multimodal-demo" });

  const subscriber = useMemo(
    () => ({
      // After every messages snapshot from the server, strip duplicate
      // media parts and normalize types that the @ag-ui/langgraph
      // round-trip mangled. We hook both `onMessagesSnapshotEvent` and
      // `onRunFinalized` to catch incremental events too — the
      // snapshot fires once at run end, the run-finalized hook fires
      // when the agent transitions out of running.
      onMessagesSnapshotEvent: ({
        messages,
      }: {
        messages: ReadonlyArray<Readonly<AgentMessage>>;
      }) => {
        const deduped = dedupeUserMessageMedia(messages);
        if (!deduped) return;
        return { messages: deduped };
      },
      onRunFinalized: ({
        messages,
      }: {
        messages: ReadonlyArray<Readonly<AgentMessage>>;
      }) => {
        const deduped = dedupeUserMessageMedia(messages);
        if (!deduped) return;
        return { messages: deduped };
      },
    }),
    [],
  );

  useEffect(() => {
    if (!agent) return;
    // AG-UI's AgentSubscriber type is tagged by role; our shim uses a
    // structural message shape and returns only partial mutations, so
    // cast at the subscribe boundary. The cast is safe: our handlers
    // only ever return a messages-mutation or void.
    const handle = agent.subscribe(
      subscriber as unknown as Parameters<typeof agent.subscribe>[0],
    );
    return () => handle.unsubscribe();
  }, [agent, subscriber]);

  return null;
}
