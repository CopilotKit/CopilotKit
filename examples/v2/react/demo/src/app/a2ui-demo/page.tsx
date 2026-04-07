"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";

export const dynamic = "force-dynamic";

export default function A2UIDemoPage() {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      a2ui={{}}
      showDevConsole="auto"
    >
      <div
        style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}
      >
        <CopilotChat agentId="demo-button" threadId="a2ui-demo-thread" />
      </div>
    </CopilotKitProvider>
  );
}
