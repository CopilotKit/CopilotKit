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
 *   ../../api/copilotkit-multimodal/route.ts). The vision-capable model
 *   (gpt-4o-mini) is scoped to just this demo, so other cells keep their
 *   default configuration.
 * - Dedicated MS Agent Framework agent mounted at `/multimodal` on the
 *   Python agent server (src/agents/multimodal_agent.py). Images are
 *   forwarded to the model natively; PDFs are flattened to text on the
 *   Python side via `pypdf` for provider-agnostic behavior.
 * - Sample files live at `/demo-files/sample.png` and `/demo-files/sample.pdf`
 *   (see `public/demo-files/`). The sample-buttons component fetches them
 *   client-side, wraps the blob in a File, and drives the same hidden
 *   `<input type="file">` the paperclip path uses (DataTransfer + dispatch
 *   `change`). This keeps the sample and real-upload paths on a single
 *   code path -- whatever works for one works for both.
 */

import { useCallback, useEffect, useMemo } from "react";
import { CopilotKit, CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import type { AttachmentUploadResult } from "@copilotkit/shared";

import { SampleAttachmentButtons } from "./sample-attachment-buttons";

/**
 * Minimal structural shape of an AG-UI message. We care only about the
 * `user` branch; every other role passes through.
 */
type AgentMessage = {
  id?: string;
  role: string;
  content?: unknown;
};

/**
 * `onUpload` must resolve to an `AttachmentUploadResult` (data or url). We
 * always return the `data` variant -- the demo inlines base64 instead of
 * uploading to external storage.
 */
type DataUploadResult = Extract<AttachmentUploadResult, { type: "data" }>;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_MIME = "image/*,application/pdf";
/**
 * Selector used by <SampleAttachmentButtons /> to locate CopilotChat's
 * hidden file input. Kept as a constant so the wrapper element and the
 * sample buttons cannot drift.
 */
const CHAT_ROOT_SELECTOR = "[data-multimodal-demo-chat-root]";

/**
 * Convert a File into the `AttachmentsConfig.onUpload` result shape --
 * inline base64 with the browser-provided mime type.
 */
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
      // result looks like "data:image/png;base64,iVBORw0K..." -- strip the prefix.
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
 * Rewrites modern multimodal content parts (`type: "image" | "document" |
 * "audio" | "video"`, `source.{type,value,mimeType}`) to the legacy binary
 * shape (`type: "binary"`, `mimeType`, `data` | `url`). The deployed AG-UI
 * converter only recognizes legacy `binary` parts — modern parts are silently
 * filtered out, so without this rewrite the agent never sees the attachment.
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
 * to the legacy `binary` shape. Returns the same array reference when nothing
 * changes so the subscriber can skip an unnecessary state write.
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
 * Installs the `onRunInitialized` subscriber on the active agent so we
 * rewrite modern multimodal parts to the legacy shape the AG-UI converter
 * understands.
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
    // Structural shim shape; cast at subscribe boundary.
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
