import React, { FC, useState, useEffect, useRef } from "react";
import { AvailableAgents } from "@/lib/available-agents";
import { useCoAgent, useCoAgentStateRender } from "@copilotkit/react-core";
import { CheckCircleIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { ServerConfig, MCP_STORAGE_KEY } from "@/lib/mcp-config-types";
import { useLocalStorage } from "@/hooks/use-local-storage";

export type MCPAgentState = {
  response: string;
  logs: Array<{
    message: string;
    done: boolean;
  }>;
  mcp_config?: Record<string, ServerConfig>;
};

export const MCPAgent: FC = () => {
  const [logs, setLogs] = useState<
    Array<{
      message: string;
      done: boolean;
    }>
  >([]);
  
  const isProcessing = useRef(false);
  
  // Use ref to avoid re-rendering issues
  const configsRef = useRef<Record<string, ServerConfig>>({});
  
  // Get saved MCP configurations from localStorage
  const [savedConfigs] = useLocalStorage<Record<string, ServerConfig>>(MCP_STORAGE_KEY, {});
  
  // Set the ref value once we have the saved configs
  if (Object.keys(savedConfigs).length > 0 && Object.keys(configsRef.current).length === 0) {
    configsRef.current = savedConfigs;
  }

  const { state: mcpAgentState, stop: stopMcpAgent } = useCoAgent<MCPAgentState>({
    name: AvailableAgents.MCP_AGENT,
    initialState: {
      response: "",
      logs: [],
      mcp_config: configsRef.current,
    },
  });

  useEffect(() => {
    if (mcpAgentState.logs) {
      setLogs((prevLogs) => {
        const newLogs = [...prevLogs];
        mcpAgentState.logs.forEach((log) => {
          const existingLogIndex = newLogs.findIndex(
            (l) => l.message === log.message
          );
          if (existingLogIndex >= 0) {
            if (log.done && !newLogs[existingLogIndex].done) {
              newLogs[existingLogIndex].done = true;
            }
          } else {
            newLogs.push(log);
          }
        });
        return newLogs;
      });
    }
  }, [mcpAgentState.logs]);

  useCoAgentStateRender({
    name: AvailableAgents.MCP_AGENT,
    handler: ({ nodeName }) => {
      if (nodeName === "__end__") {
        setTimeout(() => {
          stopMcpAgent();
        }, 1000);
      }
    },
    render: ({ status }) => {
      if (status === "inProgress") {
        isProcessing.current = true;
        return (
          <div className="p-4 bg-gray-50 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">Processing your request...</h3>
            <ul className="space-y-2">
              {logs.map((log, idx) => (
                <li key={idx} className="flex items-start">
                  <span className={`mr-2 ${log.done ? "text-green-500" : "text-gray-400"}`}>
                    {log.done ? "✓" : "⟳"}
                  </span>
                  <span>{log.message}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      }

      if (status === "complete") {
        isProcessing.current = false;
        return (
          <div>
            <div className="prose max-w-none">
              <div className="flex items-center gap-2 text-green-600 mb-4">
                <CheckCircleIcon className="h-5 w-5" />
                <span>Processing complete</span>
              </div>
            </div>
          </div>
        );
      }
    },
  });

  if (isProcessing.current) {
    return (
      <div className="flex flex-col gap-4 h-full z-[999]">
        <div className="animate-pulse p-6 bg-white rounded-lg shadow-sm">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-4/6 mb-2"></div>
        </div>
      </div>
    );
  }

  if (!mcpAgentState.response) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 h-full z-[999]">
      <div className="flex flex-col gap-2 p-6 bg-white rounded-lg shadow-sm">
        <ReactMarkdown
          className="prose prose-sm md:prose-base lg:prose-lg prose-slate max-w-none bg-gray-50 p-6 rounded-lg border border-gray-200"
          components={{
            h1: ({ children }) => (
              <h1 className="text-3xl font-bold mb-6 pb-2 border-b">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-2xl font-bold mb-4 mt-8">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-xl font-bold mb-3 mt-6">{children}</h3>
            ),
            p: ({ children }) => (
              <p className="mb-4 leading-relaxed">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="list-disc pl-6 mb-4 space-y-2">{children}</ul>
            ),
            ol: ({ children }) => (
              <ol className="list-decimal pl-6 mb-4 space-y-2">{children}</ol>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-gray-300 pl-4 py-2 my-6 bg-gray-50 rounded-r">
                {children}
              </blockquote>
            ),
          }}
        >
          {mcpAgentState.response}
        </ReactMarkdown>
      </div>
    </div>
  );
};
