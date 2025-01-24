/**
 * An internal context to separate the messages state (which is constantly changing) from the rest of CopilotKit context
 */

import { ReactNode, useEffect, useState } from "react";
import { CopilotMessagesContext } from "../../context/copilot-messages-context";
import { loadMessagesFromJsonRepresentation, Message } from "@copilotkit/runtime-client-gql";
import { CopilotKitProps } from "./copilotkit-props";
import { useCopilotContext } from "../../context/copilot-context";

export function CopilotMessages({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);

  const { threadId, agentSession, runtimeClient } = useCopilotContext();

  useEffect(() => {
    if (agentSession?.agentName) {
      // reload messages
      const fetchAgentState = async () => {
        const result = await runtimeClient.loadAgentState({
          threadId,
          agentName: agentSession.agentName,
        });
        if (result.data?.loadAgentState?.threadExists) {
          const messages = loadMessagesFromJsonRepresentation(
            JSON.parse(result.data?.loadAgentState?.messages || "[]"),
          );
          setMessages(messages);
        }
      };
      void fetchAgentState();
    }
  }, [threadId, agentSession?.agentName !== undefined]);

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
