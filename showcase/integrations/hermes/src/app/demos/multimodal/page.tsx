"use client";

/**
 * Multimodal Attachments demo (hermes).
 *
 * Wires CopilotChat's `AttachmentsConfig` for image + PDF uploads and adds
 * two "Try with sample X" buttons that inject bundled files through the
 * same pipeline the paperclip button uses.
 *
 * Architecture:
 * - Dedicated runtime route at `/api/copilotkit-multimodal` (see
 *   ../../api/copilotkit-multimodal/route.ts). It proxies to the same
 *   hermes AG-UI adapter as every other cell; the dedicated route mirrors
 *   langgraph-python's per-demo route boundary.
 * - The hermes AG-UI adapter forwards image content parts to the model
 *   natively (translate._content_to_parts emits OpenAI-style
 *   `image_url` parts). Unlike langgraph-python there is NO
 *   `LegacyConverterShim` and NO PDF-flatten middleware: hermes sends
 *   modern AG-UI content parts over `@ag-ui/client`, and the model is
 *   vision-capable so images pass through directly.
 * - Sample files live at `/demo-files/sample.png` and `/demo-files/sample.pdf`
 *   (see `public/demo-files/`). The sample-buttons component fetches them
 *   client-side, builds an already-base64'd content part, and dispatches
 *   it via `agent.addMessage` + `copilotkit.runAgent` — the same agent
 *   surface `CopilotChat.onSubmitInput` uses.
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
