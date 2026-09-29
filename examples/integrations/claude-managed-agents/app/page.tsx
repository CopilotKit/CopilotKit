"use client";

import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  CopilotThreadsDrawer,
  useAgent,
} from "@copilotkit/react-core/v2";

/** Keep the send control's accessible label in sync with the active run. */
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
    />
  );
}

/** The SDK drawer and chat share one uncontrolled thread configuration. */
export default function Home() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" enableInspector={false}>
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
