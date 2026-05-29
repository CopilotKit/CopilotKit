// Decides whether to render the "agent is thinking" indicator below the
// last message. Show it when the agent is running AND the trailing
// message is the user's, OR is an assistant message that hasn't started
// streaming text or tool calls yet. Once any text or tool call lands on
// the last assistant message, the message itself shows progress and the
// indicator becomes redundant.

import { useMemo } from "react";
import type { Message } from "@copilotkit/shared";

export function useTypingIndicator(
  messages: ReadonlyArray<Message>,
  isRunning: boolean,
): boolean {
  return useMemo(() => {
    if (!isRunning) return false;
    const last = messages[messages.length - 1];
    if (!last) return true;
    if (last.role === "user") return true;
    if (last.role === "assistant") {
      const hasContent =
        typeof last.content === "string" && last.content.length > 0;
      const hasToolCalls =
        "toolCalls" in last &&
        Array.isArray(last.toolCalls) &&
        last.toolCalls.length > 0;
      return !hasContent && !hasToolCalls;
    }
    return false;
  }, [isRunning, messages]);
}
