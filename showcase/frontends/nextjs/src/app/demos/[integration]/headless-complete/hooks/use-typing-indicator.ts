// Decides whether to render the "agent is thinking" indicator below the
// last message. Show it while the agent is running AND the last message is
// the user's, or is an assistant message that has no text or tool calls
// yet. Once text or a tool call lands on the last assistant message, the
// message itself shows progress and the indicator is not needed.

import { useMemo } from "react";
import type { Message } from "@copilotkit/shared";

export function useTypingIndicator(
  messages: ReadonlyArray<Message>,
  isRunning: boolean,
) {
  return useMemo(() => {
    if (!isRunning) return false;
    const last = messages[messages.length - 1];
    if (!last) return true;
    if (last.role === "user") return true;
    if (last.role === "assistant") {
      const hasContent =
        typeof last.content === "string" && last.content.length > 0;
      const hasToolCalls = (last.toolCalls?.length ?? 0) > 0;
      return !hasContent && !hasToolCalls;
    }
    return false;
  }, [isRunning, messages]);
}
