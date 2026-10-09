"use client";

/**
 * Multimodal Attachments demo.
 *
 * Wires CopilotChat's `AttachmentsConfig` for image + PDF uploads and adds
 * two "Try with sample X" buttons that send bundled files through the same
 * V2 agent surface the paperclip button feeds.
 *
 * Architecture:
 * - Dedicated runtime route at `/api/copilotkit-multimodal` (see
 *   ../../api/copilotkit-multimodal/route.ts), so the attachment-reading
 *   agent is scoped to this cell.
 * - Dedicated Antigravity agent at `src/agents/multimodal.py`, mounted by
 *   agent_server under `multimodal-demo`. The ag-ui-antigravity adapter
 *   forwards inline image and document parts to Gemini as media, so PDFs
 *   reach the model as documents with no text flattening.
 * - Unlike langgraph-python, there is no legacy-converter shim: the modern
 *   `image|document` parts already validate as AG-UI 1.0 input, and the
 *   legacy `binary` mirror the shim appends would not.
 * - Sample files live at `/demo-files/sample.png` and `/demo-files/sample.pdf`
 *   (see `public/demo-files/`).
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { MultimodalChat } from "./multimodal-chat";

export default function MultimodalDemoPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-multimodal" agent="multimodal-demo">
      <MultimodalChat />
    </CopilotKit>
  );
}
