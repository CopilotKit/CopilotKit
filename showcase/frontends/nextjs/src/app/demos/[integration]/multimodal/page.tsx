"use client";

/**
 * Multimodal attachments: the chat takes image and PDF uploads through
 * CopilotChat's `attachments` config, and two "Try with sample" buttons send
 * a bundled file with a prompt.
 *
 * - The demo has its own runtime and a vision-capable agent, so only this
 *   demo pays for a vision model.
 * - The sample files are `/demo-files/sample.png` and
 *   `/demo-files/sample.pdf`, served from the app's `public/` folder.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { AttachmentRepairSubscription } from "./attachment-repair-subscription";
import { MultimodalChat } from "./multimodal-chat";

export default function MultimodalDemoPage() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("multimodal")}
      agent="multimodal-demo"
    >
      <AttachmentRepairSubscription agentId="multimodal-demo" />
      <MultimodalChat />
    </CopilotKit>
  );
}
