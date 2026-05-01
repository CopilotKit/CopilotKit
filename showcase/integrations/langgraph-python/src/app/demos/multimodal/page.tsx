"use client";

/**
 * Multimodal Attachments demo (Wave 2b).
 *
 * Wires CopilotChat's `AttachmentsConfig` for image + PDF uploads and adds
 * two "Try with sample X" buttons that inject bundled files through the
 * same pipeline the paperclip button uses.
 *
 * Architecture:
 * - Dedicated runtime route at `/api/copilotkit-multimodal` (see
 *   ../api/copilotkit-multimodal/route.ts). The vision-capable model
 *   (gpt-4o) is scoped to just this demo, so other cells keep their
 *   cheaper text-only models.
 * - Dedicated LangGraph agent at `src/agents/multimodal_agent.py` under
 *   the slug `multimodal-demo`. The agent is registered in langgraph.json
 *   under the graph id `multimodal`. Images are forwarded to the model
 *   natively; PDFs are flattened to text on the Python side via `pypdf`
 *   for provider-agnostic behavior.
 * - Sample files live at `/demo-files/sample.png` and `/demo-files/sample.pdf`
 *   (see `public/demo-files/`). The sample-buttons component fetches them
 *   client-side, wraps the blob in a File, and drives the same hidden
 *   `<input type="file">` the paperclip path uses (DataTransfer + dispatch
 *   `change`). This keeps the sample and real-upload paths on a single
 *   code path — whatever works for one works for both.
 *
 * Legacy-shape rewrite:
 * - The published `@ag-ui/langgraph` converter (0.0.x) only understands
 *   the legacy `{ type: "binary", mimeType, data | url }` content-part
 *   shape when forwarding AG-UI messages to LangChain. The modern
 *   `{ type: "image" | "document", source: { type: "data" | "url", ... } }`
 *   parts that CopilotChat emits are silently dropped. Until the runtime
 *   ships an updated converter, we rewrite the outgoing user message in
 *   `onRunInitialized` so image/document/audio/video parts round-trip
 *   through the legacy shape the converter preserves.
 */

import { useCallback, useEffect, useMemo } from "react";
import { CopilotKit, CopilotChat, useAgent } from "@copilotkit/react-core/v2";
import type { AttachmentUploadResult } from "@copilotkit/shared";

import { SampleAttachmentButtons } from "./sample-attachment-buttons";

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
 * `onUpload` must resolve to an `AttachmentUploadResult` (data or url). We
 * always return the `data` variant — the demo inlines base64 instead of
 * uploading to external storage, matching the Wave 2b spec.
 */
type DataUploadResult = Extract<AttachmentUploadResult, { type: "data" }>;

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPT_MIME = "image/*,application/pdf";

/**
 * Convert a File into the `AttachmentsConfig.onUpload` result shape —
 * inline base64 with the browser-provided mime type. We do this in the
 * browser rather than uploading to external storage because Wave 2b is a
 * self-contained demo; `maxSize: 10 MB` (set below) caps bloat.
 *
 * `FileReader` produces a `data:<mime>;base64,<payload>` URL; we strip the
 * prefix so the runtime forwards the raw base64 value (what the agent
 * expects in `source.value`).
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
      // result looks like "data:image/png;base64,iVBORw0K..." — strip the prefix.
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
 * Installs the `onRunInitialized` subscriber on the active agent. Scoped
 * to a small inner component so it can use the `useAgent` hook the
 * <CopilotChat> parent already relies on — subscribing there means we
 * rewrite messages on the *same* agent instance CopilotChat dispatches
 * through, even when threads are cloned or swapped.
 */
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
    let kept: unknown[] = [];
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
      // After every messages snapshot from the server, strip duplicate
      // media parts and normalize types that the @ag-ui/langgraph
      // round-trip mangled. We hook both `onMessagesSnapshotEvent` and
      // `onMessagesChanged` to catch incremental events too — the
      // snapshot fires once at run end, the changed handler fires on
      // every streamed update.
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
    // cast at the subscribe boundary. The cast is safe: our
    // onRunInitialized only ever returns a messages-mutation or void.
    const handle = agent.subscribe(
      subscriber as unknown as Parameters<typeof agent.subscribe>[0],
    );
    return () => handle.unsubscribe();
  }, [agent, subscriber]);

  return null;
}

export default function MultimodalDemoPage() {
  // `onUpload` is passed into CopilotChat's `AttachmentsConfig`. Both the
  // paperclip button and the sample-injection path route files through
  // this same function (sample buttons drive CopilotChat's hidden file
  // input, which calls this internally via `useAttachments`). No
  // duplicated upload code lives in the sample-button component.
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

        <SampleAttachmentButtons agentId="multimodal-demo" />

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
                // Log without disrupting the default UI — CopilotChat already
                // shows a toast-style indicator on validation failure.
                console.warn("[multimodal-demo] attachment rejected", err);
              },
            }}
          />
        </div>
      </div>
    </CopilotKit>
  );
}
