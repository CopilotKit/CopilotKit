"use client";

import {
  CopilotChat,
  CopilotKitProvider,
  defineToolCallRenderer,
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkitnext/react";
import type { ToolsMenuItem } from "@copilotkitnext/react";
import { useMemo, useState } from "react";
import { z } from "zod";

// Disable static optimization for this page
export const dynamic = "force-dynamic";

export default function Home() {
  // Define a wildcard renderer for any undefined tools
  const wildcardRenderer = defineToolCallRenderer({
    name: "*",
    // No args needed for wildcard - defaults to z.any()
    render: ({ name, args, status }) => (
      <div
        style={{
          padding: "12px",
          margin: "8px 0",
          backgroundColor: "#f0f0f0",
          borderRadius: "8px",
          border: "1px solid #ccc",
        }}
      >
        <strong>Unknown Tool: {name}</strong>
        <pre style={{ marginTop: "8px", fontSize: "12px" }}>
          Status: {status}
          {args && "\nArguments: " + JSON.stringify(args, null, 2)}
        </pre>
      </div>
    ),
  });

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      renderToolCalls={[wildcardRenderer]}
      showDevConsole="auto"
    >
      <div
        style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}
      >
        <Chat />
      </div>
    </CopilotKitProvider>
  );
}

function Chat() {
  const [selectedThreadId, setSelectedThreadId] = useState<
    "thread---a" | "thread---b" | "thread---c"
  >("thread---a");
  const threadOptions: Array<{ id: typeof selectedThreadId; label: string }> = [
    { id: "thread---a", label: "Thread A" },
    { id: "thread---b", label: "Thread B" },
    { id: "thread---c", label: "Thread C" },
  ];

  useConfigureSuggestions({
    instructions: "Suggest follow-up tasks based on the current page content",
    available: "always",
  });

  useAgentContext({
    description: "The current Thread ID is:",
    value: selectedThreadId,
  });

  useFrontendTool({
    name: "sayHello",
    parameters: z.object({
      name: z.string(),
    }),
    handler: async ({ name }) => {
      alert(`Hello ${name}`);
      return `Hello ${name}`;
    },
  });

  // useAgent: streamingStatus exposes granular AG-UI event phases as React state
  const { streamingStatus: status } = useAgent();
  const toolsMenu = useMemo<(ToolsMenuItem | "-")[]>(
    () => [
      {
        label: "Say hi to CopilotKit",
        action: () => {
          const textarea = document.querySelector<HTMLTextAreaElement>(
            "textarea[placeholder='Type a message...']",
          );
          if (!textarea) {
            return;
          }

          const greeting =
            "Hello Copilot! 👋 Could you help me with something?";

          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value",
          )?.set;
          nativeInputValueSetter?.call(textarea, greeting);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          textarea.focus();
        },
      },
      "-",
      {
        label: "Open CopilotKit Docs",
        action: () => {
          window.open(
            "https://docs.copilotkit.ai",
            "_blank",
            "noopener,noreferrer",
          );
        },
      },
    ],
    [],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "16px",
        gap: "16px",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "10px",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {threadOptions.map(({ id, label }) => {
          const isActive = id === selectedThreadId;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedThreadId(id)}
              aria-pressed={isActive}
              style={{
                padding: "6px 14px",
                borderRadius: "20px",
                border: isActive ? "2px solid #111827" : "1px solid #d1d5db",
                backgroundColor: isActive ? "#111827" : "#ffffff",
                color: isActive ? "#ffffff" : "#111827",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: "pointer",
                transition: "all 0.15s ease-in-out",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <CopilotChat input={{ toolsMenu }} threadId={selectedThreadId} />
        {status.isRunning && (
          <div
            style={{
              position: "absolute",
              bottom: "80px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 50,
              padding: "6px 16px",
              borderRadius: "20px",
              fontSize: "0.8rem",
              fontWeight: 600,
              pointerEvents: "none",
              whiteSpace: "nowrap",
              backgroundColor:
                status.phase === "reasoning"
                  ? "#fef3c7"
                  : status.phase === "tool_calling"
                    ? "#dbeafe"
                    : status.phase === "streaming"
                      ? "#d1fae5"
                      : "#f3f4f6",
              color:
                status.phase === "reasoning"
                  ? "#92400e"
                  : status.phase === "tool_calling"
                    ? "#1e40af"
                    : status.phase === "streaming"
                      ? "#065f46"
                      : "#6b7280",
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              transition: "all 0.2s ease-in-out",
            }}
          >
            {status.phase === "reasoning" && "Thinking..."}
            {status.phase === "tool_calling" && `Calling ${status.toolName}...`}
            {status.phase === "streaming" && "Writing response..."}
            {status.phase === "idle" && "Starting..."}
          </div>
        )}
      </div>
    </div>
  );
}
