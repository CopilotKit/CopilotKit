"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core/v2";

export default function BeautifulChatDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="beautiful_chat">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Sales pulse", message: "Show me Q3 revenue split by region." },
      { title: "Find flights", message: "Find flights from SFO to JFK next Friday." },
      { title: "Book a sync", message: "Book me a 30-minute sync with our designer." },
    ],
    available: "always",
  });

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-[#fef9f3] via-[#f6efff] to-[#e9f3ff]">
      <header className="px-8 pt-10 pb-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Beautiful chat — Google ADK
        </div>
        <h1 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight bg-gradient-to-r from-[#1e1b4b] via-[#5b21b6] to-[#1d4ed8] bg-clip-text text-transparent">
          Sales copilot, polished by default
        </h1>
        <p className="mt-2 text-slate-600 max-w-2xl">
          Brand fonts, theme tokens, suggestion pills, and live charts —
          delivered by a Gemini 2.5 Flash agent with the canonical sales-pipeline
          tools wired up on the backend.
        </p>
      </header>
      <main className="max-w-5xl mx-auto px-8 pb-12">
        <div className="rounded-3xl bg-white/70 backdrop-blur-sm border border-white/80 shadow-xl shadow-slate-200/40 overflow-hidden h-[600px]">
          <CopilotChat
            agentId="beautiful_chat"
            className="h-full"
            labels={{ chatInputPlaceholder: "Ask the sales copilot..." }}
          />
        </div>
      </main>
    </div>
  );
}
