"use client";

/**
 * Multimodal Attachments demo.
 *
 * Wires CopilotChat's `AttachmentsConfig` for image + PDF uploads and adds
 * two "Try with sample X" buttons that inject bundled files through the
 * same pipeline the paperclip button uses.
 *
 * Architecture:
 * - Dedicated runtime route at `/api/copilotkit-multimodal` (see
 *   ../api/copilotkit-multimodal/route.ts). The AG-UI attachment pipeline is
 *   scoped to just this demo so other cells' runtimes stay lean.
 * - Backend: shared CrewAI crew. CAVEAT — the shared crew's chat LLM is
 *   `gpt-4o`, which accepts image content blocks, but crew agents themselves
 *   use their configured model. Attachments reach the chat-LLM layer
 *   (ChatWithCrewFlow's `acompletion`) which forwards them natively for
 *   vision. PDFs are flattened to text by the runtime before the agent sees
 *   them. This is NOT a bespoke vision crew — a dedicated per-demo crew with
 *   vision-tuned agent prompts is tracked as follow-up work.
 * - Sample files live at `/demo-files/sample.png` and `/demo-files/sample.pdf`.
 *   The sample-buttons component fetches them client-side, wraps the blob in
 *   a File, and drives the same hidden `<input type="file">` the paperclip
 *   path uses.
 *
 * Legacy-shape rewrite:
 * - The AG-UI → downstream agent converters that some agent adapters ship
 *   today (notably the published `@ag-ui/langgraph` 0.0.x converter) only
 *   understand the legacy `{ type: "binary", mimeType, data | url }`
 *   content-part shape when forwarding AG-UI messages. The modern
 *   `{ type: "image" | "document", source: { type: "data" | "url", ... } }`
 *   parts that CopilotChat emits may be silently dropped depending on the
 *   adapter version. To make this demo robust across runtime versions, we
 *   rewrite outgoing user-message image/document/audio/video parts to the
 *   legacy `binary` shape in `onRunInitialized`. If the downstream converter
 *   already handles modern parts the rewrite is a no-op (idempotent when
 *   applied on already-legacy parts).
 */

import { useCallback, useEffect, useMemo } from "react";
import { CopilotKit, CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import type { AttachmentUploadResult } from "@copilotkit/shared";

import { SampleAttachmentButtons } from "./sample-attachment-buttons";

/**
 * Minimal structural shape of an AG-UI message. `@ag-ui/client`'s exported
 * `Message` is a tagged union by role, but for the rewrite we only care
 * about the `user` branch and treat every other role as pass-through.
 * Keeping the type local avoids pulling `@ag-ui/client` into this package's
 * direct dependencies.
 */
type AgentMessage = {
  id?: string;
  role: string;
  content?: unknown;
};

type DataUploadResult = Extract<AttachmentUploadResult, { type: "data" }>;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_MIME = "image/*,application/pdf";
const CHAT_ROOT_SELECTOR = "[data-multimodal-demo-chat-root]";

function fileToDataAttachment(file: File): Promise<DataUploadResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error(`FileReader failed for ${file.name}`));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error(`Unexpected FileReader result type for ${file.name}`));
        return;
      }
      const commaIdx = result.indexOf(",");
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({
        type: "data",
        value: base64,
        mimeType: file.type || "application/octet-stream",
        metadata: {
          filename: file.name,
          size: file.size,
        },
      });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Rewrites a single `InputContent` part from the modern multimodal shape
 * (`type: "image" | "document" | "audio" | "video"`, `source.{type,value,mimeType}`)
 * to the legacy binary shape (`type: "binary"`, `mimeType`, `data` | `url`).
 *
 * Some AG-UI → downstream-agent converters only recognize legacy `binary`
 * parts; modern parts are silently filtered out in those adapters. Returning
 * the legacy shape keeps the attachment visible to the agent while leaving
 * everything else (CopilotChat UI, upload pipeline, etc.) untouched. Text
 * parts and already-legacy parts pass through unchanged (idempotent).
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
 * Returns the same array reference if nothing changed so the subscriber in
 * `onRunInitialized` can skip an unnecessary state write.
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
 * Installs the `onRunInitialized` subscriber on the active agent. Scoped to
 * a small inner component so it can use the `useAgent` hook the
 * <CopilotChat> parent already relies on — subscribing there means we
 * rewrite messages on the *same* agent instance CopilotChat dispatches
 * through, even when threads are cloned or swapped.
 */
function LegacyConverterShim() {
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
    // structural message shape and returns only partial mutations, so cast
    // at the subscribe boundary. The cast is safe: our onRunInitialized
    // only ever returns a messages-mutation or void.
    const handle = agent.subscribe(
      subscriber as unknown as Parameters<typeof agent.subscribe>[0],
    );
    return () => handle.unsubscribe();
  }, [agent, subscriber]);

  return null;
}

export default function MultimodalDemoPage() {
  const onUpload = useCallback(fileToDataAttachment, []);

  return (
    <CopilotKit runtimeUrl="/api/copilotkit-multimodal" agent="multimodal-demo">
      <LegacyConverterShim />
      <div
        data-testid="multimodal-demo-root"
        className="mx-auto flex h-screen max-w-4xl flex-col gap-3 p-4 sm:p-6"
      >
        <header className="space-y-1">
          <h1 className="text-lg font-semibold">Multimodal attachments</h1>
          <p className="text-sm text-black/70 dark:text-white/70">
            Attach an image or PDF with the paperclip, drag-and-drop onto the
            chat, paste from the clipboard, or try one of the bundled samples
            below. Then ask a question about the attachment and press send.
          </p>
        </header>

        <SampleAttachmentButtons rootSelector={CHAT_ROOT_SELECTOR} />

        <div
          data-multimodal-demo-chat-root
          className="min-h-0 flex-1 overflow-hidden rounded-lg border border-black/10 dark:border-white/10"
        >
          <CopilotChat
            agentId="multimodal-demo"
            className="h-full"
            attachments={{
              enabled: true,
              accept: ACCEPT_MIME,
              maxSize: MAX_FILE_SIZE_BYTES,
              onUpload,
              onUploadFailed: (err) => {
                console.warn("[multimodal-demo] attachment rejected", err);
              },
            }}
          />
        </div>
      </div>
    </CopilotKit>
  );
}
