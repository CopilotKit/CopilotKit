"use client";

/**
 * Headless = bring-your-own-UI. Simple = the smallest possible chat using
 * the two core hooks (`useAgent` + `useCopilotKit`), styled with shadcn/ui.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { Chat } from "./chat";

export default function HeadlessSimpleDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="headless-simple">
      <Chat />
    </CopilotKit>
  );
}
