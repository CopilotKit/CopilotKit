import type { AbstractAgent } from "@ag-ui/client";
import type {
  ConversationStore,
  AgentSession,
  ReplyTarget as BotReplyTarget,
} from "@copilotkit/channels";
import { buildFileContentParts } from "./download-files.js";
import type {
  AgentContentPart,
  DiscordAttachmentRef,
  FileDeliveryConfig,
} from "./download-files.js";
import { STREAM_PLACEHOLDERS } from "./chunked-message-stream.js";

/** A single Discord message, normalized for history reconstruction. */
export interface DiscordHistoryMessage {
  id: string;
  content: string;
  authorId?: string;
  authorIsBot?: boolean;
  attachments: DiscordAttachmentRef[];
}

/**
 * Backed entirely by the Discord channel: every turn pulls the current
 * channel/thread history, translates it into the AG-UI message shape, and hands
 * a fresh agent to the turn-runner with its `messages` set to that history.
 * Mirrors bot-slack's store — the platform is the durable storage, so the
 * bridge keeps no separate per-conversation state. The inbound (triggering)
 * message is part of the reconstructed history, so the app passes NO prompt.
 */
export class DiscordConversationStore implements ConversationStore {
  constructor(
    private deps: {
      /** Channel history, OLDEST→NEWEST. */
      fetchHistory: (channelId: string) => Promise<DiscordHistoryMessage[]>;
      /** The bot's own user id (lazily resolved after `ready`). */
      botUserId: () => string;
      /** Inbound-file handling tunables (size caps, fetch impl, …). */
      filesConfig?: FileDeliveryConfig;
    },
  ) {}

  /**
   * Build a fresh AgentSession for this conversation by fetching its Discord
   * history and translating it into the AG-UI message shape. Rebuilt every
   * turn (no in-memory cache) — the Discord channel is the source of truth.
   */
  async getOrCreate(
    conversationKey: string,
    _replyTarget: BotReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    const agent = makeAgent(conversationKey);
    const history = await this.reconstruct(conversationKey);
    (agent as unknown as { messages: AgentMessage[] }).messages = history;
    return { agent };
  }

  /**
   * Fetch the channel history (oldest→newest) and translate it into AG-UI
   * messages, folding the bot's chunked replies into a single assistant turn,
   * skipping the bot's own stream placeholders, stripping mention tokens from
   * user text, and turning a user message's uploaded files into multimodal
   * content (bot-slack parity).
   */
  private async reconstruct(channelId: string): Promise<AgentMessage[]> {
    const botId = this.deps.botUserId();
    const messages = await this.deps.fetchHistory(channelId);
    const out: AgentMessage[] = [];

    for (const m of messages) {
      const isBot = m.authorIsBot || m.authorId === botId;
      // Skip the bot's own streaming placeholders ("_thinking…_" / "…(continued)").
      if (isBot && STREAM_PLACEHOLDERS.includes(m.content as never)) continue;

      const text = isBot
        ? m.content
        : m.content
            .replace(/<@!?\d+>/g, "")
            .replace(/\s+/g, " ")
            .trim();
      const hasFiles = !isBot && m.attachments.length > 0;
      if (!text && !hasFiles) continue;

      const role: "user" | "assistant" = isBot ? "assistant" : "user";

      // User message with uploaded files → multimodal content (the agent's
      // model reads the images / decoded text).
      if (hasFiles) {
        const parts = await buildFileContentParts(
          m.attachments,
          this.deps.filesConfig,
        );
        const content: AgentContentPart[] = [];
        if (text) content.push({ type: "text", text });
        content.push(...parts);
        if (content.length === 0) continue; // nothing usable
        out.push({ id: m.id, role, content });
        continue;
      }

      // Fold consecutive same-role *string* messages — the bot's chunked
      // replies are one assistant turn rendered as N Discord messages.
      const tail = out[out.length - 1];
      if (tail && tail.role === role && typeof tail.content === "string") {
        tail.content = `${tail.content}\n${text}`;
      } else {
        out.push({ id: m.id, role, content: text });
      }
    }
    return out;
  }
}

interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  /** String for plain turns; multimodal parts when a user attached files. */
  content: string | AgentContentPart[];
}
