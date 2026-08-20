/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — CopilotMessagesContext:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CopilotMessagesContextParams:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — useCopilotMessagesContext:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

/**
 * An internal context to separate the messages state (which is constantly changing) from the rest of CopilotKit context
 */

import { Message } from "@copilotkit/runtime-client-gql";
import React from "react";
import { Suggestion } from "@copilotkit/core";

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
