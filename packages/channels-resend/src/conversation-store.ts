import type { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import type {
  AgentSession,
  ConversationStore,
} from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { ResendThreadStore } from "./thread-store.js";
import type { ResendReplyTarget } from "./types.js";

/**
 * Conversation store for email threads.
 *
 * Email has no history API, so the adapter keeps the text of each received
 * email and each reply in its thread store. Each run gets that history plus
 * the email being answered (with its attachments as content parts).
 */
export class ResendConversationStore implements ConversationStore {
  /** The email being answered is in the messages the agent gets. */
  readonly seedsInboundTurn = true;

  constructor(private readonly threads: ResendThreadStore) {}

  async getOrCreate(
    conversationKey: string,
    replyTarget: unknown,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    const target = replyTarget as ResendReplyTarget;
    const agent = makeAgent(conversationKey);
    const inboundId = target.inbound?.id;
    const history = await this.threads.history(conversationKey);
    const messages: Message[] = history
      .filter((entry) => entry.id !== inboundId)
      .map((entry) => ({
        id: `${entry.role}-${entry.id}`,
        role: entry.role,
        content: entry.text,
      }));
    if (target.inbound) {
      messages.push({
        id: `user-${target.inbound.id}`,
        role: "user",
        // AG-UI types `content` as a string, but multimodal parts work at runtime.
        content: target.inbound.content as unknown as string,
      });
    }
    agent.setMessages(messages);
    return { agent };
  }

  /** Back `Thread.getMessages()` with the stored history. */
  async getMessages(target: ResendReplyTarget): Promise<ThreadMessage[]> {
    const history = await this.threads.history(target.conversationKey);
    return history.map((entry) => ({
      text: entry.text,
      isBot: entry.role === "assistant",
      ts: String(entry.ts),
    }));
  }
}
