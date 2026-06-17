import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  InteractionEvent,
  RunRenderer,
  ReplyTarget as BotReplyTarget,
  ConversationStore,
  AgentSession,
  MessageRef,
  PlatformUser,
  UserQuery,
} from "@copilotkit/bot";
import type { AbstractAgent } from "@ag-ui/client";
import type { BotNode, ThreadMessage } from "@copilotkit/bot-ui";
import { GoogleChatConversationStore } from "./conversation-store.js";
import { routeChatEvent } from "./listener.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction } from "./interaction.js";
import { renderCardsV2, renderGoogleChatMessage } from "./render/cards-v2.js";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { markdownToChat } from "./markdown.js";
import { createTokenProvider, createInboundVerifier } from "./auth.js";
import type { InboundVerifier } from "./auth.js";
import { createRequestHandler, startServer } from "./server.js";
import type { ChatRequestHandler } from "./server.js";
import { ChatClient } from "./chat-client.js";
import { DM_SCOPE, conversationKeyOf } from "./types.js";
import type { ConversationKey, ReplyTarget, GoogleChatAdapterOptions } from "./types.js";
import type { CommandSpec } from "@copilotkit/bot";

/** Google Chat `PlatformAdapter`: ingress via webhook, egress via Chat REST API + edit-in-place streaming. */
export class GoogleChatAdapter implements PlatformAdapter {
  readonly platform = "google-chat";
  readonly capabilities: SurfaceCapabilities;
  readonly ackDeadlineMs = 30000;

  /**
   * Bot-echo suppression primarily uses `sender.type === "BOT"`. This
   * `botUserId` is a best-effort secondary guard for the `sender.name ===
   * botUserId` comparisons in listener/conversation-store; the engine may
   * populate it. It is intentionally left empty by default in v1 because
   * Google Chat does not expose the bot's own user id without extra setup,
   * so those comparisons never match on their own.
   */
  botUserId = "";
  chatClient: ChatClient;
  requestHandler: ChatRequestHandler;

  private readonly opts: GoogleChatAdapterOptions;
  private readonly verifier: InboundVerifier;
  private server: { close(): Promise<void> } | undefined;

  constructor(opts: GoogleChatAdapterOptions) {
    // Auth invariant: must have one of googleChatProjectNumber, audience, or disableSignatureVerification
    if (!opts.googleChatProjectNumber && !opts.audience && !opts.disableSignatureVerification) {
      throw new Error(
        "bot-google-chat: provide googleChatProjectNumber, audience, or disableSignatureVerification:true",
      );
    }

    this.opts = opts;
    this.capabilities = {
      supportsModals: false,
      supportsTyping: false,
      supportsReactions: false,
      supportsStreaming: true,
      supportsSuggestedPrompts: false,
      supportsThreadTitle: false,
      maxBlocksPerMessage: 100,
    };

    // Build collaborators — no network I/O in the constructor
    const tokenProvider = createTokenProvider(opts);
    this.verifier = createInboundVerifier(opts);
    this.chatClient = new ChatClient({
      tokenProvider,
      apiUrl: opts.apiUrl,
    });

    // Placeholder handler; real one is built in start() once we have the sink
    this.requestHandler = createRequestHandler({
      verifier: this.verifier,
      onEvent: async (_event: unknown) => ({}),
    });
  }

  async start(sink: IngressSink): Promise<void> {

    const onEvent = async (event: unknown): Promise<unknown> => {
      // First try CARD_CLICKED interaction decoding
      const interaction = decodeInteraction(event);
      if (interaction) {
        await sink.onInteraction(interaction);
        return {};
      }

      // Otherwise route as a regular chat event
      await routeChatEvent(event, {
        botUserId: this.botUserId,
        handlers: {
          onTurn: async (turn) => {
            await sink.onTurn({
              conversationKey: conversationKeyOf(turn.conversation),
              replyTarget: turn.replyTarget,
              userText: turn.userText,
              user: turn.senderUserId
                ? { id: turn.senderUserId, name: turn.senderName }
                : undefined,
              platform: "google-chat",
            });
          },
          onCommand: async (cmd) => {
            await sink.onCommand({
              command: cmd.command,
              text: cmd.text,
              conversationKey: conversationKeyOf(cmd.conversation),
              replyTarget: cmd.replyTarget,
              user: cmd.senderUserId
                ? { id: cmd.senderUserId, name: cmd.senderName }
                : undefined,
              platform: "google-chat",
            });
          },
          onThreadStarted: async (evt) => {
            await sink.onThreadStarted({
              conversationKey: conversationKeyOf(evt.conversation),
              replyTarget: evt.replyTarget,
              user: evt.senderUserId ? { id: evt.senderUserId } : undefined,
              platform: "google-chat",
            });
          },
        },
      });

      return {};
    };

    // Build the real request handler with the live onEvent
    this.requestHandler = createRequestHandler({ verifier: this.verifier, onEvent });

    // Start HTTP server if port is configured
    if (this.opts.port) {
      this.server = startServer({
        port: this.opts.port,
        handler: this.requestHandler,
      });
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = undefined;
    }
  }

  render(ir: BotNode[]) {
    return renderCardsV2(ir);
  }

  async post(target: BotReplyTarget, ir: BotNode[]): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const body = renderGoogleChatMessage(ir);
    const res = await this.chatClient.createMessage(t.space, body, {
      threadName: t.thread,
      replyToThread: !!t.thread,
    });
    return { id: res.name, space: t.space } as unknown as MessageRef;
  }

  async update(ref: MessageRef, ir: BotNode[]): Promise<void> {
    const body = renderGoogleChatMessage(ir);
    await this.chatClient.patchMessage(ref.id, body, "text,cardsV2");
  }

  async stream(
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    let firstName: string | undefined;

    const streamObj = new ChunkedMessageStream({
      postPlaceholder: async (text) => {
        const res = await this.chatClient.createMessage(
          t.space,
          { text },
          { threadName: t.thread, replyToThread: !!t.thread },
        );
        if (!firstName) firstName = res.name;
        return res.name;
      },
      updateAt: async (name, text) => {
        await this.chatClient.patchMessage(name, { text }, "text");
      },
      transform: markdownToChat,
    });

    let acc = "";
    for await (const chunk of chunks) {
      acc += chunk;
      streamObj.append(acc);
    }
    await streamObj.finish();

    return { id: firstName ?? "", space: t.space } as unknown as MessageRef;
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.chatClient.deleteMessage(ref.id);
  }

  createRunRenderer(target: BotReplyTarget): RunRenderer {
    const t = target as ReplyTarget;
    return createRunRenderer({
      client: this.chatClient,
      target: t,
      interruptEventNames: this.opts.interruptEventNames,
      showToolStatus: this.opts.showToolStatus,
    });
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return decodeInteraction(raw);
  }

  async lookupUser(_q: UserQuery): Promise<PlatformUser | undefined> {
    // Best-effort: no reliable directory lookup without domain delegation in v1
    return undefined;
  }

  get conversationStore(): ConversationStore {
    const store = new GoogleChatConversationStore({
      client: this.chatClient,
      botUserId: this.botUserId,
    });
    return {
      async getOrCreate(
        conversationKey: string,
        replyTarget: BotReplyTarget,
        makeAgent: (threadId: string) => AbstractAgent,
      ): Promise<AgentSession> {
        const idx = conversationKey.indexOf("::");
        const spaceId =
          idx >= 0 ? conversationKey.slice(0, idx) : conversationKey;
        const scope = idx >= 0 ? conversationKey.slice(idx + 2) : DM_SCOPE;
        const key: ConversationKey = { spaceId, scope };
        const session = await store.getOrCreate(
          key,
          replyTarget as ReplyTarget,
          makeAgent as unknown as Parameters<
            GoogleChatConversationStore["getOrCreate"]
          >[2],
        );
        return { agent: session.agent as unknown as AbstractAgent };
      },
    };
  }

  async getMessages(target: BotReplyTarget): Promise<ThreadMessage[]> {
    const t = target as ReplyTarget;
    try {
      const messages = await this.chatClient.listMessages(t.space);
      return messages.map((m) => ({
        text: m.text ?? "",
        isBot: m.sender?.type === "BOT",
        user: m.sender?.name ? { id: m.sender.name } : undefined,
      }));
    } catch (err) {
      console.warn("[bot-google-chat] getMessages failed:", err);
      return [];
    }
  }

  async postFile(
    target: BotReplyTarget,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const t = target as ReplyTarget;
    return this.chatClient.uploadAttachment(t.space, args.bytes, args.filename);
  }

  registerCommands(_commands: readonly CommandSpec[]): void {
    // Chat slash commands are configured in the Chat app console, not via API.
    // Keep the method so the engine's start() path is satisfied.
    console.info(
      "[bot-google-chat] registerCommands: Chat slash commands are configured in the Google Cloud console. Declared commands:",
      _commands.map((c) => c.name),
    );
  }
}

/** Construct a Google Chat `PlatformAdapter`. */
export function googleChat(opts: GoogleChatAdapterOptions): GoogleChatAdapter {
  return new GoogleChatAdapter(opts);
}
