"use client";

import { useParams } from "next/navigation";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { AGENT_ID, Chat } from "./chat";

export default function ByocJsonRenderDemo() {
  const { integration } = useParams<{ integration: string }>();
  return (
    <CopilotKit
      runtimeUrl={`/api/${integration}/declarative-json-render`}
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
