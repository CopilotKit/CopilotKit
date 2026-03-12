"use client";

import * as Agents from "@/components/agents";
import * as Skeletons from "@/components/skeletons";
import { AvailableAgents } from "@/lib/available-agents";
import { useCoAgent } from "@copilotkit/react-core";
import { CircleOff, Loader2, Settings } from "lucide-react";
import { Suspense, useState } from "react";
import { ChatWindow } from "./chat-window";
import { MCPConfigModal } from "./mcp-config-modal";

const getCurrentlyRunningAgent = (
  state: Array<{
    status: boolean;
    name: string;
    nodeName: string;
  }>
) => {
  return state.find((agent) => agent.status);
};

const DefaultView = () => (
  <div className="flex items-center justify-center h-full text-gray-600">
    <p className="text-2xl text-center font-serif italic max-w-3xl">
      <strong>Powered by CopilotKit 🪁</strong>
      <br />
      <br />
      Start a conversation in the chat to begin planning your
      trip, researching topics, or use the MCP agent for other tasks!
    </p>
  </div>
);

export default function Canvas() {
  const [showMCPConfigModal, setShowMCPConfigModal] = useState(false);

  const {
    running: travelAgentRunning,
    name: travelAgentName,
    nodeName: travelAgentNodeName,
  } = useCoAgent({
    name: AvailableAgents.TRAVEL_AGENT,
  });

  const {
    running: aiResearchAgentRunning,
    name: aiResearchAgentName,
    nodeName: aiResearchAgentNodeName,
  } = useCoAgent({
    name: AvailableAgents.RESEARCH_AGENT,
  });

  const {
    running: mcpAgentRunning,
    name: mcpAgentName,
    nodeName: mcpAgentNodeName,
  } = useCoAgent({
    name: AvailableAgents.MCP_AGENT,
  });

  const currentlyRunningAgent = getCurrentlyRunningAgent([
    {
      status: travelAgentRunning,
      name: travelAgentName,
      nodeName: travelAgentNodeName ?? "",
    },
    {
      status: aiResearchAgentRunning,
      name: aiResearchAgentName,
      nodeName: aiResearchAgentNodeName ?? "",
    },
    {
      status: mcpAgentRunning,
      name: mcpAgentName,
      nodeName: mcpAgentNodeName ?? "",
    },
  ]);

  return (
    <div className="relative h-full w-full grid grid-cols-1 md:grid-cols-12">
      {currentlyRunningAgent?.status ? (
        <div className="absolute top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-full shadow-lg animate-pulse z-[9999]">
          <span className="font-bold">
            <Loader2 className="inline-block w-4 h-4 mr-2 animate-spin" />
            {currentlyRunningAgent.name} agent executing{" "}
            {currentlyRunningAgent.nodeName} node
          </span>{" "}
        </div>
      ) : (
        <div className="absolute top-4 right-4 flex gap-2 z-[9999]">
          <button 
            onClick={() => setShowMCPConfigModal(true)}
            className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2"
          >
            <Settings className="w-4 h-4" />
            <span className="font-medium">MCP Servers</span>
          </button>

          <div className="bg-gray-600 text-white px-4 py-2 rounded-full shadow-lg">
            <CircleOff className="inline-block w-4 h-4 mr-2 animate-spin" />
            <span className="font-bold">Multi-Agent</span>
          </div>
        </div>
      )}
      <div className="order-last md:order-first md:col-span-4 p-4 border-r h-screen overflow-y-auto">
        <ChatWindow />
      </div>

      <div className="order-first md:order-last md:col-span-8 bg-white p-8 overflow-y-auto">
        <div className="space-y-8 h-full">
          <Suspense fallback={<Skeletons.EmailListSkeleton />}>
            <div className="h-full">
              <Agents.TravelAgent />
              <Agents.AIResearchAgent />
              <Agents.MCPAgent />
              {!currentlyRunningAgent?.status && <DefaultView />}
            </div>
          </Suspense>
        </div>
      </div>

      {/* MCP Config Modal */}
      <MCPConfigModal 
        isOpen={showMCPConfigModal}
        onClose={() => setShowMCPConfigModal(false)}
      />
    </div>
  );
}
