"use client";

/**
 * Legacy-shape rewrite shim.
 *
 * The published `@ag-ui/langgraph` converter (0.0.x) only understands
 * the legacy `{ type: "binary", mimeType, data | url }` content-part
 * shape when forwarding AG-UI messages to LangChain. The modern
 * `{ type: "image" | "document", source: { type: "data" | "url", ... } }`
 * parts that CopilotChat emits are silently dropped. Until the runtime
 * ships an updated converter, we rewrite the outgoing user message in
 * `onRunInitialized` so image/document/audio/video parts round-trip
 * through the legacy shape the converter preserves.
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
 * Rewrites a single `InputContent` part from the modern multimodal shape
 * (`type: "image" | "document" | "audio" | "video"`, `source.{type,value,mimeType}`)
 * to the legacy binary shape (`type: "binary"`, `mimeType`, `data` | `url`).
 *
 * The published `@ag-ui/langgraph` converter (see `aguiMessagesToLangChain`
 * in that package) only recognizes legacy `binary` parts — modern parts
 * are silently filtered out, so the LangGraph agent never sees them.
 * Returning the legacy shape keeps the attachment visible to the agent
 * while leaving everything else (CopilotChat UI, upload pipeline, etc.)
 * untouched. Text parts and already-legacy parts pass through unchanged.
 */
function rewriteMultimodalPart(part: unknown): unknown {
  if (!part || typeof part !== "object") return part;
  const candidate = part as {
    type?: string;
    text?: string;
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
    return part;
  }
  const source = candidate.source;
  if (!source || typeof source.value !== "string") {
    return part;
  }
  const mimeType = source.mimeType ?? "application/octet-stream";
  if (source.type === "data") {
    return {
      type: "binary",
      mimeType,
      data: source.value,
    };
  }
  if (source.type === "url") {
    return {
      type: "binary",
      mimeType,
      url: source.value,
    };
  }
  return part;
}

/**
 * Walks a message list and rewrites user-message multimodal content parts
 * to the legacy `binary` shape. Non-user messages and plain-string user
 * messages pass through untouched. Idempotent: already-legacy `binary`
 * parts are a no-op for `rewriteMultimodalPart`.
 *
 * Returns the same array reference if nothing changed so the subscriber
 * in `onRunInitialized` can skip an unnecessary state write.
 */
function rewriteMessagesForLegacyConverter(
  messages: ReadonlyArray<Readonly<AgentMessage>>,
): AgentMessage[] | null {
  let mutated = false;
  const next = messages.map((message) => {
    if (message.role !== "user") return message as AgentMessage;
    const content = message.content;
    if (!Array.isArray(content)) return message as AgentMessage;
    let partMutated = false;
    const rewrittenParts = content.map((part) => {
      const rewritten = rewriteMultimodalPart(part);
      if (rewritten !== part) partMutated = true;
      return rewritten;
    });
    if (!partMutated) return message as AgentMessage;
    mutated = true;
    return {
      ...(message as object),
      content: rewrittenParts,
    } as AgentMessage;
  });
  return mutated ? next : null;
}

/**
 * Installs the `onRunInitialized` subscriber on the active agent. Scoped
 * to a small inner component so it can use the `useAgent` hook the
 * <CopilotChat> parent already relies on — subscribing there means we
 * rewrite messages on the *same* agent instance CopilotChat dispatches
 * through, even when threads are cloned or swapped.
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
    }),
    [],
  );

  useEffect(() => {
    if (!agent) return;
    // AG-UI's AgentSubscriber type is tagged by role; our shim uses a
    // structural message shape and returns only partial mutations, so
    // cast at the subscribe boundary. The cast is safe: our
    // onRunInitialized only ever returns a messages-mutation or void.
    const handle = agent.subscribe(
      subscriber as unknown as Parameters<typeof agent.subscribe>[0],
    );
    return () => handle.unsubscribe();
  }, [agent, subscriber]);

  return null;
}
