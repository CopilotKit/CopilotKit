import type { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import { contentToText } from "@ag-ui/core";
import type {
  AgentSession,
  ConversationStore,
} from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { WebReplyTarget } from "./types.js";

/**
 * Conversation store backed by the history the client sends.
 *
 * An AG-UI client sends the whole conversation (`messages`) with every run
 * request, including the new user message. The store gives the agent a copy
 * of that history, so the adapter keeps no transcript on the server.
 */
export class WebConversationStore implements ConversationStore {
  /** The client history already holds the new user message. */
  readonly seedsInboundTurn = true;

  async getOrCreate(
    conversationKey: string,
    replyTarget: unknown,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    const agent = makeAgent(conversationKey);
    agent.setMessages(
      structuredClone((replyTarget as WebReplyTarget).messages ?? []),
    );
    return { agent };
  }

  /** Back `Thread.getMessages()` with the client history. */
  getMessages(target: WebReplyTarget): ThreadMessage[] {
    return target.messages.flatMap((message: Message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text = contentToText(message.content as never);
      return [
        {
          text,
          content: message.content,
          isBot: message.role === "assistant",
          messageRef: { id: message.id, threadId: target.threadId },
        },
      ];
    });
  }
}
