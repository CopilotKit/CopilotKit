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
 *   ../api/copilotkit-multimodal/route.ts), mounting the agent under the
 *   slug `multimodal-demo`.
 * - NO dedicated model and NO Python agent. `multimodal-factory.ts` builds
 *   on `createBuiltInAgent`, so this demo runs the SAME model as every other
 *   built-in-agent cell (gpt-5.4), whose adapter consumes image parts
 *   natively. What is demo-specific is the PDF handling: the OpenAI text
 *   adapter cannot consume PDF `document` parts, so the factory flattens
 *   them to text server-side with `unpdf` before the model call.
 *
 *   An earlier version of this comment claimed a vision-capable gpt-4o was
 *   "scoped to just this demo" and named a LangGraph agent at
 *   `src/agents/multimodal_agent.py` registered in langgraph.json. Neither
 *   exists here — both are artifacts of the ag2/LangGraph integration this
 *   page was ported from. This integration has no Python agents at all.
 * - Sample files live at `/demo-files/sample.png` and `/demo-files/sample.pdf`
 *   (see `public/demo-files/`). The sample-buttons component fetches them
 *   client-side, wraps the blob in a File, and drives the same hidden
 *   `<input type="file">` the paperclip path uses (DataTransfer + dispatch
 *   `change`). This keeps the sample and real-upload paths on a single
 *   code path — whatever works for one works for both.
 */

import { useParams } from "next/navigation";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { LegacyConverterShim } from "./legacy-converter-shim";
import { MultimodalChat } from "./multimodal-chat";

export default function MultimodalDemoPage() {
  const { integration } = useParams<{ integration: string }>();
  return (
    <CopilotKit
      runtimeUrl={`/api/${integration}/multimodal`}
      agent="multimodal"
    >
      <LegacyConverterShim />
      <MultimodalChat />
    </CopilotKit>
  );
}
