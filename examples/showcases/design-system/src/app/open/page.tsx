"use client";

import { useState } from "react";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { SiteNav } from "@/components/SiteNav";
import { ChromePanel, Try } from "@/app/controlled/page";

type Variant = "open-gen-ui" | "mcp-apps";

const VARIANTS: { id: Variant; label: string; title: string }[] = [
  { id: "open-gen-ui", label: "Open Gen UI", title: "Open Gen UI" },
  { id: "mcp-apps", label: "MCP Apps", title: "MCP Apps" },
];

export default function OpenPage() {
  const [active, setActive] = useState<Variant>("open-gen-ui");
  const current = VARIANTS.find((v) => v.id === active)!;

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav />

      <section className="border-b border-[var(--line)]">
        <div className="max-w-[1480px] mx-auto px-5 py-3.5 flex items-center justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-semibold tracking-tight text-[var(--ink)]">
              {current.title}
            </h1>
            <p className="text-[12.5px] text-[var(--ink-2)] mt-0.5 max-w-[680px] leading-snug">
              {active === "open-gen-ui"
                ? "The agent writes HTML, CSS, and a bit of JavaScript on the fly. Your app runs it inside a sandboxed iframe so it can't touch the rest of the page."
                : "An external MCP server (Excalidraw here) exposes tools that come with their own UI. The agent calls a tool, the server's UI shows up in the chat. You write no frontend code for it."}
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Open-ended variant"
            className="inline-flex p-1 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)]"
          >
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={v.id === active}
                onClick={() => setActive(v.id)}
                className={`px-3 py-1.5 text-[12.5px] font-medium rounded-[calc(var(--radius)-4px)] transition ${
                  v.id === active
                    ? "bg-[var(--surface-soft)] text-[var(--ink)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main className="flex-1 max-w-[1480px] mx-auto px-5 py-5 w-full min-h-0">
        <div className="h-full min-h-0 max-w-[920px] mx-auto">
          {active === "open-gen-ui" ? <OpenGenUiChat /> : <McpAppsChat />}
        </div>
      </main>
    </div>
  );
}

function OpenGenUiChat() {
  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      { title: "Build a calculator", message: "Build a calculator", isLoading: false },
      {
        title: "Sketch a pricing table",
        message: "Sketch a pricing table",
        isLoading: false,
      },
      {
        title: "Show me a bar chart of sales",
        message: "Show me a bar chart of sales data",
        isLoading: false,
      },
    ],
  });

  return (
    <ChromePanel
      caption="Open Gen UI · sandboxed iframe"
      hint={
        <>
          Try <Try>build a calculator</Try>
        </>
      }
    >
      <div className="h-full flex flex-col copilot-chat-wrapper">
        <CopilotChat
          agentId="open"
          labels={{
            chatInputPlaceholder: "Try: build a calculator",
            welcomeMessageText: "How can I help?",
          }}
        />
      </div>
    </ChromePanel>
  );
}

function McpAppsChat() {
  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      {
        title: "Sketch a flowchart",
        message: "Sketch a small flowchart for me",
        isLoading: false,
      },
      {
        title: "Draw three boxes",
        message: "Draw three connected boxes labeled A, B, C",
        isLoading: false,
      },
      {
        title: "What tools do you have?",
        message: "What tools do you have available?",
        isLoading: false,
      },
    ],
  });

  return (
    <ChromePanel
      caption="MCP Apps · Excalidraw server"
      hint={
        <>
          Try <Try>sketch a flowchart</Try>
        </>
      }
    >
      <div className="h-full flex flex-col copilot-chat-wrapper">
        <CopilotChat
          agentId="mcpapps"
          labels={{
            chatInputPlaceholder: "Try: sketch a flowchart",
            welcomeMessageText: "How can I help?",
          }}
        />
      </div>
    </ChromePanel>
  );
}
