"use client";

import Image from "next/image";
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  useAgent,
  useThreads,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";

/** Chat-only version of the LangGraph starter's Beautiful Chat layout. */
function Chat() {
  const { agent } = useAgent({ agentId: "default" });
  return (
    <CopilotChat
      agentId="default"
      input={{
        disclaimer: () => null,
        sendButton: {
          "aria-label": agent.isRunning ? "Stop response" : "Send message",
        },
        addMenuButton: { "aria-label": "Add attachment" },
      }}
      labels={{
        welcomeMessageText: "How can I help you?",
        chatInputPlaceholder: "Message Claude…",
      }}
    />
  );
}

/** Use the same new-thread actions as the SDK's thread drawer. */
function Workspace() {
  const { agent } = useAgent({ agentId: "default" });
  const { startNewThread } = useThreads({ agentId: "default", enabled: false });
  const configuration = useCopilotChatConfiguration();
  return (
    <div className="shell">
      <header className="header">
        <Image
          src="/copilotkit.svg"
          alt="CopilotKit"
          width={146}
          height={28}
          priority
        />
        <button
          type="button"
          className="new-chat"
          disabled={agent.isRunning}
          onClick={() => {
            startNewThread();
            configuration?.startNewThread();
          }}
        >
          New chat
        </button>
      </header>
      <main className="chat" aria-label="Conversation">
        <Chat />
      </main>
    </div>
  );
}

/** A minimal starting point: branded header, new conversation, and SDK chat. */
export default function Home() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" enableInspector={false}>
      <CopilotChatConfigurationProvider agentId="default">
        <Workspace />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
}
