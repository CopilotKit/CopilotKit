"use client";

import { useState } from "react";
import "@copilotkit/react-core/v2/styles.css";
import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import { useThreadStore } from "@/lib/threads";
import { ThreadSidebar } from "@/components/ThreadSidebar";
import { ConciergeTools } from "@/components/ConciergeTools";
import { ErrorNotice } from "@/components/ErrorNotice";
import { ThreadTitler } from "@/components/ThreadTitler";

export default function Home() {
  const {
    ready,
    threads,
    activeThreadId,
    newThread,
    selectThread,
    renameThread,
  } = useThreadStore();
  const [collapsed, setCollapsed] = useState(false);
  const activeTitle = threads.find((t) => t.id === activeThreadId)?.title ?? "";

  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <div className="flex h-screen bg-gray-50">
        <ThreadSidebar
          threads={threads}
          activeThreadId={activeThreadId}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          onNewThread={newThread}
          onSelectThread={selectThread}
        />

        <main className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="border-b border-gray-200 bg-white px-6 py-3 shrink-0">
            <h1 className="text-lg font-semibold text-gray-900 leading-tight">
              Travel Concierge · Oracle Agent Spec × Memory
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Ask about destinations, get personalized recommendations, and let
              the agent remember your preferences across sessions.{" "}
              <span className="text-gray-400">
                Tip: start a New thread to test cross-session memory.
              </span>
            </p>
          </header>

          {/* Tool renderers — mount once, render inline in the chat stream */}
          <ConciergeTools />

          {/* Surfaces run errors the chat UI would otherwise swallow */}
          <ErrorNotice />

          {/* Names a thread after its first user message */}
          <ThreadTitler
            activeThreadId={activeThreadId}
            activeTitle={activeTitle}
            onTitle={renameThread}
          />

          {/* Chat region */}
          <div className="flex-1 min-h-0">
            {ready && activeThreadId ? (
              <CopilotChat
                agentId="oracle_concierge"
                threadId={activeThreadId}
                key={activeThreadId}
                className="h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-gray-400">Loading…</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </CopilotKitProvider>
  );
}
