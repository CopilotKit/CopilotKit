import { randomUUID } from "node:crypto";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  ConversationStore,
  AgentSession,
  ReplyTarget,
} from "@copilotkit/channels-core";
import type { ThreadMessage, AgentContentPart } from "@copilotkit/channels-ui";

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  /**
   * Plain text, or AG-UI multimodal content parts when the user's message
   * carried files (e.g. an uploaded CSV). AG-UI types `content` as `string`,
   * but multimodal works at runtime by setting it to an `AgentContentPart[]`;
   * we keep the parts in the transcript so a follow-up turn ("now make it a bar
   * chart") still sees the data, then cast when seeding the agent.
   */
  content: string | AgentContentPart[];
}

/** Collapse stored content (text or multimodal parts) to a display string. */
function contentToText(content: string | AgentContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((p) =>
      p.type === "text"
        ? p.text
        : `[${p.type} attachment: ${p.source.mimeType}]`,
    )
    .join("\n");
}

/**
 * In-memory Teams conversation store.
 *
 * Unlike Slack, Teams does not hand the bot a free, queryable history of a
 * conversation, so the adapter keeps the transcript itself: the listener
 * records each incoming user message, and the run renderer records the agent's
 * reply. Each turn builds a fresh AG-UI thread id (the durable history is held
 * here, not server-side) and seeds the agent with the accumulated transcript.
 *
 * The transcript retains a message's multimodal content (an uploaded file's
 * decoded contents), not just its text, so a follow-up turn can still act on
 * data the user only sent once. This grows context for long file-bearing
 * conversations; a production {@link ConversationStore} can cap or summarize it.
 *
 * This is the batteries-included default. It is deliberately swappable: a
 * production deployment that needs the transcript to survive restarts can
 * implement {@link ConversationStore} against a real datastore and pass it in.
 */
export class TeamsConversationStore implements ConversationStore {
  private readonly history = new Map<string, StoredMessage[]>();

  /**
   * Append a user message to the conversation transcript. Accepts plain text or
   * multimodal content parts (uploaded files); empty content is ignored.
   */
  recordUser(
    conversationKey: string,
    content: string | AgentContentPart[],
  ): void {
    if (typeof content === "string" ? !content : content.length === 0) return;
    this.append(conversationKey, { id: randomUUID(), role: "user", content });
  }

  /** Append an assistant message to the conversation transcript. */
  recordAssistant(conversationKey: string, content: string): void {
    if (!content) return;
    this.append(conversationKey, {
      id: randomUUID(),
      role: "assistant",
      content,
    });
  }

  /** The accumulated transcript as bot-ui `ThreadMessage`s (backs `thread.getMessages()`). */
  getTranscript(conversationKey: string): ThreadMessage[] {
    const transcript = this.history.get(conversationKey) ?? [];
    return transcript.map((m) => ({
      text: contentToText(m.content),
      isBot: m.role === "assistant",
    }));
  }

  private append(conversationKey: string, message: StoredMessage): void {
    const existing = this.history.get(conversationKey);
    if (existing) existing.push(message);
    else this.history.set(conversationKey, [message]);
  }

  async getOrCreate(
    conversationKey: string,
    _replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    // Fresh AG-UI thread per turn. Our `history` map is the durable record, so
    // the server-side thread only needs to live for this turn (mirrors the
    // Slack adapter's rationale for not reusing a stable thread id).
    const threadId = `teams-${conversationKey}-${randomUUID()}`;
    const agent = makeAgent(threadId);
    const transcript = this.history.get(conversationKey) ?? [];
    (agent as unknown as { messages: StoredMessage[] }).messages = [
      ...transcript,
    ];
    return { agent };
  }
}
