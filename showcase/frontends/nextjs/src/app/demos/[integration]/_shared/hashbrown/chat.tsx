"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import type { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import { makeSlotOverride } from "../slot-override";
import { HashBrownRenderMessage } from "./hashbrown-renderer";
import { useHashbrownSuggestions } from "./suggestions";

// The renderer reads only `message` from the slot props.
const assistantMessage = makeSlotOverride<typeof CopilotChatAssistantMessage>(
  HashBrownRenderMessage,
);

export function Chat() {
  useHashbrownSuggestions();

  return <CopilotChat className="h-full" messageView={{ assistantMessage }} />;
}
