"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { AGENT_ID, Chat } from "./chat";

export default function DeclarativeJsonRenderDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("declarative-json-render")}
      agent={AGENT_ID}
    >
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}
