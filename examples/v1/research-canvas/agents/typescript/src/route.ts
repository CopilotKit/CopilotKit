import { isAIMessage, isToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

interface RouteState {
  messages?: readonly BaseMessage[];
}

export function getNextNode(state: RouteState) {
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];

  if (lastMessage && isAIMessage(lastMessage)) {
    const toolCall = lastMessage.tool_calls?.[0];

    if (toolCall?.name === "Search") {
      return "search_node";
    } else if (toolCall?.name === "DeleteResources") {
      return "delete_node";
    }
  }

  if (lastMessage && isToolMessage(lastMessage)) {
    return "chat_node";
  }

  return undefined;
}
