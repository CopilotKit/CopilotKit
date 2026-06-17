import { randomUUID } from "node:crypto";
import type { HttpAgent } from "@ag-ui/client";
import type { ChatClient, ChatMessage } from "./chat-client.js";
import type { ConversationKey, ReplyTarget } from "./types.js";

export interface AgentSession {
  threadId: string;
  agent: HttpAgent;
  replyTarget: ReplyTarget;
}

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
      history = this.translate(await this.client.listMessages(key.spaceId));
    } catch {
      history = [];
    }
    (agent as unknown as { messages: AgentMessage[] }).messages = history;
    return { threadId, agent, replyTarget };
  }

  private translate(messages: ChatMessage[]): AgentMessage[] {
    /**
     * Skip bot messages that are run-renderer status rows or stream
     * placeholders — they must not round-trip back into agent history.
     *
     * Markers emitted by event-renderer.ts / chunked-message-stream.ts:
     *   🔧 `<tool>`…   — tool-call start row (onToolCallStartEvent)
     *   ✅ `<tool>`    — tool-call end row (onToolCallEndEvent)
     *   _thinking…_    — ChunkedMessageStream first-chunk placeholder
     *   _…(continued)_ — ChunkedMessageStream continuation placeholder
     */
    const isStatusOrPlaceholder = (text: string): boolean =>
      text.startsWith("🔧 ") ||
      text.startsWith("✅ ") ||
      text === "_thinking…_" ||
      text === "_…(continued)_";

    const out: AgentMessage[] = [];
    for (const m of messages) {
      const isBot = m.sender?.type === "BOT" || m.sender?.name === this.botUserId;
      const text = (m.text ?? "").trim();
      if (!text) continue;
      if (isBot && isStatusOrPlaceholder(text)) continue;
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
