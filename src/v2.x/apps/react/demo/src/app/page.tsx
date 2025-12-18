"use client";

import {
  CopilotChat,
  CopilotKitProvider,
  useFrontendTool,
  defineToolCallRenderer,
  useConfigureSuggestions,
  useAgentContext,
} from "@copilotkitnext/react";
import type { ToolsMenuItem } from "@copilotkitnext/react";
import { z } from "zod";
import { useMemo, useState } from "react";

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
    <CopilotKitProvider runtimeUrl="/api/copilotkit" renderToolCalls={[wildcardRenderer]} showDevConsole="auto">
      <div style={{ height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}>
        <Chat />
      </div>
    </CopilotKitProvider>
  );
}

function Chat() {
  const [selectedThreadId, setSelectedThreadId] = useState<"thread---a" | "thread---b" | "thread---c">("thread---a");
  const threadOptions: Array<{ id: typeof selectedThreadId; label: string }> = [
    { id: "thread---a", label: "Thread A" },
    { id: "thread---b", label: "Thread B" },
    { id: "thread---c", label: "Thread C" },
  ];

  useConfigureSuggestions({
    instructions: "Suggest follow-up tasks based on the current page content",
  });

  useAgentContext({ description: "The current Thread ID is:", value: selectedThreadId });

  //useConfigureSuggestions({
  //  instructions: "Suggest helpful next actions",
  //});

  // useConfigureSuggestions({
  //   suggestions: [
  //     {
  //       title: "Action 1",
  //       message: "Do action 1",
  //     },
  //     {
  //       title: "Action 2",
  //       message: "Do action 2",
  //     },
  //   ],
  // });

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
  const toolsMenu = useMemo<(ToolsMenuItem | "-")[]>(
    () => [
      {
        label: "Say hi to CopilotKit",
        action: () => {
          const textarea = document.querySelector<HTMLTextAreaElement>("textarea[placeholder='Type a message...']");
          if (!textarea) {
            return;
          }

          const greeting = "Hello Copilot! 👋 Could you help me with something?";

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
          window.open("https://docs.copilotkit.ai", "_blank", "noopener,noreferrer");
        },
      },
    ],
    [],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "16px", gap: "16px" }}>
      <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
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
      <div style={{ flex: 1, minHeight: 0 }}>
        <CopilotChat inputProps={{ toolsMenu }} threadId={selectedThreadId} />
      </div>
    </div>
  );
}
