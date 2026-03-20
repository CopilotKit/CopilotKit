"use client";

import {
  CopilotChat,
  CopilotKitProvider,
  defineToolCallRenderer,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkitnext/react";
import type { ToolsMenuItem, SandboxFunction } from "@copilotkitnext/react";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";

// Disable static optimization for this page
export const dynamic = "force-dynamic";

type Theme = "light" | "dark";

const themeColors = {
  light: { bg: "#ffffff", text: "#111827", border: "#d1d5db", muted: "#f0f0f0" },
  dark: { bg: "#111827", text: "#f9fafb", border: "#374151", muted: "#1f2937" },
};

export default function Home() {
  const [theme, setTheme] = useState<Theme>("light");
  const colors = themeColors[theme];

  // Define a wildcard renderer for any undefined tools
  const wildcardRenderer = defineToolCallRenderer({
    name: "*",
    // No args needed for wildcard - defaults to z.any()
    render: ({ name, args, status }) => (
      <div
        style={{
          padding: "12px",
          margin: "8px 0",
          backgroundColor: colors.muted,
          borderRadius: "8px",
          border: `1px solid ${colors.border}`,
          color: colors.text,
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

  const handleSetTheme = useCallback(async (args: { mode: "light" | "dark" }) => {
    setTheme(args.mode);
    return `Theme set to ${args.mode}`;
  }, []);

  const sandboxFunctions = useMemo<SandboxFunction[]>(
    () => [
      {
        name: "setTheme",
        description:
          "Switch the host application theme between light and dark mode. " +
          "Call this when the user asks to change the theme or when generating UI with a theme toggle.",
        parameters: z.object({
          mode: z.enum(["light", "dark"]).describe("The theme mode to set"),
        }),
        handler: handleSetTheme,
      },
    ],
    [handleSetTheme],
  );

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      renderToolCalls={[wildcardRenderer]}
      showDevConsole="auto"
      openGenerativeUI={{ sandboxFunctions }}
    >
      <div
        style={{
          height: "100vh",
          margin: 0,
          padding: 0,
          overflow: "hidden",
          backgroundColor: colors.bg,
          color: colors.text,
          transition: "background-color 0.3s, color 0.3s",
        }}
      >
        <Chat theme={theme} onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))} />
      </div>
    </CopilotKitProvider>
  );
}

function Chat({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const colors = themeColors[theme];
  const [selectedThreadId, setSelectedThreadId] = useState<
    "thread---a" | "thread---b" | "thread---c" | undefined
  >(undefined);
  const threadOptions: Array<{ id: typeof selectedThreadId; label: string }> = [
    { id: undefined, label: "Stateless" },
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
    value: selectedThreadId ?? "stateless",
  });

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
      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <button
          type="button"
          onClick={onToggleTheme}
          style={{
            padding: "6px 14px",
            borderRadius: "20px",
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.muted,
            color: colors.text,
            fontWeight: 600,
            fontSize: "0.85rem",
            cursor: "pointer",
            transition: "all 0.15s ease-in-out",
          }}
        >
          {theme === "light" ? "Dark" : "Light"}
        </button>
        <div style={{ flex: 1, display: "flex", gap: "10px", justifyContent: "center" }}>
          {threadOptions.map(({ id, label }) => {
            const isActive = id === selectedThreadId;
            return (
              <button
                key={id ?? "stateless"}
                type="button"
                onClick={() => setSelectedThreadId(id)}
                aria-pressed={isActive}
                style={{
                  padding: "6px 14px",
                  borderRadius: "20px",
                  border: isActive
                    ? `2px solid ${colors.text}`
                    : `1px solid ${colors.border}`,
                  backgroundColor: isActive ? colors.text : colors.bg,
                  color: isActive ? colors.bg : colors.text,
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
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CopilotChat input={{ toolsMenu }} threadId={selectedThreadId} key={selectedThreadId ?? "stateless"} />
      </div>
    </div>
  );
}
