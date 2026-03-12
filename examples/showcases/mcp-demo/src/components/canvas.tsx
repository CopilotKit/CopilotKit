"use client";

import * as Skeletons from "@/components/skeletons";
import { Settings } from "lucide-react";
import React, { Suspense, useState } from "react";
import { ChatWindow } from "./chat-window";
import { MCPConfigModal } from "./mcp-config-modal";
import { TodoProvider } from "@/contexts/TodoContext";
import { TodoApp } from "./Todo";
import VisualRepresentation from "./VisualRepresentation";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";

export default function Canvas() {
  const [showMCPConfigModal, setShowMCPConfigModal] = useState(false);
  useCopilotChatSuggestions(
    {
      instructions:
        "Ask which MCP connection the agent should check. Once the agent has checked the MCP connection, ask the agent to suggest a task to do.",
      minSuggestions: 1,
      maxSuggestions: 3,
    },
    []
  );
  return (
    <TodoProvider>
      <div className="flex h-screen w-screen bg-gray-100">
        <div className="w-96 flex-shrink-0 border-r border-gray-200 bg-white p-4 overflow-y-auto">
          <ChatWindow />
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-white flex-shrink-0">
            <h1 className="text-2xl font-bold">Working Memory</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowMCPConfigModal(true)}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                <span className="font-medium">MCP Servers</span>
              </button>
              <a 
                href="https://github.com/CopilotKit/copilotkit-mcp-demo"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 hover:border-gray-400 px-4 py-2 rounded-full shadow-sm flex items-center gap-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 4.624-5.479 4.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                <span className="font-medium">GitHub</span>
              </a>
              <a 
                href="https://docs.copilotkit.ai/direct-to-llm/guides/model-context-protocol"
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 hover:border-gray-400 px-4 py-2 rounded-full shadow-sm flex items-center gap-2 transition-colors"
              >
                <span className="text-lg">📚</span>
                <span className="font-medium">Docs</span>
              </a>
            </div>
          </div>

          <div className="flex-1 flex gap-5 p-5 overflow-hidden">
            <div className="flex-[3] bg-white p-6 rounded-lg shadow border border-gray-200 overflow-y-auto">
              <Suspense fallback={<Skeletons.EmailListSkeleton />}>
                <VisualRepresentation />
              </Suspense>
            </div>

            <div className="flex-[3] bg-white p-6 rounded-lg shadow border border-gray-200 overflow-y-auto">
              <Suspense fallback={<Skeletons.EmailListSkeleton />}>
                <TodoApp />
              </Suspense>
            </div>
          </div>
        </div>

        <MCPConfigModal
          isOpen={showMCPConfigModal}
          onClose={() => setShowMCPConfigModal(false)}
        />
      </div>
    </TodoProvider>
  );
}
