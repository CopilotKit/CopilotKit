"use client";

/**
 * Headless = bring-your-own-UI. Simple = the smallest possible chat using
 * the two core hooks (`useAgent` + `useCopilotKit`), styled with shadcn/ui.
 */

import { CopilotKitProvider } from "@copilotkit/react-core";
import { Chat } from "./chat";

export default function HeadlessSimpleDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" agentId="headless-simple">
      <Chat />
    </CopilotKitProvider>
  );
}
