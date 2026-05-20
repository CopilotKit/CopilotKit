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
 */

import { useCallback } from "react";
import { CopilotKit, CopilotChat } from "@copilotkit/react-core/v2";
import type { AttachmentUploadResult } from "@copilotkit/shared";

import { SampleAttachmentButtons } from "./sample-attachment-buttons";

/**
 * `onUpload` must resolve to an `AttachmentUploadResult` (data or url). We
 * always return the `data` variant — the demo inlines base64 instead of
 * uploading to external storage, matching the Wave 2b spec.
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

export default function MultimodalDemoPage() {
  // `onUpload` is passed into CopilotChat's `AttachmentsConfig`. Both the
  // paperclip button and the sample-injection path route files through
  // this same function (sample buttons drive CopilotChat's hidden file
  // input, which calls this internally via `useAttachments`). No
  // duplicated upload code lives in the sample-button component.
  const onUpload = useCallback(fileToDataAttachment, []);

  return (
    <CopilotKit runtimeUrl="/api/copilotkit-multimodal" agent="multimodal-demo">
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
