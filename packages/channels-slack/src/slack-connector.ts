import { App, LogLevel } from "@slack/bolt";
import type {
  WebClient,
  ChatPostMessageArguments,
  ChatUpdateArguments,
  ChatDeleteArguments,
  ChatPostEphemeralArguments,
  ChatStartStreamArguments,
  ChatAppendStreamArguments,
  ChatStopStreamArguments,
  AssistantThreadsSetStatusArguments,
  AssistantThreadsSetSuggestedPromptsArguments,
  AssistantThreadsSetTitleArguments,
  UsersListArguments,
  UsersInfoArguments,
  ConversationsRepliesArguments,
  FilesUploadV2Arguments,
  ReactionsAddArguments,
  ReactionsRemoveArguments,
  ViewsOpenArguments,
} from "@slack/web-api";
import type { IngressSink, PlatformUser } from "@copilotkit/channels-core";
import { attachSlackListener } from "./slack-listener.js";
import { attachAssistant } from "./assistant.js";
import type { AssistantHandle } from "./assistant.js";
import {
  decodeInteraction,
  decodeReaction,
  decodeViewSubmission,
  decodeViewClosed,
  conversationKeyOf,
} from "./interaction.js";
import type {
  ResolvedSlackRespondToOptions,
  SlackAssistantOptions,
} from "./types.js";

/** A member row from `users.list`, as consumed by `SlackAdapter.lookupUser`. */
export interface SlackConnectorMember {
  id?: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; email?: string };
}

/** A user detail row from `users.info`, as consumed by `SlackAdapter.resolveUser`. */
export interface SlackConnectorUserDetail {
  id?: string;
  name?: string;
  real_name?: string;
  profile?: { real_name?: string; display_name?: string; email?: string };
}

/** A history message row from `conversations.replies`, as consumed by `SlackAdapter.getMessages`. */
export interface SlackConnectorHistoryMessage {
  text?: string;
  ts?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
}

/**
 * Bolt's `LogLevel` as a plain string, so the ingress port doesn't have to
 * import `@slack/bolt` to express it — the concrete `WebClientSlackConnector`
 * casts back to Bolt's enum when constructing the real `App` (same string
 * values, see `@slack/logger`'s `LogLevel`).
 */
export type SlackIngressLogLevel = "debug" | "info" | "warn" | "error";

/**
 * Everything the adapter hands the connector to start OWNING the live Slack
 * connection (Task 3b, plan §2 D3). Tokens/App-construction config stay
 * adapter-supplied this unit (see `WebClientSlackConnector.startIngress`'s
 * doc — token *removal* from the adapter is a later unit); `resolveUser` and
 * `handleFeedbackClick` are callbacks so their DECISION logic (the sender
 * cache, the feedback-row routing) stays adapter-side even though the
 * connector is what invokes them per raw event. Deliberately carries no
 * `WebClient`/`App` — only serializable config + sink + callbacks — so a
 * managed Connector Outbox's ingress (webhook-based, no Bolt/socket) could
 * conceivably implement the same `startIngress`/`stopIngress` shape.
 */
export interface SlackIngressConfig {
  /** Slack bot token (xoxb-…). */
  botToken: string;
  /** Slack app-level token (xapp-…) used for Socket Mode. */
  appToken: string;
  /** Signing secret; required when not using Socket Mode. */
  signingSecret?: string;
  /** Use Socket Mode (default true). HTTP mode requires `signingSecret`. */
  socketMode?: boolean;
  /** HTTP port for non-socket mode (ignored under Socket Mode). */
  port?: number;
  logLevel?: SlackIngressLogLevel;
  /** Where every normalized turn/command/interaction/reaction/modal event lands. */
  sink: IngressSink;
  /** Resolved response-routing policy for Slack ingress. */
  respondTo?: ResolvedSlackRespondToOptions;
  /** Assistant-pane behavior, or `false` to disable pane handling entirely. */
  assistant?: SlackAssistantOptions | false;
  /** Resolve a Slack user id to a richer PlatformUser (adapter-owned cache). */
  resolveUser: (userId: string) => Promise<PlatformUser>;
  /**
   * True if a `block_actions` body was a native feedback-row click (adapter
   * decides + dispatches to `SlackFeedbackOptions.onFeedback`); the connector
   * skips `sink.onInteraction` for it when true.
   */
  handleFeedbackClick: (raw: unknown) => boolean;
}

/**
 * Connection facts resolved once ingress starts (`auth.test()` + the
 * assistant-pane handle), handed back to the adapter for its EGRESS-side use:
 * `botUserId`/`teamId` feed native-stream `recipient_*` fields and the
 * conversation store's loop guard; `assistantHandle` gates the pane-only
 * `setSuggestedPrompts`/`setThreadTitle` methods and status target selection.
 */
export interface SlackIngressConnection {
  botUserId: string;
  teamId?: string;
  assistantHandle?: AssistantHandle;
}

/**
 * Every credentialed Slack egress operation `SlackAdapter` performs, behind a
 * port whose method signatures carry only serializable data (channel/ts/
 * text/blocks/etc.) — never a `WebClient` instance or a token. That's the
 * whole point: the managed Connector Outbox implements this SAME interface
 * with its own credentialed sender, and a custom runner can supply another.
 *
 * Subsumes the two transports the adapter already injected — the run
 * renderer's {@link SlackRenderTransport} (render/transport.ts: setStatus/
 * postMessage/updateMessage) and the {@link NativeStreamTransport}
 * (native-stream.ts: startStream/appendStream/stopStream) — plus every other
 * `this.client.*` call `SlackAdapter`'s egress methods used to make inline
 * (delete/reactions/ephemeral/file/suggestedPrompts/title/history/lookup/
 * modal). Argument shapes reuse `@slack/web-api`'s plain `*Arguments`
 * interfaces: already bounded, serializable data, so this is a pass-through
 * of what the adapter already builds — only the *sender* moves behind the
 * port. Native-vs-legacy transport choice (the `nativeStreamingOk` /
 * `nativeTaskChunksOk` health flags) stays adapter-side; the connector only
 * executes whichever call the adapter decides to make.
 */
export interface SlackConnector {
  /** `chat.postMessage` — post a message (post ~341, legacy stream placeholder ~379, render transport ~513). */
  postMessage(
    args: ChatPostMessageArguments,
  ): Promise<{ ts?: string; channel?: string }>;
  /** `chat.update` — edit an existing message (update ~364, legacy stream ~394, render transport ~519). */
  updateMessage(args: ChatUpdateArguments): Promise<void>;
  /** `chat.delete` (~570). */
  deleteMessage(args: ChatDeleteArguments): Promise<void>;
  /** `assistant.threads.setStatus` — the render transport's "is thinking…" indicator (~510). */
  setStatus(args: AssistantThreadsSetStatusArguments): Promise<void>;

  /** `chat.startStream` — begin a native streamed message (~467). */
  startStream(
    args: ChatStartStreamArguments,
  ): Promise<{ ts?: string; channel?: string }>;
  /** `chat.appendStream` — append text or structured chunks to a streamed message (~478/486). */
  appendStream(args: ChatAppendStreamArguments): Promise<void>;
  /** `chat.stopStream` — finalize a native streamed message (~496). */
  stopStream(args: ChatStopStreamArguments): Promise<void>;

  /** `assistant.threads.setSuggestedPrompts` — pane-only prompt chips (~655). */
  setSuggestedPrompts(
    args: AssistantThreadsSetSuggestedPromptsArguments,
  ): Promise<void>;
  /** `assistant.threads.setTitle` — pane-only thread title (~686). */
  setThreadTitle(args: AssistantThreadsSetTitleArguments): Promise<void>;

  /** `users.list` — paged workspace member listing, backs `lookupUser` (~707). */
  listUsers(args: UsersListArguments): Promise<{
    members?: SlackConnectorMember[];
    response_metadata?: { next_cursor?: string };
  }>;
  /** `users.info` — backs `resolveUser` (~755). */
  getUserInfo(
    args: UsersInfoArguments,
  ): Promise<{ user?: SlackConnectorUserDetail }>;

  /** `conversations.replies` — backs `getMessages` (~829). */
  getReplies(
    args: ConversationsRepliesArguments,
  ): Promise<{ messages?: SlackConnectorHistoryMessage[] }>;

  /** `files.uploadV2` — backs `postFile` (~888). */
  uploadFile(args: FilesUploadV2Arguments): Promise<void>;

  /** `reactions.add` (~907). */
  addReaction(args: ReactionsAddArguments): Promise<void>;
  /** `reactions.remove` (~928). */
  removeReaction(args: ReactionsRemoveArguments): Promise<void>;

  /** `chat.postEphemeral` — backs `postEphemeral` (~955). */
  postEphemeral(
    args: ChatPostEphemeralArguments,
  ): Promise<{ message_ts?: string }>;

  /** `views.open` — backs `openModal` (~1006). */
  openModal(args: ViewsOpenArguments): Promise<void>;

  /**
   * Start OWNING the live Slack connection (Task 3b, plan §2 D3): build the
   * Bolt `App` (Socket Mode or HTTP), `app.init()`, resolve our own identity
   * via `auth.test()`, and subscribe to every raw Slack event — slash
   * commands, `app_mention`/`message`, `block_actions`, `reaction_added`/
   * `reaction_removed`, view submit/close, and the assistant-pane middleware
   * — normalizing each via the adapter's pure decode/shape functions before
   * forwarding to `config.sink`. Resolves once the app has started listening.
   */
  startIngress(config: SlackIngressConfig): Promise<SlackIngressConnection>;
  /** Stop the live connection started by {@link startIngress}. */
  stopIngress(): Promise<void>;
}

/**
 * The transitional / custom-runner / local-dev {@link SlackConnector}: wraps a
 * `WebClient` (built from `botToken`/`appToken`) and holds the exact
 * credentialed calls `SlackAdapter`'s egress methods used to make inline
 * before this port existed. The Intelligence Connector Outbox supplies its
 * own implementation of this same interface.
 */
export class WebClientSlackConnector implements SlackConnector {
  /** The live Bolt `App`, set by {@link startIngress}; undefined until then. */
  private app: App | undefined;

  constructor(private readonly client: WebClient) {}

  async postMessage(
    args: ChatPostMessageArguments,
  ): Promise<{ ts?: string; channel?: string }> {
    const res = await this.client.chat.postMessage(args);
    return { ts: res.ts, channel: res.channel };
  }

  async updateMessage(args: ChatUpdateArguments): Promise<void> {
    await this.client.chat.update(args);
  }

  async deleteMessage(args: ChatDeleteArguments): Promise<void> {
    await this.client.chat.delete(args);
  }

  async setStatus(args: AssistantThreadsSetStatusArguments): Promise<void> {
    await this.client.assistant.threads.setStatus(args);
  }

  async startStream(
    args: ChatStartStreamArguments,
  ): Promise<{ ts?: string; channel?: string }> {
    const res = await this.client.chat.startStream(args);
    return { ts: res.ts, channel: res.channel };
  }

  async appendStream(args: ChatAppendStreamArguments): Promise<void> {
    await this.client.chat.appendStream(args);
  }

  async stopStream(args: ChatStopStreamArguments): Promise<void> {
    await this.client.chat.stopStream(args);
  }

  async setSuggestedPrompts(
    args: AssistantThreadsSetSuggestedPromptsArguments,
  ): Promise<void> {
    await this.client.assistant.threads.setSuggestedPrompts(args);
  }

  async setThreadTitle(args: AssistantThreadsSetTitleArguments): Promise<void> {
    await this.client.assistant.threads.setTitle(args);
  }

  async listUsers(args: UsersListArguments): Promise<{
    members?: SlackConnectorMember[];
    response_metadata?: { next_cursor?: string };
  }> {
    const r = (await this.client.users.list(args)) as {
      members?: SlackConnectorMember[];
      response_metadata?: { next_cursor?: string };
    };
    return r;
  }

  async getUserInfo(
    args: UsersInfoArguments,
  ): Promise<{ user?: SlackConnectorUserDetail }> {
    const r = (await this.client.users.info(args)) as {
      user?: SlackConnectorUserDetail;
    };
    return r;
  }

  async getReplies(
    args: ConversationsRepliesArguments,
  ): Promise<{ messages?: SlackConnectorHistoryMessage[] }> {
    const r = (await this.client.conversations.replies(args)) as {
      messages?: SlackConnectorHistoryMessage[];
    };
    return r;
  }

  async uploadFile(args: FilesUploadV2Arguments): Promise<void> {
    await this.client.files.uploadV2(args);
  }

  async addReaction(args: ReactionsAddArguments): Promise<void> {
    await this.client.reactions.add(args);
  }

  async removeReaction(args: ReactionsRemoveArguments): Promise<void> {
    await this.client.reactions.remove(args);
  }

  async postEphemeral(
    args: ChatPostEphemeralArguments,
  ): Promise<{ message_ts?: string }> {
    const res = await this.client.chat.postEphemeral(args);
    return { message_ts: (res as { message_ts?: string }).message_ts };
  }

  async openModal(args: ViewsOpenArguments): Promise<void> {
    await this.client.views.open(args);
  }

  async startIngress(
    config: SlackIngressConfig,
  ): Promise<SlackIngressConnection> {
    const app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: config.socketMode ?? true,
      logLevel: (config.logLevel as LogLevel | undefined) ?? LogLevel.INFO,
      // Without this, Bolt's constructor fires a background auth.test that
      // can't be awaited or error-handled (and phones home from unit tests).
      // We own initialization below: app.init(), then our own awaited
      // auth.test — construction stays side-effect-free.
      deferInitialization: true,
    });
    this.app = app;

    // Deferred from construction (see above); Bolt requires init() before
    // app.start(), and doing it here surfaces auth/config errors to the caller.
    await app.init();

    // Resolve our own bot user id before attaching the listener so the loop
    // guard (skip our own posts) is in place from the first event.
    const auth = await this.client.auth.test();
    const botUserId = auth.user_id as string;
    const teamId = auth.team_id as string | undefined;

    // Attach the assistant-pane middleware FIRST (when enabled) so its
    // `isAssistantThread` predicate is available to the message listener's
    // no-double-delivery guard below.
    let assistantHandle: AssistantHandle | undefined;
    if (config.assistant !== false) {
      assistantHandle = attachAssistant({
        app,
        sink: config.sink,
        opts: config.assistant ?? {},
        resolveUser: config.resolveUser,
      });
    }

    attachSlackListener({
      app,
      botUserId,
      respondTo: config.respondTo,
      isAssistantThread: assistantHandle?.isAssistantThread,
      onTurn: async (turn) => {
        await config.sink.onTurn({
          conversationKey: conversationKeyOf(turn.conversation),
          // Carry the sender id so native channel streams can pass
          // `recipient_user_id` to chat.startStream.
          replyTarget: {
            ...turn.replyTarget,
            recipientUserId: turn.senderUserId,
          },
          userText: turn.userText,
          user: turn.senderUserId
            ? await config.resolveUser(turn.senderUserId)
            : undefined,
          // Stable per-delivery id for inbound dedup (Events API event_id, or a
          // fallback derived by the listener); undefined when unavailable.
          eventId: turn.eventId,
          platform: "slack",
          // Normalized conversation surface kind + tag signal (plan §2) — the
          // engine's product-driven response policy governs from here.
          conversationKind: turn.conversationKind,
          mentioned: turn.mentioned,
        });
      },
      onCommand: async (cmd) => {
        await config.sink.onCommand({
          command: cmd.command,
          text: cmd.text,
          // Slack delivers args as free text only; structured `rawOptions`
          // are a Discord-style capability, so they're left unset here.
          conversationKey: conversationKeyOf(cmd.conversation),
          replyTarget: cmd.replyTarget,
          user: cmd.senderUserId
            ? await config.resolveUser(cmd.senderUserId)
            : undefined,
          // Stable per-invocation id for inbound dedup (command:user:trigger_id).
          eventId: cmd.eventId,
          platform: "slack",
          triggerId: cmd.triggerId,
        });
      },
    });

    // Every block_actions click → decode to an opaque-id InteractionEvent and
    // hand to the sink. The matching `ck:` action either resolves an awaiting
    // HITL picker or dispatches via the ActionRegistry; unrelated clicks decode
    // to events the bot harmlessly ignores.
    app.action(/.*/, async ({ ack, body }) => {
      await ack();
      // Native feedback-row clicks are handled adapter-locally and never reach
      // the engine's interaction dispatch (which would swallow the unknown id).
      if (config.handleFeedbackClick(body)) return;
      const evt = decodeInteraction(body);
      if (evt) await config.sink.onInteraction(evt);
    });

    app.event("reaction_added", async ({ event }) => {
      // Loop guard: Slack delivers reaction events for the bot's OWN reactions
      // (e.g. our addReaction egress), which would echo back as phantom user
      // reactions. Skip them, like every other ingress path guards botUserId.
      if (event.user === botUserId) return;
      const evt = decodeReaction(event, true);
      if (!evt) return;
      // Enrich the reactor to parity with onTurn/onCommand so per-user
      // attribution (e.g. senderContext(evt.user) → filter by email) works
      // for reaction-triggered runs, not just mentions and commands.
      if (event.user) evt.user = await config.resolveUser(event.user);
      await config.sink.onReaction(evt);
    });
    app.event("reaction_removed", async ({ event }) => {
      if (event.user === botUserId) return;
      const evt = decodeReaction(event, false);
      if (!evt) return;
      if (event.user) evt.user = await config.resolveUser(event.user);
      await config.sink.onReaction(evt);
    });

    // Modal submit: route to the engine and ack. When the handler returns
    // per-field errors, ack with `response_action: "errors"` (keeps the modal
    // open with inline messages); otherwise a plain ack closes the modal.
    // A catch-all `/.*/` callback_id constraint defaults to `view_submission`.
    app.view(/.*/, async ({ ack, body, view }) => {
      const user = body.user?.id
        ? { id: body.user.id, name: body.user.name }
        : undefined;
      const result = await config.sink.onModalSubmit(
        decodeViewSubmission(view, user),
      );
      if (result?.errors) {
        await ack({ response_action: "errors", errors: result.errors });
      } else {
        await ack();
      }
    });
    // Modal dismissed (only delivered when the view set `notify_on_close`).
    app.view(
      { type: "view_closed", callback_id: /.*/ },
      async ({ ack, body, view }) => {
        const user = body.user?.id
          ? { id: body.user.id, name: body.user.name }
          : undefined;
        await config.sink.onModalClose(decodeViewClosed(view, user));
        await ack();
      },
    );

    // Socket Mode ignores the port; HTTP mode binds it.
    await app.start(config.port ?? 0);

    return { botUserId, teamId, assistantHandle };
  }

  async stopIngress(): Promise<void> {
    await this.app?.stop();
  }
}
