import type { AbstractAgent } from "@ag-ui/client";
import type {
  ConversationStore,
  AgentSession,
  ReplyTarget as BotReplyTarget,
} from "@copilotkit/bot";

/** In-memory, channel-keyed session store. History is read on demand (getMessages). */
export class DiscordConversationStore implements ConversationStore {
  private readonly sessions = new Map<string, AgentSession>();

  async getOrCreate(
    conversationKey: string,
    _replyTarget: BotReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(conversationKey);
    if (existing) return existing;
    const session: AgentSession = { agent: makeAgent(conversationKey) };
    this.sessions.set(conversationKey, session);
    return session;
  }
}
