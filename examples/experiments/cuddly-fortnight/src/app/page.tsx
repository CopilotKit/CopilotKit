"use client";

import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import Header from "./Header";
import MainContent from "./components/MainContent";

export default function Page() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <div className="flex flex-col h-screen">
        <Header />
        <div className="flex-grow p-4 flex gap-4">
          <MainContent />
          <div className="w-[40%] border-l-2 border-gray-200 pl-4">
            <CopilotChat
              instructions="You are a helpful assistant that can answer questions about the user's account. You have access to MCP servers if defined in the mcpEndpoints array."
              className="h-full rounded-lg"
            />
          </div>
        </div>
      </div>
    </CopilotKit>
  );
}
