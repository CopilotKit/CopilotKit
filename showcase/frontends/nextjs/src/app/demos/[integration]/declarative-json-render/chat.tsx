"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import type { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import { makeSlotOverride } from "../_shared/slot-override";
import { JsonRenderAssistantMessage } from "./json-render-renderer";
import { useJsonRenderSuggestions } from "./suggestions";

export const AGENT_ID = "byoc_json_render";

const assistantMessage = makeSlotOverride<typeof CopilotChatAssistantMessage>(
  JsonRenderAssistantMessage,
);

export function Chat() {
  useJsonRenderSuggestions();

  return (
    <CopilotChat
      agentId={AGENT_ID}
      className="h-full rounded-2xl"
      messageView={{ assistantMessage }}
    />
  );
}
