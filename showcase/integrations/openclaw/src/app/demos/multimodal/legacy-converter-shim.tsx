"use client";

/**
 * Legacy-shape rewrite + media-dedupe shim.
 *
 * Three problems this fixes:
 *
 * 1. **Outgoing modern parts are invisible to the agent.** The published
 *    `@ag-ui/langgraph` converter (0.0.x) only understands the legacy
 *    `{ type: "binary", mimeType, data | url }` shape when forwarding
 *    AG-UI messages to LangChain. Modern
 *    `{ type: "image" | "document", source: { type, value, mimeType } }`
 *    parts are silently dropped. In `onRunInitialized` we walk the
 *    outgoing user message and APPEND a legacy `binary` mirror after
 *    every modern media part — we cannot REPLACE the modern part with
 *    `binary` because `CopilotChatUserMessage`'s `getMediaParts` only
 *    renders `image|audio|video|document`, so replacing would make the
 *    attachment visually disappear from the chat once the run snapshot
 *    round-trips through state. APPEND keeps both forms: the modern
 *    part stays for the UI, the legacy `binary` feeds the converter.
 *
 * 2. **Round-tripped media comes back doubled and mistyped.** The
 *    converter sends our `binary` parts out as LangChain `image_url`
 *    and pulls incoming `image_url` parts back in as AG-UI `image`
 *    regardless of mimeType, so PDFs come back as `type: "image"` with
 *    `mimeType: "application/pdf"` and fall to `ImageAttachment` (which
 *    renders a broken `<img>`). The user's original modern part also
 *    survives in state, so the chat shows TWO chips per attachment. On
 *    every `onMessagesSnapshotEvent` and `onRunFinalized` we dedupe by
 *    `source.value` and re-key the `type` field from the mimeType so
 *    PDFs route to `DocumentAttachment` (icon + filename) and images
 *    to `ImageAttachment`.
 */

import { useEffect, useMemo } from "react";
import { useAgent } from "@copilotkit/react-core/v2";

/**
 * Minimal structural shape of an AG-UI message. `@ag-ui/client`'s
 * exported `Message` is a tagged union by role, but for the rewrite
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
 * Builds the legacy `binary` content part that mirrors a modern
 * `image | document | audio | video` part. Returns `null` if the input
 * is not a multimodal part we need to mirror, or if the part is already
 * a legacy `binary` (idempotent).
 *
 * The published `@ag-ui/langgraph` converter (see `aguiMessagesToLangChain`)
 * only recognizes legacy `binary` parts; modern parts are silently
 * filtered out. We APPEND the legacy mirror alongside the modern part
 * rather than replacing it, because `CopilotChatUserMessage`'s
 * `getMediaParts` only renders `image|audio|video|document` — replacing
 * the modern part with `binary` makes the attachment visually disappear
 * from the chat once the agent run completes (the run-state snapshot
 * round-trips through state and re-renders the user message). Keeping
 * both forms gives the UI something to render AND the converter
 * something to read.
 */
function legacyBinaryFor(part: unknown): unknown | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as {
    type?: string;
    source?: {
      type?: string;
      value?: string;
      mimeType?: string;
    };
  };
  const type = candidate.type;
  if (
    type !== "image" &&
    type !== "document" &&
    type !== "audio" &&
    type !== "video"
  ) {
    return null;
  }
  const source = candidate.source;
  if (!source || typeof source.value !== "string") {
    return null;
  }
  const mimeType = source.mimeType ?? "application/octet-stream";
  if (source.type === "data") {
    return { type: "binary", mimeType, data: source.value };
  }
  if (source.type === "url") {
    return { type: "binary", mimeType, url: source.value };
  }
  return null;
}

/**
 * Walks a message list and APPENDS a legacy `binary` mirror after every
 * modern `image|document|audio|video` part on user messages, so the
 * outgoing payload contains both forms. Non-user messages, plain-string
 * user messages, and parts that already have a sibling `binary` mirror
 * pass through untouched (idempotent: re-running on already-augmented
 * messages is a no-op).
 *
 * Returns null if nothing changed so the subscriber in
 * `onRunInitialized` can skip a superfluous state write.
 */
function rewriteMessagesForLegacyConverter(
  messages: ReadonlyArray<Readonly<AgentMessage>>,
): AgentMessage[] | null {
  let mutated = false;
  const next = messages.map((message) => {
    if (message.role !== "user") return message as AgentMessage;
    const content = message.content;
    if (!Array.isArray(content)) return message as AgentMessage;

    // Build a key set of `binary` parts already in the message so we
    // don't double-append on a second run.
    const existingBinaryKeys = new Set<string>();
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: string }).type === "binary"
      ) {
        const p = part as { mimeType?: string; data?: string; url?: string };
        existingBinaryKeys.add(`${p.mimeType ?? ""}::${p.data ?? p.url ?? ""}`);
      }
    }

    let partMutated = false;
    const augmentedParts: unknown[] = [];
    for (const part of content) {
      augmentedParts.push(part);
      const mirror = legacyBinaryFor(part);
      if (!mirror) continue;
      const m = mirror as {
        mimeType?: string;
        data?: string;
        url?: string;
      };
      const key = `${m.mimeType ?? ""}::${m.data ?? m.url ?? ""}`;
      if (existingBinaryKeys.has(key)) continue;
      existingBinaryKeys.add(key);
      augmentedParts.push(mirror);
      partMutated = true;
    }
    if (!partMutated) return message as AgentMessage;
    mutated = true;
    return {
      ...(message as object),
      content: augmentedParts,
    } as AgentMessage;
  });
  return mutated ? next : null;
}

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
    for (const part of content) {
      if (!part || typeof part !== "object") {
        kept.push(part);
        continue;
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
 * already relies on — subscribing there means we rewrite messages on the
 * *same* agent instance CopilotChat dispatches through, even when threads
 * are cloned or swapped.
 */
export function LegacyConverterShim() {
  const { agent } = useAgent({ agentId: "multimodal-demo" });

  const subscriber = useMemo(
    () => ({
      onRunInitialized: ({
        messages,
      }: {
        messages: ReadonlyArray<Readonly<AgentMessage>>;
      }) => {
        const rewritten = rewriteMessagesForLegacyConverter(messages);
        if (!rewritten) return;
        return { messages: rewritten };
      },
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
