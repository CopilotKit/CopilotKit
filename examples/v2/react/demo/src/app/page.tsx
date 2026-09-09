"use client";

import {
  CopilotChat,
  CopilotChatAssistantMessage,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  defineToolCallRenderer,
  useAgentContext,
  useComponent,
  useCopilotChatConfiguration,
  useConfigureSuggestions,
  useFrontendTool,
  useHumanInTheLoop,
  useThreads,
} from "@copilotkit/react-core/v2";
import type { ToolsMenuItem } from "@copilotkit/react-core/v2";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { DEMO_RUNTIME_URL } from "./runtime-url";

// Disable static optimization for this page
export const dynamic = "force-dynamic";

type Theme = "light" | "dark";

function DemoChart({
  title,
  bars = [],
}: {
  title: string;
  bars?: Array<{ label: string; value: number }>;
}) {
  const maxValue = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <section
      style={{
        display: "grid",
        gap: 12,
        padding: 16,
        border: "1px solid #d1d5db",
        borderRadius: 12,
      }}
    >
      <strong style={{ fontSize: "1rem" }}>{title}</strong>
      <div style={{ display: "flex", height: 160, gap: 16, alignItems: "end" }}>
        {/* Bar slots stay in order while labels stream in or repeat. */}
        {bars.map((bar, index) => (
          <div
            key={index}
            style={{ display: "grid", flex: 1, gap: 6, textAlign: "center" }}
          >
            <strong style={{ fontSize: "0.85rem" }}>{bar.value}</strong>
            <div
              style={{
                height: `${Math.max((bar.value / maxValue) * 110, 8)}px`,
                borderRadius: "6px 6px 2px 2px",
                backgroundColor: "#2563eb",
              }}
            />
            <span style={{ color: "#64748b", fontSize: "0.75rem" }}>
              {bar.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

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

  return (
    <CopilotKitProvider
      runtimeUrl={DEMO_RUNTIME_URL}
      renderToolCalls={[wildcardRenderer]}
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
  return (
    <CopilotChatConfigurationProvider>
      <ChatContent theme={theme} onToggleTheme={onToggleTheme} />
    </CopilotChatConfigurationProvider>
  );
}

function ChatContent({
  theme,
  onToggleTheme,
}: {
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const colors = themeColors[theme];
  const [isThreadsMenuOpen, setIsThreadsMenuOpen] = useState(false);
  const [draftThreadId, setDraftThreadId] = useState<string>();
  const [approvalResponses, setApprovalResponses] = useState<
    Record<string, boolean>
  >({});
  const configuration = useCopilotChatConfiguration();
  const agentId = configuration?.agentId ?? "default";
  const { threads } = useThreads({ agentId });
  const hasInspectorPreview = configuration?.threadId?.startsWith("thread---");
  const pastThreads = [
    ...(draftThreadId && !threads.some((thread) => thread.id === draftThreadId)
      ? [{ id: draftThreadId, label: "New thread", isDraft: true }]
      : []),
    ...threads.map((thread) => ({
      id: thread.id,
      label:
        thread.name ??
        (thread.id === draftThreadId ? "New thread" : "Untitled thread"),
      isDraft: thread.id === draftThreadId,
    })),
  ];

  const startNewThread = useCallback(() => {
    if (!configuration) return;

    const id = crypto.randomUUID();
    configuration.setActiveThreadId(id, { explicit: false });
    setDraftThreadId(id);
    setIsThreadsMenuOpen(false);
  }, [configuration]);

  const selectThread = useCallback(
    (threadId: string, isDraft: boolean) => {
      configuration?.setActiveThreadId(threadId, { explicit: !isDraft });
      if (isDraft) {
        setDraftThreadId(threadId);
      }
      setIsThreadsMenuOpen(false);
    },
    [configuration],
  );

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Show me an agent error",
        message: "Show me an agent error.",
      },
      {
        title: "Show me a chart",
        message:
          "Please write a linear regression in python, and then show me a chart breaking down the keywords you used.",
      },
      {
        title: "Ask for approval",
        message: "Ask for my approval before completing an action.",
      },
    ],
    available: "always",
  });

  useAgentContext({
    description: "The current Thread ID is:",
    value: configuration?.threadId ?? "stateless",
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

  useComponent({
    name: "showDemoChart",
    followUp: false,
    description:
      "Show a compact generative UI bar chart. Use it when the user asks to see a chart, demo generative UI, or render visual data.",
    parameters: z.object({
      title: z.string().describe("A short chart title"),
      bars: z
        .array(
          z.object({
            label: z.string().describe("A short bar label"),
            value: z.number().min(0).max(100).describe("A value from 0 to 100"),
          }),
        )
        .min(3)
        .max(4)
        .describe("Three or four chart bars"),
    }),
    render: DemoChart,
  });

  useHumanInTheLoop({
    name: "requestDemoApproval",
    followUp: false,
    description:
      "Ask for the user's approval before completing an action. Use it when the user asks for an approval or human-in-the-loop demo.",
    parameters: z.object({
      action: z.string().describe("The action that needs approval"),
    }),
    render: ({ args, result, respond, toolCallId }: any) => {
      const responseFromResult =
        typeof result === "object" && result !== null
          ? result.approved
          : undefined;
      const storageKey = `demo-approval:${toolCallId}`;
      const storedApproval =
        typeof window === "undefined"
          ? null
          : window.sessionStorage.getItem(storageKey);
      const hasStoredResponse = Object.hasOwn(approvalResponses, toolCallId);
      const approved = hasStoredResponse
        ? approvalResponses[toolCallId]
        : storedApproval === null
          ? responseFromResult
          : storedApproval === "true";
      const hasResponded = typeof approved === "boolean";
      const choose = (decision: boolean) => {
        setApprovalResponses((responses) => ({
          ...responses,
          [toolCallId]: decision,
        }));
        window.sessionStorage.setItem(storageKey, String(decision));
        respond?.({ approved: decision });
      };

      return (
        <div
          style={{
            padding: 14,
            border: "1px solid #d1d5db",
            borderRadius: 10,
            backgroundColor: hasResponded ? "#f9fafb" : "white",
          }}
        >
          <strong>
            {hasResponded
              ? `Decision: ${approved ? "approved" : "declined"}`
              : "Approve this action?"}
          </strong>
          <div style={{ marginTop: 4 }}>{args.action}</div>
          {hasResponded ? (
            <div style={{ marginTop: 12, color: "#4b5563", fontWeight: 600 }}>
              {approved
                ? "You approved this action."
                : "You declined this action."}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                disabled={!respond}
                onClick={() => choose(true)}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #111827",
                  borderRadius: 6,
                  backgroundColor: "#111827",
                  color: "white",
                  cursor: respond ? "pointer" : "not-allowed",
                  fontWeight: 600,
                }}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={!respond}
                onClick={() => choose(false)}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #6b7280",
                  borderRadius: 6,
                  backgroundColor: "white",
                  color: "#374151",
                  cursor: respond ? "pointer" : "not-allowed",
                  fontWeight: 600,
                }}
              >
                Decline
              </button>
            </div>
          )}
        </div>
      );
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
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setIsThreadsMenuOpen((open) => !open)}
            aria-label="Threads"
            aria-expanded={isThreadsMenuOpen}
            aria-haspopup="menu"
            title="Threads"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              padding: 0,
              borderRadius: "50%",
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.muted,
              color: colors.text,
              cursor: "pointer",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5a8.5 8.5 0 0 1 4.7-7.6A8.38 8.38 0 0 1 12.5 3h.5a8.48 8.48 0 0 1 8 8v.5z" />
              <path d="M12 8v6" />
              <path d="M9 11h6" />
            </svg>
          </button>
          {isThreadsMenuOpen && (
            <div
              role="menu"
              aria-label="Threads"
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                left: 0,
                zIndex: 10,
                minWidth: 220,
                padding: 8,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                backgroundColor: colors.bg,
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={startNewThread}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  backgroundColor: colors.muted,
                  color: colors.text,
                  fontWeight: 500,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                + New thread
              </button>
              <div
                style={{
                  margin: "12px 10px 6px",
                  color: colors.text,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  opacity: 0.65,
                  textTransform: "uppercase",
                }}
              >
                Past threads
              </div>
              {pastThreads.map(({ id, label, isDraft }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitem"
                  onClick={() => selectThread(id, isDraft)}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    border: 0,
                    borderRadius: 8,
                    backgroundColor:
                      id === configuration?.threadId
                        ? colors.muted
                        : "transparent",
                    color: colors.text,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CopilotChat
          className={theme === "dark" ? "dark" : undefined}
          input={{ toolsMenu }}
          welcomeScreen={
            hasInspectorPreview
              ? {
                  children: ({ input, suggestionView }) => (
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 16px",
                      }}
                    >
                      <div style={{ width: "100%", maxWidth: 768 }}>
                        <CopilotChatAssistantMessage
                          message={{
                            id: "local-inspector-preview",
                            role: "assistant",
                            content:
                              "This local preview lets you open the CopilotKit Inspector directly from an assistant response. Hover over the wrench icon below, then click it to inspect the current run.",
                          }}
                        />
                        <div style={{ marginTop: 32 }}>{input}</div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "center",
                            marginTop: 16,
                          }}
                        >
                          {suggestionView}
                        </div>
                      </div>
                    </div>
                  ),
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
