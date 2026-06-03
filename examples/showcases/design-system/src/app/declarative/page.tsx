"use client";

import { useEffect, useState } from "react";
import {
  CopilotChat,
  useAgent,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { SiteNav } from "@/components/SiteNav";
import { SurfaceCanvas } from "@/a2ui/SurfaceCanvas";
import {
  ChromePanel,
  EmptyState,
  PageHeader,
  Try,
} from "@/app/controlled/page";

type Mode = "in-chat" | "split";

function MessagesDebug() {
  const { agent } = useAgent({ agentId: "declarative" });
  useEffect(() => {
    if (!agent) return;
    console.log(
      "[declarative] agent.messages count=",
      agent.messages.length,
      "roles=",
      agent.messages.map((m) => m.role).join(","),
    );
    for (const m of agent.messages) {
      if (m.role === "activity") {
        console.log(
          "[declarative] ACTIVITY msg",
          "id=",
          m.id,
          "type=",
          (m as { activityType?: string }).activityType,
          "content keys=",
          Object.keys(
            (m as { content?: Record<string, unknown> }).content ?? {},
          ),
          "raw=",
          m,
        );
      }
    }
  }, [agent, agent?.messages]);
  return null;
}

export default function DeclarativePage() {
  const [mode, setMode] = useState<Mode>("in-chat");

  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      {
        title: "Compare AAPL, NVDA, and TSLA",
        message: "Compare AAPL, NVDA, and TSLA",
        isLoading: false,
      },
      { title: "Show me MSFT", message: "Show me MSFT", isLoading: false },
      {
        title: "Tech megacap dashboard",
        message: "Tech megacap dashboard",
        isLoading: false,
      },
    ],
  });

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)]">
      <SiteNav />
      <MessagesDebug />

      <PageHeader
        title="Agent emits a schema, your app renders it"
        subtitle="The agent returns a small JSON describing a layout. Your app reads it and renders your components — no extra code per layout."
        mode={mode}
        onMode={setMode}
      />

      <main className="flex-1 max-w-[1480px] mx-auto px-5 py-5 w-full min-h-0">
        {mode === "in-chat" ? <SingleChat /> : <SplitView />}
      </main>
    </div>
  );
}

function SingleChat() {
  return (
    <div className="h-full min-h-0 max-w-[860px] mx-auto">
      <ChromePanel
        caption="Chat"
        hint={
          <>
            Try <Try>compare AAPL, NVDA, and TSLA</Try>
          </>
        }
      >
        <CopilotChat
          agentId="declarative"
          labels={{
            chatInputPlaceholder: "Try: compare AAPL, NVDA, and TSLA",
            welcomeMessageText: "How can I help?",
          }}
        />
      </ChromePanel>
    </div>
  );
}

function SplitView() {
  return (
    <div className="grid lg:grid-cols-[420px_1fr] gap-4 h-full min-h-0">
      <ChromePanel
        caption="Chat"
        hint={
          <>
            Try <Try>show me MSFT</Try>
          </>
        }
      >
        <CopilotChat
          agentId="declarative"
          labels={{
            chatInputPlaceholder: "Try: compare AAPL, NVDA, and TSLA",
            welcomeMessageText: "How can I help?",
          }}
        />
      </ChromePanel>

      <ChromePanel
        caption="Side panel"
        hint="The same layout, rendered at full width next to the chat."
      >
        <SurfaceCanvas
          channel="declarative"
          emptyState={
            <EmptyState
              title="Side panel is empty"
              body="Ask the agent to compare a few stocks. The dashboard appears here at full size."
            />
          }
        />
      </ChromePanel>
    </div>
  );
}
