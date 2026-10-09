"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CopilotKit,
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotThreadsDrawer,
  useCopilotChatConfiguration,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { HomePage } from "@/app/demos/beautiful-chat/home-page";
import { ThemeProvider } from "@/app/demos/beautiful-chat/hooks/use-theme";
import { demonstrationCatalog } from "@/app/demos/beautiful-chat/declarative-generative-ui/renderers";

function ThreadSelection() {
  const [id, setId] = useState("");
  const chat = useCopilotChatConfiguration();
  return (
    <div data-testid="thread-selection" data-active-thread-id={chat?.threadId}>
      <input
        aria-label="Thread ID"
        data-testid="open-thread-id"
        value={id}
        onChange={(event) => setId(event.target.value)}
      />
      <button
        data-testid="open-thread"
        onClick={() => chat?.setActiveThreadId(id, { explicit: true })}
      >
        Open thread
      </button>
    </div>
  );
}

function NativeChat() {
  useInterrupt({
    agentId: "beautiful-chat",
    renderInChat: true,
    render: ({ event, interrupt, resolve }) => {
      const raw =
        typeof event.value === "string" ? JSON.parse(event.value) : event.value;
      const payload = raw?.value ?? raw;
      const approval =
        payload?.requiresApproval ||
        payload?.type === "mastra_tool_approval" ||
        payload?.reason === "mastra:tool_approval" ||
        payload?.metadata?.mastra?.requiresApproval;
      return (
        <section
          data-testid="native-interrupt"
          data-interrupt-id={interrupt?.id}
        >
          <h2>Native approval</h2>
          <pre>{JSON.stringify(payload)}</pre>
          {approval && (
            <button onClick={() => resolve({ approved: true })}>
              Approve native time
            </button>
          )}
          {!approval &&
            payload?.slots?.map((slot: { iso: string; label: string }) => (
              <button
                key={slot.iso}
                onClick={() =>
                  resolve({ chosen_time: slot.iso, chosen_label: slot.label })
                }
              >
                {slot.label}
              </button>
            ))}
        </section>
      );
    },
  });
  return <CopilotChat agentId="beautiful-chat" />;
}

/** Test application shell; the rich UI is imported from one Showcase source. */
export default function RichThreadsPage() {
  const query = useSearchParams();
  const framework = query.get("framework");
  const mode = query.get("mode") ?? "rich";
  const nativeOnly = query.get("nativeOnly") === "true";
  if (!/^[a-z][a-z0-9-]+$/.test(mode)) return <p>Invalid scenario mode</p>;
  if (!framework || !["mastra", "strands-typescript"].includes(framework))
    return <p>Unsupported framework fixture</p>;
  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl={`/api/rich-threads/${nativeOnly ? "source/" : ""}${framework}/${mode}`}
        agent="beautiful-chat"
        a2ui={{ catalog: demonstrationCatalog }}
        openGenerativeUI={{}}
      >
        <CopilotChatConfigurationProvider
          agentId="beautiful-chat"
          threadId={query.get("threadId") ?? undefined}
        >
          <ThreadSelection />
          <div className="flex h-screen">
            {!nativeOnly && (
              <aside className="w-64 shrink-0">
                <CopilotThreadsDrawer agentId="beautiful-chat" />
              </aside>
            )}
            <main className="min-w-0 flex-1">
              {mode.startsWith("native") ? <NativeChat /> : <HomePage />}
            </main>
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKit>
    </ThemeProvider>
  );
}
