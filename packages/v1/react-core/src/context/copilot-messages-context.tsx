/**
 * An internal context to separate the messages state (which is constantly changing) from the rest of CopilotKit context
 */

import { Message } from "@copilotkit/runtime-client-gql";
import React from "react";
import { Suggestion } from "@copilotkitnext/core";

export interface CopilotMessagesContextParams {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>; // suggestions state
  suggestions: Suggestion[];
  setSuggestions: React.Dispatch<React.SetStateAction<Suggestion[]>>;
}

const emptyCopilotContext: CopilotMessagesContextParams = {
  messages: [],
  setMessages: () => [],
  // suggestions state
  suggestions: [],
  setSuggestions: () => [],
};

export const CopilotMessagesContext =
  React.createContext<CopilotMessagesContextParams>(emptyCopilotContext);

export function useCopilotMessagesContext(): CopilotMessagesContextParams {
  const context = React.useContext(CopilotMessagesContext);
  if (context === emptyCopilotContext) {
    throw new Error(
      "A messages consuming component was not wrapped with `<CopilotMessages> {...} </CopilotMessages>`",
    );
  }
  return context;
}
