import type { AbstractAgent } from "@ag-ui/client";
import type {
  AgentSession,
  ConversationStore,
} from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { GmailClient, GmailMessage } from "./gmail-api.js";
import { parseGmailMessage } from "./parse.js";
import type { GmailReplyTarget } from "./types.js";

/** Keep at most this many earlier emails as agent history. */
const MAX_HISTORY = 50;

/**
 * Conversation store backed by the Gmail thread itself.
 *
 * Each turn reads the thread with `users.threads.get` and gives the agent the
 * emails before the one being answered: mail from the bot's address becomes
 * assistant messages, all other mail user messages. The adapter keeps no
 * transcript of its own. The email being answered is not seeded; Channels
 * adds it (with its attachments) when the handler calls `runAgent()`.
 */
export class GmailConversationStore implements ConversationStore {
  readonly seedsInboundTurn = false;

  constructor(
    private readonly client: GmailClient,
    private readonly isOwnAddress: (address: string) => boolean,
  ) {}

  async getOrCreate(
    conversationKey: string,
    replyTarget: unknown,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    const target = replyTarget as GmailReplyTarget;
    const agent = makeAgent(conversationKey);
    let messages: GmailMessage[] = [];
    try {
      messages = (await this.client.getThread(target.threadId)).messages ?? [];
    } catch (err) {
      console.warn(
        "[channels-gmail] could not read thread history:",
        (err as Error).message,
      );
    }
    const end = target.inboundId
      ? messages.findIndex((m) => m.id === target.inboundId)
      : -1;
    const earlier = (end >= 0 ? messages.slice(0, end) : messages).slice(
      -MAX_HISTORY,
    );
    agent.setMessages(
      earlier.flatMap((message) => {
        const email = parseGmailMessage(message);
        if (!email.text) return [];
        return [
          {
            id: `gmail-${email.id}`,
            role: this.isOwnAddress(email.fromAddress)
              ? ("assistant" as const)
              : ("user" as const),
            content: email.text,
          },
        ];
      }),
    );
    return { agent };
  }

  /** Back `Thread.getMessages()` with the Gmail thread. */
  async getMessages(target: GmailReplyTarget): Promise<ThreadMessage[]> {
    const thread = await this.client.getThread(target.threadId);
    return (thread.messages ?? []).map((message) => {
      const email = parseGmailMessage(message);
      const isBot = this.isOwnAddress(email.fromAddress);
      return {
        text: email.text,
        isBot,
        ...(email.receivedAt ? { ts: email.receivedAt } : {}),
        ...(email.fromAddress
          ? {
              user: {
                id: email.fromAddress,
                kind: isBot ? ("bot" as const) : ("human" as const),
                email: email.fromAddress,
                ...(email.fromName ? { name: email.fromName } : {}),
              },
            }
          : {}),
        messageRef: { id: email.id, threadId: email.threadId },
      };
    });
  }
}
