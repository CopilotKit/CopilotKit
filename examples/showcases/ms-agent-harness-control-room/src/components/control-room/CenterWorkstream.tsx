"use client";

/**
 * Center column: the conversational chat with the Control Room agent.
 *
 * As of Task 6, primitive renderers (shell output, file reads, diff
 * proposals, approval cards, generated results, observer snapshots) are
 * registered globally by `<ToolRendererRegistry />` (mounted inside
 * `<CopilotKit>` in `ControlRoomApp`). The chat surface itself renders each
 * tool call inline as it streams, so the dashed "Task 6 mounting slot" cards
 * that previously lived here are gone.
 */

import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { CONTROL_ROOM_AGENT_NAME } from "@/hooks/use-control-room-state";

function HiddenCopyButton() {
  return null;
}

const chatMessageView = {
  assistantMessage: {
    copyButton: HiddenCopyButton,
  },
  userMessage: {
    copyButton: HiddenCopyButton,
  },
};

export function CenterWorkstream() {
  // v2's suggestion engine: registers a "static" suggestion the agent surfaces
  // as a starter pill in the chat input. The cockpit only ships one — fix the
  // seeded failing test — but the registry can take any number.
  useConfigureSuggestions({
    instructions: "Fix the seeded failing test in the fixture repo.",
    minSuggestions: 1,
    maxSuggestions: 1,
    consumerAgentId: CONTROL_ROOM_AGENT_NAME,
  });

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <CopilotChat
        agentId={CONTROL_ROOM_AGENT_NAME}
        className="h-full w-full"
        messageView={chatMessageView}
        labels={{
          modalHeaderTitle: "Control Room",
        }}
      />
    </div>
  );
}
