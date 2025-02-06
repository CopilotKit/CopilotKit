/**
 * An internal context to separate the messages state (which is constantly changing) from the rest of CopilotKit context
 */

import { ReactNode, useEffect, useState, useRef } from "react";
import { CopilotMessagesContext } from "../../context/copilot-messages-context";
import { loadMessagesFromJsonRepresentation, Message } from "@copilotkit/runtime-client-gql";
import { useCopilotContext } from "../../context/copilot-context";

export function CopilotMessages({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const lastLoadedThreadId = useRef<string>();
  const lastLoadedAgentName = useRef<string>();
  const lastLoadedMessages = useRef<string>();

  const { threadId, agentSession, runtimeClient } = useCopilotContext();

  useEffect(() => {
    if (!threadId || threadId === lastLoadedThreadId.current) return;
    if (
      threadId === lastLoadedThreadId.current &&
      agentSession?.agentName === lastLoadedAgentName.current
    ) {
      return;
    }

    const fetchMessages = async () => {
      if (!agentSession?.agentName) return;

      const result = await runtimeClient.loadAgentState({
        threadId,
        agentName: agentSession?.agentName,
      });

      const newMessages = result.data?.loadAgentState?.messages;
      if (newMessages === lastLoadedMessages.current) return;

      if (result.data?.loadAgentState?.threadExists) {
        lastLoadedMessages.current = newMessages;
        lastLoadedThreadId.current = threadId;
        lastLoadedAgentName.current = agentSession?.agentName;

        const messages = loadMessagesFromJsonRepresentation(JSON.parse(newMessages || "[]"));
        setMessages(messages);
      }
    };
    void fetchMessages();
  }, [threadId, agentSession?.agentName]);

  return (
    <CopilotMessagesContext.Provider
      value={{
        messages,
        setMessages,
      }}
    >
      {children}
    </CopilotMessagesContext.Provider>
  );
}
