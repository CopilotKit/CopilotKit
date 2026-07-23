import { randomUUID } from "node:crypto";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  AgentSession,
  ConversationStore,
} from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { HistoryStore, StoredMessage } from "./history-store.js";
import type { ReplyTarget } from "./types.js";
import { conversationKeyOf, waIdFromKey } from "./interaction.js";

interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: StoredMessage["content"];
}

/**
 * Adapter-owned conversation store. WhatsApp has no readable history, so we
 * rebuild each turn from a pluggable `HistoryStore` and set the agent's
 * `messages` from it. A fresh threadId per turn keeps stateless/agent-backend
 * runs from desyncing on accumulated internal (tool) messages — same approach
 * as `bot-slack`.
 */
export class WhatsAppConversationStore implements ConversationStore {
  private readonly historyStore: HistoryStore;

  constructor(args: { historyStore: HistoryStore }) {
    this.historyStore = args.historyStore;
  }

  private newThreadId(conversationKey: string): string {
    const waId = waIdFromKey(conversationKey);
    return `whatsapp-${waId}-${randomUUID()}`;
  }

  async getOrCreate(
    conversationKey: string,
    _replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    const threadId = this.newThreadId(conversationKey);
    const agent = makeAgent(threadId);
    const history = await this.historyStore.read(conversationKey);
    const messages: AgentMessage[] = history.map((m, i) => ({
      id: `${m.ts}-${i}`,
      role: m.role,
      content: m.content,
    }));
    (agent as unknown as { messages: AgentMessage[] }).messages = messages;
    return { agent, threadId } as AgentSession & { threadId: string };
  }

  /** Back `Thread.getMessages()` from stored history. */
  async getMessages(replyTarget: ReplyTarget): Promise<ThreadMessage[]> {
    const key = conversationKeyOf(replyTarget.to);
    const history = await this.historyStore.read(key);
    return history.map((m) => ({
      text: typeof m.content === "string" ? m.content : "[media]",
      isBot: m.role === "assistant",
      ts: m.ts,
    }));
  }
}
