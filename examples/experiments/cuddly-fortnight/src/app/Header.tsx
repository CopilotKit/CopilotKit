"use client";

import {
  CatchAllActionRenderProps,
  useCopilotAction,
  useCopilotChat,
} from "@copilotkit/react-core";
import { useEffect, useState } from "react";
import AddServerForm from "./AddServerForm";
import MCPToolCall from "./McpToolCall";

export default function Header() {
  const { setMcpServers, mcpServers } = useCopilotChat();
  const [showAddServer, setShowAddServer] = useState(false);

  // Initialize MCP servers on mount
  useEffect(() => {
    setMcpServers([
      {
        endpoint:
          "https://mcp.composio.dev/slack/rapping-fluffy-lighter-fCaF5V",
      },
    ]);
  }, [setMcpServers]);

  const handleAddServer = (endpoint: string) => {
    setMcpServers([...(mcpServers || []), { endpoint }]);
    setShowAddServer(false);
  };

  useCopilotAction({
    name: "*",
    render: ({ name, status, args, result }: CatchAllActionRenderProps<[]>) => (
      <MCPToolCall status={status} name={name} args={args} result={result} />
    ),
  });

  return (
    <div className="relative border-b border-gray-200 bg-gray-100">
      <div className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-3">
          <img
            src="https://avatars.githubusercontent.com/u/182288589?s=200&v=4"
            alt="MCP Logo"
            className="w-9 h-9 rounded-full shadow-md"
          />
          <h1 className="text-xl font-semibold text-gray-800">
            Chat with MCP Server
          </h1>
          {mcpServers && mcpServers.length > 0 && (
            <span className="px-2 py-0.5 ml-2 text-xs font-medium text-white bg-gray-600 rounded-full">
              {mcpServers.length}{" "}
              {mcpServers.length === 1 ? "server" : "servers"}
            </span>
          )}
        </div>

        <button
          onClick={() => setShowAddServer(!showAddServer)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gray-700 rounded-md hover:bg-gray-800 transition-all cursor-pointer"
          aria-label="Add MCP Server"
        >
          <span className="text-lg mr-1">+</span>
          <span>Add Server</span>
        </button>
      </div>

      {showAddServer && (
        <AddServerForm
          onAdd={handleAddServer}
          onCancel={() => setShowAddServer(false)}
        />
      )}
    </div>
  );
}
