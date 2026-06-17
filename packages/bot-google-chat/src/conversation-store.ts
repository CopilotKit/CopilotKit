import { randomUUID } from "node:crypto";
import type { HttpAgent } from "@ag-ui/client";
import type { ChatClient, ChatMessage } from "./chat-client.js";
import { isBotStatusOrPlaceholder } from "./status-markers.js";
import { DM_SCOPE } from "./types.js";
import type { ConversationKey, ReplyTarget } from "./types.js";

export interface AgentSession {
  threadId: string;
  agent: HttpAgent;
  replyTarget: ReplyTarget;
}

// Re-exported from the single source of truth in `status-markers.ts` so that
// existing importers (e.g. `adapter.ts`) keep working unchanged.
export { isBotStatusOrPlaceholder } from "./status-markers.js";

interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export class GoogleChatConversationStore {
  private readonly client: ChatClient;
  private readonly botUserId: string;

  constructor(args: { client: ChatClient; botUserId: string }) {
    this.client = args.client;
    this.botUserId = args.botUserId;
  }

  private newThreadId(k: ConversationKey): string {
    const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-");
    return `gchat-${k.spaceId}-${safe(k.scope)}-${randomUUID()}`;
  }

  async getOrCreate(
    key: ConversationKey,
    replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => HttpAgent,
  ): Promise<AgentSession> {
    const threadId = this.newThreadId(key);
    const agent = makeAgent(threadId);
    let history: AgentMessage[] = [];
    try {
      // Scope history to a single thread when this conversation IS a thread
      // (scope is the thread resource name); for a DM, list the whole space.
      const messages =
        key.scope !== DM_SCOPE
          ? await this.client.listMessages(key.spaceId, { threadName: key.scope })
          : await this.client.listMessages(key.spaceId);
      history = this.translate(messages);
    } catch (err) {
      console.warn("[bot-google-chat] failed to fetch conversation history for", key.spaceId, err);
      history = [];
    }
    (agent as unknown as { messages: AgentMessage[] }).messages = history;
    return { threadId, agent, replyTarget };
  }

  private translate(messages: ChatMessage[]): AgentMessage[] {
    const out: AgentMessage[] = [];
    for (const m of messages) {
      const isBot = m.sender?.type === "BOT" || m.sender?.name === this.botUserId;
      const text = (m.text ?? "").trim();
      if (!text) continue;
      // Skip the run-renderer's own status rows / stream placeholders so they
      // don't round-trip back into agent history (see isBotStatusOrPlaceholder).
      if (isBot && isBotStatusOrPlaceholder(text)) continue;
      const role: "user" | "assistant" = isBot ? "assistant" : "user";
      const tail = out[out.length - 1];
      if (tail && tail.role === role) {
        tail.content = `${tail.content}\n${text}`;
      } else {
        out.push({ id: m.name ?? "", role, content: text });
      }
    }
    return out;
  }
}
