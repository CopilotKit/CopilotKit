import { randomUUID } from "node:crypto";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  AgentSession,
  ConversationStore,
} from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { HistoryStore, StoredMessage } from "./history-store.js";
import type { ReplyTarget } from "./types.js";
import { conversationKeyOf } from "./types.js";

interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: StoredMessage["content"];
}

/**
 * Adapter-owned conversation store. Each turn gets a fresh agent thread id and
 * the conversation's transcript, replayed from the {@link HistoryStore}. A
 * fresh thread id keeps stateless agent backends from desyncing on their own
 * accumulated tool messages (the same approach as the WhatsApp adapter).
 */
export class GoogleChatConversationStore implements ConversationStore {
  readonly seedsInboundTurn = true;

  constructor(private readonly historyStore: HistoryStore) {}

  async getOrCreate(
    conversationKey: string,
    _replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    const safe = conversationKey.replace(/[^A-Za-z0-9]+/g, "-");
    const agent = makeAgent(`gchat-${safe}-${randomUUID()}`);
    const history = await this.historyStore.read(conversationKey);
    const messages: AgentMessage[] = history.map((m, i) => ({
      id: m.id ?? `${m.ts}-${i}`,
      role: m.role,
      content: m.content,
    }));
    (agent as unknown as { messages: AgentMessage[] }).messages = messages;
    return { agent };
  }

  /** Back `Thread.getMessages()` from the stored transcript. */
  async getMessages(target: ReplyTarget): Promise<ThreadMessage[]> {
    const history = await this.historyStore.read(
      conversationKeyOf(target.space, target.thread),
    );
    return history.map((m) => ({
      text: typeof m.content === "string" ? m.content : "[attachment]",
      isBot: m.role === "assistant",
      ts: m.ts,
    }));
  }
}
