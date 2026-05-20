"use client";

/**
 * Beautiful Chat (built-in-agent flavor) — a polished starter chat that
 * showcases CopilotChat dropped into a clean two-pane layout, with a side
 * canvas, theme variables, and pre-wired suggestions.
 *
 * The langgraph-python flagship version uses an extensive 4084 component tree
 * (A2UI catalog, todo canvas, declarative generative UI). This integration
 * keeps the same conceptual layout (chat on the right, content on the left)
 * but stays minimal — the built-in-agent runner is intentionally bare, and
 * this cell is the polished starter showcase.
 */

import React from "react";
import {
  CopilotKitProvider,
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

export default function BeautifulChatPage() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_420px] h-screen w-full bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-950 dark:to-indigo-950">
        <Canvas />
        <aside className="border-l border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur flex flex-col">
          <Suggestions />
          <CopilotChat
            agentId="default"
            className="flex-1"
            input={{ disclaimer: () => null, className: "pb-6" }}
          />
        </aside>
      </div>
    </CopilotKitProvider>
  );
}

function Canvas() {
  return (
    <main className="hidden md:flex flex-col p-12 overflow-y-auto">
      <header className="mb-8">
        <span className="inline-block rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200 px-3 py-1 text-xs font-semibold uppercase tracking-wider">
          Starter
        </span>
        <h1 className="mt-3 text-4xl font-bold text-slate-900 dark:text-slate-50">
          Beautiful Chat
        </h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400 max-w-prose">
          A polished starter layout: the built-in CopilotChat dropped onto a
          two-pane canvas, with suggestions pre-wired and the disclaimer slot
          customized away. Everything is theme-aware and responsive.
        </p>
      </header>
      <div className="grid grid-cols-2 gap-4 max-w-3xl">
        <Card title="In-process runner">
          The CopilotKit runtime runs inside the Next.js route handler — there
          is no separate agent server.
        </Card>
        <Card title="TanStack AI">
          Backend tools defined with <code>toolDefinition()</code> stream
          through the agent factory.
        </Card>
        <Card title="Tailwind theme">
          Colors come from the global CopilotKit CSS variables; flip the page to
          dark mode and the chat follows.
        </Card>
        <Card title="Drop-in primitives">
          <code>&lt;CopilotChat /&gt;</code> ships with messages, input,
          suggestions, and disclaimer slots out of the box.
        </Card>
      </div>
    </main>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
        {title}
      </h3>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
        {children}
      </p>
    </div>
  );
}

function Suggestions() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Say hi", message: "Say hi!" },
      {
        title: "Weather check",
        message: "What's the weather in San Francisco?",
      },
      { title: "Compose a haiku", message: "Write a haiku about coffee." },
    ],
    available: "always",
  });
  return null;
}
