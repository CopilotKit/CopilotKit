"use client";

import {
  CopilotChat,
  CopilotKitProvider,
  defineToolCallRenderer,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import type { ToolsMenuItem, SandboxFunction } from "@copilotkit/react-core/v2";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";

// Disable static optimization for this page
export const dynamic = "force-dynamic";

type Theme = "light" | "dark";

// Match CopilotKit's oklch CSS variables for consistent theming
const themeColors = {
  light: {
    bg: "oklch(1 0 0)",
    text: "oklch(0.145 0 0)",
    border: "oklch(0.922 0 0)",
    muted: "oklch(0.97 0 0)",
  },
  dark: {
    bg: "oklch(0.145 0 0)",
    text: "oklch(0.985 0 0)",
    border: "oklch(0.269 0 0)",
    muted: "oklch(0.269 0 0)",
  },
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

  const handleSetTheme = useCallback(
    async (args: { mode: "light" | "dark" }) => {
      setTheme(args.mode);
      return `Theme set to ${args.mode}`;
    },
    [],
  );

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
        <Chat
          theme={theme}
          onToggleTheme={() =>
            setTheme((t) => (t === "light" ? "dark" : "light"))
          }
        />
      </div>
    </CopilotKitProvider>
  );
}

function Chat({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}) {
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
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.muted,
            color: colors.text,
            cursor: "pointer",
            transition: "all 0.15s ease-in-out",
          }}
        >
          {theme === "light" ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          )}
        </button>
        <div
          style={{
            flex: 1,
            display: "flex",
            gap: "10px",
            justifyContent: "center",
          }}
        >
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
        <CopilotChat
          className={theme === "dark" ? "dark" : undefined}
          input={{ toolsMenu }}
          threadId={selectedThreadId}
          key={selectedThreadId ?? "stateless"}
        />
      </div>
    </div>
  );
}
