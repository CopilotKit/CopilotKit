"use client";

import type { CopilotChatAssistantMessage } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-core";
import { HashBrownRenderMessage } from "./hashbrown-renderer";
import { useByocHashbrownSuggestions } from "./suggestions";

export function Chat() {
  useByocHashbrownSuggestions();

  return (
    <CopilotChat
      className="h-full"
      messageView={{
        // The renderer reads only `message` from the slot props; cast to the
        // wider CopilotChatAssistantMessage signature to satisfy the slot type.
        assistantMessage:
          HashBrownRenderMessage as unknown as typeof CopilotChatAssistantMessage,
      }}
    />
  );
}
