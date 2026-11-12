"use client";

import { CopilotKitProvider } from "@copilotkit/react-core";
import { AGENT_ID, Chat } from "./chat";

export default function ByocJsonRenderDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit-byoc-json-render" agentId={AGENT_ID}>
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
