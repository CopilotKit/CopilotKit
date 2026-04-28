// Docs-only snippet — not imported or rendered. google-adk's
// agentic-chat-reasoning production demo uses default reasoning rendering
// (see page.tsx); the ReasoningBlock component file exists in the demo
// folder but isn't wired into the messageView slot. The docs page teaches
// the custom reasoning slot pattern, which is framework-agnostic. This
// file gives the reasoning-block-render region a real teaching example
// without changing the production demo's runtime behavior. See
// chat-component.snippet.tsx in agentic-chat for the same sibling-file
// pattern.

import {
  CopilotChat,
  CopilotChatReasoningMessage,
} from "@copilotkit/react-core/v2";
import { ReasoningBlock } from "./reasoning-block";

export function ReasoningChat() {
  // @region[reasoning-block-render]
  return (
    <CopilotChat
      agentId="agentic_chat_reasoning"
      className="h-full rounded-2xl"
      messageView={{
        reasoningMessage: ReasoningBlock as typeof CopilotChatReasoningMessage,
      }}
    />
  );
  // @endregion[reasoning-block-render]
}
