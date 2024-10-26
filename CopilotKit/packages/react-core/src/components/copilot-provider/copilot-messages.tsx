/**
 * An internal context to separate the messages state (which is constantly changing) from the rest of CopilotKit context
 */

import { useState } from "react";
import { CopilotMessagesContext } from "../../context/copilot-messages-context";
import { Message } from "@copilotkit/runtime-client-gql";
import { CopilotKitProps } from "./copilotkit-props";

export function CopilotMessages({ children, ...props }: CopilotKitProps) {
  const [messages, setMessages] = useState<Message[]>([]);

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
