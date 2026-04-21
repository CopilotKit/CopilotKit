import { useState } from "react";
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

type AgentType = "tanstack" | "aisdk";

export default function Index() {
  const [agentType, setAgentType] = useState<AgentType>("tanstack");

  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
      <div className="h-screen w-screen flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2 border-b bg-white">
          <span className="text-sm font-medium text-gray-600">Agent:</span>
          <button
            onClick={() => setAgentType("aisdk")}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              agentType === "aisdk"
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            AI SDK
          </button>
          <button
            onClick={() => setAgentType("tanstack")}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              agentType === "tanstack"
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            TanStack AI
          </button>
        </div>
        <div className="flex-1">
          <CopilotChat
            key={agentType}
            agentId={agentType}
            className="h-full w-full"
            attachments={{ enabled: true }}
            onError={(event) => {
              console.error("[CopilotChat] Error:", event);
            }}
          />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
