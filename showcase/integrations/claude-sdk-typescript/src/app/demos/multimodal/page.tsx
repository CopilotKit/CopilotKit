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
 *   ../api/copilotkit-multimodal/route.ts). The vision-capable Claude model
 *   is scoped to just this demo, so other cells keep their cheaper text-only
 *   path.
 * - Dedicated Claude backend endpoint at `/multimodal` under the slug
 *   `multimodal-demo`. Both images and PDFs are forwarded to Claude
 *   natively as image/document blocks — no text flattening on the Claude
 *   side (unlike the Python backend, which uses pypdf).
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
