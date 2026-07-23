"use client";

/**
 * Multimodal Attachments demo (Google ADK).
 *
 * Wires CopilotChat's `AttachmentsConfig` for image + PDF uploads and adds
 * two "Try with sample X" buttons that inject bundled files through the
 * same pipeline the paperclip button uses.
 *
 * Architecture:
 * - Dedicated runtime route at `/api/copilotkit-multimodal` (see
 *   ../../api/copilotkit-multimodal/route.ts). Keeping multimodal on its
 *   own route preserves the per-cell isolation pattern LP uses and gives
 *   us a clean place to wire the LegacyConverterShim subscriber.
 * - Dedicated ADK agent at `src/agents/multimodal_agent.py` under the
 *   slug `multimodal-demo`. The agent is registered in `registry.py`
 *   under the backend name `multimodal`. Gemini is natively multimodal
 *   so image/PDF parts are forwarded through ADK directly — no Python-
 *   side flattening needed.
 * - Sample files live at `/demo-files/sample.png` and `/demo-files/sample.pdf`
 *   (see `public/demo-files/`). The sample-buttons component fetches them
 *   client-side, wraps the blob in a File, and routes through the same
 *   V2 agent surface (`agent.addMessage` + `copilotkit.runAgent`) the
 *   paperclip path ultimately feeds.
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
