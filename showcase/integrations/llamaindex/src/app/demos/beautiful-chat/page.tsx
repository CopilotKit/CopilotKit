"use client";

/**
 * Beautiful Chat — a polished CopilotChat starter surface for the
 * LlamaIndex showcase.
 *
 * This is a simplified port of the LangGraph "Beautiful Chat" demo. The
 * canonical version (langgraph-python/src/app/demos/beautiful-chat/) bundles
 * a full design-system clone of the landing-page starter — layout shell,
 * canvas, generative-ui charts, and a hooks tree. That breadth lives outside
 * the parity scope here; the goal of this cell is "pretty agentic chat
 * starter you can copy into a new project," which the slim layout below
 * already delivers.
 *
 * Backend: src/agents/beautiful_chat_agent.py mounted at /beautiful-chat on
 * the agent_server, routed through the shared /api/copilotkit endpoint.
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function BeautifulChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="beautiful-chat">
      <PageShell />
    </CopilotKit>
  );
}

function PageShell() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in San Francisco",
        message: "What's the weather like in San Francisco today?",
      },
      {
        title: "Quick haiku",
        message: "Write me a short haiku about building with AI agents.",
      },
      {
        title: "Pep talk",
        message: "Give me a one-sentence pep talk before I ship a new feature.",
      },
    ],
    available: "always",
  });

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background:
          "linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #faf5ff 100%)",
      }}
    >
      <div className="mx-auto flex h-screen w-full max-w-5xl flex-col gap-6 p-6 md:p-10">
        <header className="flex flex-col gap-1">
          <span
            className="text-xs font-semibold uppercase tracking-[0.18em]"
            style={{ color: "#6366f1" }}
          >
            CopilotKit · LlamaIndex
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
            Beautiful Chat
          </h1>
          <p className="max-w-xl text-sm text-slate-600 md:text-base">
            A polished agentic-chat starter — brand-tinted background,
            suggestion pills, and a clean rounded chat surface. Use it as a
            template for your own LlamaIndex-powered copilot.
          </p>
        </header>

        <div
          className="flex-1 overflow-hidden rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur"
          style={{ boxShadow: "0 30px 80px -40px rgba(99,102,241,0.35)" }}
        >
          <CopilotChat
            agentId="beautiful-chat"
            className="h-full"
            input={{ disclaimer: () => null, className: "pb-6" }}
          />
        </div>
      </div>
    </div>
  );
}
