import type {
  CommandSpec,
  IngressSink,
  InteractionEvent,
  PlatformAdapter,
  RunRenderer,
  SurfaceCapabilities,
  UserQuery,
} from "@copilotkit/channels-core";
import type {
  ChannelNode,
  MessageRef,
  ProviderActor,
  ThreadMessage,
} from "@copilotkit/channels-ui";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createInboundVerifier, createTokenProvider } from "./auth.js";
import { ChatClient } from "./chat-client.js";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { GoogleChatConversationStore } from "./conversation-store.js";
import { createRunRenderer } from "./event-renderer.js";
import { normalizeEvent } from "./events.js";
import { InMemoryHistoryStore } from "./history-store.js";
import type { HistoryStore } from "./history-store.js";
import { decodeInteraction } from "./interaction.js";
import { routeEvent } from "./listener.js";
import { markdownToChat } from "./markdown.js";
import { renderGoogleChatMessage } from "./render/cards-v2.js";
import {
  createNodeListener,
  createRequestHandler,
  startServer,
} from "./server.js";
import type { ChatRequestHandler } from "./server.js";
import { conversationKeyOf } from "./types.js";
import type {
  GoogleChatAdapterOptions,
  GoogleChatMessageRef,
  ReplyTarget,
} from "./types.js";

/** Construct a Google Chat `PlatformAdapter`. */
export function googleChat(opts: GoogleChatAdapterOptions): GoogleChatAdapter {
  return new GoogleChatAdapter(opts);
}

/**
 * Google Chat `PlatformAdapter`. Events arrive on an HTTP webhook (either
 * the Chat API envelope or the Workspace add-on envelope); replies go out
 * through the Chat REST API, streamed by editing a message in place.
 */
export class GoogleChatAdapter implements PlatformAdapter {
  readonly platform = "google-chat";
  readonly capabilities: SurfaceCapabilities = {
    supportsMessageEvents: true,
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    supportsStreaming: true,
    supportsSuggestedPrompts: false,
    supportsThreadTitle: false,
    supportsEphemeral: false,
    maxBlocksPerMessage: 100,
  };
  readonly ackDeadlineMs = 30_000;
  readonly conversationStore: GoogleChatConversationStore;

  /** Framework-neutral webhook handler: mount it on any HTTP server. */
  readonly requestHandler: ChatRequestHandler;
  /** Node `http` listener for the webhook (`http.createServer(adapter.nodeHandler)`). */
  readonly nodeHandler: (req: IncomingMessage, res: ServerResponse) => void;

  chatClient: ChatClient;

  private readonly opts: GoogleChatAdapterOptions;
  private readonly history: HistoryStore;
  private sink: IngressSink | undefined;
  private server: { close(): Promise<void> } | undefined;

  constructor(opts: GoogleChatAdapterOptions) {
    this.opts = opts;
    this.history = opts.historyStore ?? new InMemoryHistoryStore();
    this.conversationStore = new GoogleChatConversationStore(this.history);
    this.chatClient = new ChatClient({
      tokenProvider: createTokenProvider(opts),
      apiUrl: opts.apiUrl,
    });
    // Throws when no verifier is configured and verification is not disabled.
    const verifier = createInboundVerifier(opts);
    this.requestHandler = createRequestHandler({
      verifier,
      onEvent: (body) => this.handleEvent(body),
    });
    this.nodeHandler = createNodeListener({
      handler: this.requestHandler,
      path: opts.path,
    });
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;
    if (this.opts.port !== undefined) {
      this.server = await startServer({
        port: this.opts.port,
        path: this.opts.path,
        handler: this.requestHandler,
      });
    }
  }

  async stop(): Promise<void> {
    this.sink = undefined;
    const server = this.server;
    this.server = undefined;
    await server?.close();
  }

  /** Route one verified webhook body to the channel. */
  private async handleEvent(body: unknown): Promise<void> {
    const sink = this.sink;
    if (!sink) {
      console.warn(
        "[channels-google-chat] dropped an event that arrived before start()",
      );
      return;
    }
    await routeEvent(normalizeEvent(body), {
      sink,
      history: this.history,
      ...(this.opts.botUserId ? { botUserId: this.opts.botUserId } : {}),
    });
  }

  render(ir: ChannelNode[]): { cardsV2?: unknown[]; text?: string } {
    return renderGoogleChatMessage(ir, { endpointUrl: this.opts.endpointUrl });
  }

  async post(target: ReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    const body = this.render(ir);
    const res = await this.chatClient.createMessage(target.space, body, {
      threadName: target.thread,
      replyToThread: !!target.thread,
    });
    this.record(target, body.cardsV2 ? undefined : body.text, res.name);
    return this.refOf(target, res);
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    const body = this.render(ir);
    // Name both fields so a card can become text and text a card.
    await this.chatClient.patchMessage(
      ref.id,
      { text: body.text ?? "", cardsV2: body.cardsV2 ?? [] },
      "text,cards_v2",
    );
  }

  async stream(
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    let first: { name: string; thread?: string } | undefined;
    const stream = new ChunkedMessageStream({
      postPlaceholder: async (text) => {
        const res = await this.chatClient.createMessage(
          target.space,
          { text },
          { threadName: target.thread, replyToThread: !!target.thread },
        );
        first ??= res;
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
      stream.append(acc);
    }
    await stream.finish();
    this.record(target, acc, first?.name);
    return this.refOf(target, first ?? { name: "" });
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.chatClient.deleteMessage(ref.id);
  }

  createRunRenderer(target: ReplyTarget): RunRenderer {
    return createRunRenderer({
      client: this.chatClient,
      target,
      interruptEventNames: this.opts.interruptEventNames,
      showToolStatus: this.opts.showToolStatus,
      onAssistantText: (text) => this.record(target, text, undefined),
    });
  }

  /**
   * A click on a message is keyed by the thread the message actually landed
   * in. In a space without threaded replies that can differ from the thread
   * the reply was aimed at, so key it by the posted message's own thread.
   */
  postedConversationKey(
    target: ReplyTarget,
    posted: MessageRef,
  ): string | undefined {
    if (!target.thread) return undefined;
    const thread = (posted as GoogleChatMessageRef).thread;
    return thread ? conversationKeyOf(target.space, thread) : undefined;
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return decodeInteraction(raw);
  }

  async lookupUser(_q: UserQuery): Promise<ProviderActor | undefined> {
    // Google Chat gives an app no user directory.
    return undefined;
  }

  async getMessages(target: ReplyTarget): Promise<ThreadMessage[]> {
    return this.conversationStore.getMessages(target);
  }

  registerCommands(commands: readonly CommandSpec[]): void {
    if (commands.length === 0) return;
    console.info(
      "[channels-google-chat] slash commands are configured in the Google Cloud console, not by the app. Declared:",
      commands.map((c) => c.name),
    );
  }

  private refOf(
    target: ReplyTarget,
    res: { name: string; thread?: string },
  ): GoogleChatMessageRef {
    const thread = res.thread ?? target.thread;
    return {
      id: res.name,
      space: target.space,
      ...(thread ? { thread } : {}),
    };
  }

  /** Append an assistant message to the transcript. Never fails a send. */
  private record(
    target: ReplyTarget,
    text: string | undefined,
    id: string | undefined,
  ): void {
    if (!text?.trim()) return;
    void this.history
      .append(conversationKeyOf(target.space, target.thread), {
        role: "assistant",
        content: text,
        ts: `${Date.now()}`,
        ...(id ? { id } : {}),
      })
      .catch(() => {});
  }
}
