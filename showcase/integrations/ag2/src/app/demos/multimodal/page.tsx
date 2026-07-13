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
 *   under the graph id `multimodal`. ag2 1.0 maps attachments natively:
 *   images go to the vision model, PDFs travel as OpenAI file parts —
 *   no server-side flattening needed.
 * - Sample files live at `/demo-files/sample.png` and `/demo-files/sample.pdf`
 *   (see `public/demo-files/`). The sample-buttons component fetches them
 *   client-side, wraps the blob in a File, and drives the same hidden
 *   `<input type="file">` the paperclip path uses (DataTransfer + dispatch
 *   `change`). This keeps the sample and real-upload paths on a single
 *   code path — whatever works for one works for both.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { LegacyConverterShim } from "./legacy-converter-shim";
import { MultimodalChat } from "./multimodal-chat";

export default function MultimodalDemoPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-multimodal" agent="multimodal-demo">
      <LegacyConverterShim />
      <MultimodalChat />
    </CopilotKit>
  );
}
