"use client";

import { useState, useEffect, useRef } from "react";
import { useCoAgent } from "@copilotkit/react-core";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { ConnectionType, ServerConfig, MCP_STORAGE_KEY } from "@/lib/mcp-config-types";
import { X, Plus, Server, Globe, Trash2 } from "lucide-react";
import { AvailableAgents } from "@/lib/available-agents";

// External link icon component
const ExternalLink = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="w-3 h-3 ml-1"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
    />
  </svg>
);

interface MCPConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MCPConfigModal({ isOpen, onClose }: MCPConfigModalProps) {
  // Use ref to avoid re-rendering issues
  const configsRef = useRef<Record<string, ServerConfig>>({});
  
  // Use localStorage hook for persistent storage
  const [savedConfigs, setSavedConfigs] = useLocalStorage<
    Record<string, ServerConfig>
  >(MCP_STORAGE_KEY, {});
  
  // Set the ref value once we have the saved configs
  useEffect(() => {
    if (Object.keys(savedConfigs).length > 0) {
      configsRef.current = savedConfigs;
    }
  }, [savedConfigs]);

  // Initialize agent state with the data from localStorage
  const { state: agentState, setState: setAgentState } = useCoAgent<{
    mcp_config: Record<string, ServerConfig>;
    response: string;
    logs: Array<{ message: string; done: boolean }>;
  }>({
    name: AvailableAgents.MCP_AGENT,
    initialState: {
      mcp_config: configsRef.current,
      response: "",
      logs: [],
    },
  });

  // Simple getter for configs
  const configs = agentState?.mcp_config || {};

  // Simple setter wrapper for configs
  const setConfigs = (newConfigs: Record<string, ServerConfig>) => {
    setAgentState((prevState) => ({
      ...prevState!,
      mcp_config: newConfigs,
    }));
    setSavedConfigs(newConfigs);
    configsRef.current = newConfigs;
  };

  const [serverName, setServerName] = useState("");
  const [connectionType, setConnectionType] = useState<ConnectionType>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [showAddServerForm, setShowAddServerForm] = useState(false);

  // Calculate server statistics
  const totalServers = Object.keys(configs).length;
  const stdioServers = Object.values(configs).filter(
    (config) => config.transport === "stdio"
  ).length;
  const sseServers = Object.values(configs).filter(
    (config) => config.transport === "sse"
  ).length;

  // Set loading to false when state is loaded
  useEffect(() => {
    if (agentState) {
      setIsLoading(false);
    }
  }, [agentState]);

  const addConfig = () => {
    if (!serverName) return;

    const newConfig =
      connectionType === "stdio"
        ? {
            command,
            args: args.split(" ").filter((arg) => arg.trim() !== ""),
            transport: "stdio" as const,
          }
        : {
            url,
            transport: "sse" as const,
          };

    setConfigs({
      ...configs,
      [serverName]: newConfig,
    });

    // Reset form
    setServerName("");
    setCommand("");
    setArgs("");
    setUrl("");
    setShowAddServerForm(false);
  };

  const removeConfig = (name: string) => {
    const newConfigs = { ...configs };
    delete newConfigs[name];
    setConfigs(newConfigs);
  };

  if (!isOpen) return null;

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto relative z-[10000]">
          <div className="p-4">Loading configuration...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto relative z-[10000]">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <Server className="h-6 w-6 mr-2 text-gray-700" />
              <h1 className="text-2xl font-semibold">MCP Server Configuration</h1>
            </div>
            <button 
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mt-4 gap-4">
            <p className="text-sm text-gray-600">
              Manage and configure your MCP servers
            </p>
            <button
              onClick={() => setShowAddServerForm(true)}
              className="w-full sm:w-auto px-3 py-1.5 bg-gray-800 text-white rounded-md text-sm font-medium hover:bg-gray-700 flex items-center gap-1 justify-center"
            >
              <Plus className="h-4 w-4" />
              Add Server
            </button>
          </div>
        </div>

        {/* Server Statistics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white border rounded-md p-4">
            <div className="text-sm text-gray-500">Total Servers</div>
            <div className="text-3xl font-bold">{totalServers}</div>
          </div>
          <div className="bg-white border rounded-md p-4">
            <div className="text-sm text-gray-500">Stdio Servers</div>
            <div className="text-3xl font-bold">{stdioServers}</div>
          </div>
          <div className="bg-white border rounded-md p-4">
            <div className="text-sm text-gray-500">SSE Servers</div>
            <div className="text-3xl font-bold">{sseServers}</div>
          </div>
        </div>

        {/* Server List */}
        <div className="bg-white border rounded-md p-6">
          <h2 className="text-lg font-semibold mb-4">Server List</h2>

          {totalServers === 0 ? (
            <div className="text-gray-500 text-center py-10">
              No servers configured. Click &quot;Add Server&quot; to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(configs).map(([name, config]) => (
                <div
                  key={name}
                  className="border rounded-md overflow-hidden bg-white shadow-sm"
                >
                  <div className="p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{name}</h3>
                        <div className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-xs rounded mt-1">
                          {config.transport === "stdio" ? (
                            <Server className="w-3 h-3 mr-1" />
                          ) : (
                            <Globe className="w-3 h-3 mr-1" />
                          )}
                          {config.transport}
                        </div>
                      </div>
                      <button
                        onClick={() => removeConfig(name)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-3 text-sm text-gray-600">
                      {config.transport === "stdio" ? (
                        <>
                          <p>Command: {config.command}</p>
                          <p className="truncate">
                            Args: {config.args.join(" ")}
                          </p>
                        </>
                      ) : (
                        <p className="truncate">URL: {config.url}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reference */}
          <div className="mt-10 pt-4 border-t text-center text-sm text-gray-500">
            More MCP servers available on the web, e.g.{" "}
            <a
              href="https://mcp.composio.dev/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-700 hover:text-gray-900 inline-flex items-center mr-2"
            >
              mcp.composio.dev
              <ExternalLink />
            </a>
            and{" "}
            <a
              href="https://www.mcp.run/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-700 hover:text-gray-900 inline-flex items-center"
            >
              mcp.run
              <ExternalLink />
            </a>
          </div>
        </div>

        {/* Add Server Modal */}
        {showAddServerForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold flex items-center">
                  <Plus className="w-5 h-5 mr-2" />
                  Add New Server
                </h2>
                <button
                  onClick={() => setShowAddServerForm(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Server Name
                  </label>
                  <input
                    type="text"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md text-sm"
                    placeholder="e.g., api-service, data-processor"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Connection Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setConnectionType("stdio")}
                      className={`px-3 py-2 border rounded-md text-center flex items-center justify-center ${
                        connectionType === "stdio"
                          ? "bg-gray-200 border-gray-400 text-gray-800"
                          : "bg-white text-gray-700"
                      }`}
                    >
                      <Server className="w-4 h-4 mr-1" />
                      Standard IO
                    </button>
                    <button
                      type="button"
                      onClick={() => setConnectionType("sse")}
                      className={`px-3 py-2 border rounded-md text-center flex items-center justify-center ${
                        connectionType === "sse"
                          ? "bg-gray-200 border-gray-400 text-gray-800"
                          : "bg-white text-gray-700"
                      }`}
                    >
                      <Globe className="w-4 h-4 mr-1" />
                      SSE
                    </button>
                  </div>
                </div>

                {connectionType === "stdio" ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Command
                      </label>
                      <input
                        type="text"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        placeholder="e.g., python, node"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Arguments
                      </label>
                      <input
                        type="text"
                        value={args}
                        onChange={(e) => setArgs(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        placeholder="e.g., path/to/script.py"
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-sm font-medium mb-1">URL</label>
                    <input
                      type="text"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="w-full px-3 py-2 border rounded-md text-sm"
                      placeholder="e.g., http://localhost:8000/events"
                    />
                  </div>
                )}

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setShowAddServerForm(false)}
                    className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 text-sm font-medium flex items-center"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Cancel
                  </button>
                  <button
                    onClick={addConfig}
                    className="px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700 text-sm font-medium flex items-center"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Server
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
