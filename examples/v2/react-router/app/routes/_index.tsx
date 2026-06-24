import { useState } from "react";
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import {
  StreamdownRenderer,
  customMarkdownConfig,
} from "../lib/markdown-renderers";

type AgentType = "tanstack" | "aisdk";
type MarkdownMode = "built-in" | "custom" | "streamdown";

export default function Index() {
  const [agentType, setAgentType] = useState<AgentType>("tanstack");
  // Demo: swap the markdown renderer at runtime via the provider's pluggable
  // `markdownRenderer` prop, which accepts EITHER a config object or a
  // component. Three scenarios:
  //   "built-in"  = undefined -> CopilotKit's default streaming renderer
  //                 (@copilotkit/markdown-renderer — zero extra deps,
  //                 streaming-safe incremental rendering + per-token animation).
  //   "custom"    = a DefaultMarkdownRendererProps config object that configures
  //                 the built-in renderer with custom node renderers (here a
  //                 terminal-style code block + accent blockquote) while keeping
  //                 the streaming behavior.
  //   "streamdown"= the app-supplied streamdown component — the escape hatch
  //                 that replaces the renderer entirely (syntax highlighting,
  //                 math, diagrams).
  // Ask the agent for a code block, blockquote, table, or math to compare.
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("built-in");

  const markdownRenderer =
    markdownMode === "streamdown"
      ? StreamdownRenderer
      : markdownMode === "custom"
        ? customMarkdownConfig
        : undefined;

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      showDevConsole="auto"
      markdownRenderer={markdownRenderer}
    >
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

          <span className="ml-4 text-sm font-medium text-gray-600">
            Markdown:
          </span>
          <button
            onClick={() => setMarkdownMode("built-in")}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              markdownMode === "built-in"
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Built-in (streaming)
          </button>
          <button
            onClick={() => setMarkdownMode("custom")}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              markdownMode === "custom"
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Custom (config)
          </button>
          <button
            onClick={() => setMarkdownMode("streamdown")}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              markdownMode === "streamdown"
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Streamdown
          </button>

          <span className="ml-auto text-xs text-gray-400">
            Ask for a code block, table, or math — then toggle the renderer.
          </span>
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
