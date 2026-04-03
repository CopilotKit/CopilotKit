import { useState } from "react";
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

type AgentType = "tanstack" | "builtin";

export default function Index() {
  const [agentType, setAgentType] = useState<AgentType>("builtin");

  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole="auto">
      <div className="h-screen w-screen flex flex-col">
        <div className="flex items-center gap-3 px-4 py-2 border-b bg-white">
          <span className="text-sm font-medium text-gray-600">Agent:</span>
          <button
            onClick={() => setAgentType("builtin")}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              agentType === "builtin"
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            BuiltInAgent
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
          />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
