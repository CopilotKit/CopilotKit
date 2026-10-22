"use client";

import { useEffect } from "react";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  CopilotThreadsDrawer,
  useAgent,
  useConfigureSuggestions,
  useDefaultRenderTool,
  useInterrupt,
} from "@copilotkit/react-core/v2";
import { Interactions } from "./interactions";

/** Files Omnara accepts, up to its 10 MiB per-file limit. */
const attachments = {
  enabled: true,
  accept:
    "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv",
  maxSize: 10 * 1024 * 1024,
  // The chat drops a rejected file without a message, so say why.
  onUploadFailed: ({ message }: { message: string }) => window.alert(message),
};

/**
 * The chat with tool cards, Omnara approval and question cards, suggestions,
 * and a send control whose accessible label follows the active run.
 */
function Chat() {
  const { agent } = useAgent({ agentId: "default" });
  // Show the agent's web searches and fetches while they run.
  useDefaultRenderTool();
  useInterrupt({ render: (props) => <Interactions {...props} /> });
  // A failed resume removes the cards but leaves their interrupts pending,
  // which blocks every later message. Omnara keeps them open, so drop them
  // and the next message brings the cards back.
  useEffect(() => {
    const clear = () => {
      agent.pendingInterrupts = [];
    };
    const { unsubscribe } = agent.subscribe({
      onRunFailed: clear,
      onRunErrorEvent: clear,
    });
    return unsubscribe;
  }, [agent]);
  // Static suggestions: generated ones would each launch an Omnara agent.
  useConfigureSuggestions({
    available: "always",
    suggestions: [
      {
        title: "Search the web",
        message: "What's the biggest AI news this week? Cite your sources.",
      },
      {
        title: "Read a page",
        message:
          "Summarize https://docs.ag-ui.com/introduction in three bullets.",
      },
      {
        title: "Help me decide",
        message:
          "Ask me two multiple-choice questions, then suggest a weekend project.",
      },
    ],
  });
  return (
    <CopilotChat
      agentId="default"
      attachments={attachments}
      input={{
        disclaimer: () => null,
        sendButton: {
          "aria-label": agent.isRunning ? "Stop response" : "Send message",
        },
        addMenuButton: { "aria-label": "Add attachment" },
      }}
    />
  );
}

/** The SDK drawer and chat share one uncontrolled thread configuration. */
export default function Home() {
  return (
    // Force REST transport so runtime-info + threads both hit the multi-route endpoint (auto-detect races the lazily-compiled API route in next dev).
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      <CopilotChatConfigurationProvider agentId="default">
        <div className="shell">
          <CopilotThreadsDrawer agentId="default" />
          <main className="chat" aria-label="Conversation">
            <Chat />
          </main>
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}
