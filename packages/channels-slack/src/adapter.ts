import { App, LogLevel } from "@slack/bolt";
import type {
  WebClient,
  ChatStartStreamArguments,
  ChatAppendStreamArguments,
  ChatStopStreamArguments,
  ChatPostMessageArguments,
  ChatUpdateArguments,
  FilesUploadV2Arguments,
} from "@slack/web-api";
import type { AnyChunk, KnownBlock } from "@slack/types";
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
  EphemeralResult,
  NativePayload,
} from "@copilotkit/channels-core";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  ChannelNode,
  ThreadMessage,
  EmojiValue,
} from "@copilotkit/channels-ui";
import { toPlatformEmoji } from "@copilotkit/channels-ui";
import { SlackConversationStore } from "./conversation-store.js";
import { WebClientSlackConnector } from "./slack-connector.js";
import type { SlackConnector } from "./slack-connector.js";
import { attachSlackListener } from "./slack-listener.js";
import { createRunRenderer } from "./event-renderer.js";
import {
  decodeInteraction,
  decodeReaction,
  decodeViewSubmission,
  decodeViewClosed,
  conversationKeyOf,
} from "./interaction.js";
import {
  renderBlockKit,
  renderSlackMessage,
  buildFeedbackBlocks,
  FEEDBACK_ACTION_ID,
} from "./render/block-kit.js";
import { renderSlackModal } from "./render/modal.js";
import type { SlackRenderTransport } from "./render/transport.js";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { NativeMessageStream } from "./native-stream.js";
import type { TextStream, NativeStreamTransport } from "./native-stream.js";
import { attachAssistant } from "./assistant.js";
import type { AssistantHandle } from "./assistant.js";
import { autoCloseOpenMarkdown } from "./auto-close-streaming.js";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";
import { DM_SCOPE, resolveSlackRespondToOptions } from "./types.js";
import type {
  ConversationKey,
  ReplyTarget,
  SlackAssistantOptions,
  SlackFeedbackOptions,
  SlackRespondToOptions,
} from "./types.js";

export interface SlackAdapterOptions {
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
  /** Bolt log level. */
  logLevel?: LogLevel;
  /** Custom-event names treated as interrupts by the run renderer. */
  interruptEventNames?: ReadonlySet<string>;
  /** Surface `:wrench:`/`:white_check_mark:` tool-status rows. Default true. */
  showToolStatus?: boolean;
  /**
   * Assistant-pane behavior ("Agents & AI Apps"). ON by default — the pane
   * activates whenever the app's Slack config has the toggle (see the README),
   * and lies dormant without it. Pass an object to customize, or `false` to
   * disable pane handling entirely.
   */
  assistant?: SlackAssistantOptions | false;
  /**
   * Controls which Slack message surfaces become bot turns. Defaults: DMs
   * respond, app mentions respond in-thread, and plain channel thread replies
   * require another app mention.
   */
  respondTo?: SlackRespondToOptions;
  /**
   * Reply-stream transport. "native" (default): `chat.startStream` wherever the
   * reply target is a thread; flat DMs and workspaces where the streaming API
   * is unavailable fall back to legacy automatically. "legacy": the shipped
   * `chat.update` transport.
   */
  streaming?: "native" | "legacy";
  /**
   * Opt-in native AI feedback buttons (👍/👎). When set, streamed replies on
   * the native path finalize with a `feedback_buttons` row and clicks are
   * routed to `onFeedback` (they never reach the engine). Omit for no feedback.
   */
  feedback?: SlackFeedbackOptions;
}

/** Slack `PlatformAdapter`: ingress via Bolt, egress via Block Kit + streaming. */
export class SlackAdapter implements PlatformAdapter {
  readonly platform = "slack";
  readonly capabilities: SurfaceCapabilities;
  readonly ackDeadlineMs = 3000;

  readonly app: App;
  client: WebClient;
  /**
   * Test-only injection point: when set, {@link connector} returns this
   * instead of wrapping `this.client`. Lets tests drive `SlackAdapter`'s
   * egress methods against a `FakeSlackConnector` directly (proving the
   * adapter→connector routing) without a WebClient-shaped fake underneath.
   * Production code never sets this — the adapter always wraps its own
   * `WebClient`.
   */
  private connectorOverride: SlackConnector | undefined;
  botUserId = "";
  private readonly store: SlackConversationStore;
  private sink: IngressSink | undefined;
  /** Per-id cache for sender-profile resolution (repeat turns are cheap). */
  private readonly userCache = new Map<string, PlatformUser>();
  /** Set once the Assistant middleware is attached (when assistant !== false). */
  private assistantHandle: AssistantHandle | undefined;
  /** Our team id (from auth.test); native channel streams need it. */
  private teamId: string | undefined;
  /**
   * In-memory native-streaming health for this workspace. Flipped to false the
   * first time `chat.startStream` fails, so subsequent streams skip the native
   * path and go straight to the legacy transport.
   */
  private nativeStreamingOk = true;
  /**
   * In-memory health of native structured `task_update` chunks for this
   * workspace. Flipped to false the first time a chunk append fails (old
   * workspace / missing `assistant:write`), so later turns surface tool
   * progress as `:wrench:` rows instead of retrying chunks.
   */
  private nativeTaskChunksOk = true;

  constructor(private readonly opts: SlackAdapterOptions) {
    const assistantEnabled = opts.assistant !== false;
    this.capabilities = {
      supportsModals: true,
      supportsTyping: false,
      supportsReactions: true,
      supportsStreaming: true,
      supportsEphemeral: true,
      maxBlocksPerMessage: 50,
      supportsSuggestedPrompts: assistantEnabled,
      supportsThreadTitle: assistantEnabled,
    };
    this.app = new App({
      token: opts.botToken,
      appToken: opts.appToken,
      signingSecret: opts.signingSecret,
      socketMode: opts.socketMode ?? true,
      logLevel: opts.logLevel ?? LogLevel.INFO,
      // Without this, Bolt's constructor fires a background auth.test that
      // can't be awaited or error-handled (and phones home from unit tests).
      // start() owns initialization: app.init() below, then our own awaited
      // auth.test — construction stays side-effect-free.
      deferInitialization: true,
    });
    this.client = this.app.client;
    this.store = new SlackConversationStore({
      client: this.client,
      botUserId: "",
      botToken: opts.botToken,
    });
  }

  /**
   * The credentialed {@link SlackConnector} every egress method routes
   * through. Freshly wraps the CURRENT `this.client` on every access (rather
   * than being built once) so tests that swap `adapter.client` for a fake
   * keep working unchanged; `connectorOverride` lets tests substitute a
   * `FakeSlackConnector` entirely. Token removal (routing through a
   * runner-supplied connector instead) is a later unit.
   */
  private get connector(): SlackConnector {
    return this.connectorOverride ?? new WebClientSlackConnector(this.client);
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;

    // Deferred from the constructor (see above); Bolt requires init() before
    // app.start(), and doing it here surfaces auth/config errors to the caller.
    await this.app.init();

    // Resolve our own bot user id before attaching the listener so the loop
    // guard (skip our own posts) is in place from the first event.
    const auth = await this.client.auth.test();
    this.botUserId = auth.user_id as string;
    this.teamId = auth.team_id as string | undefined;
    (this.store as unknown as { botUserId: string }).botUserId = this.botUserId;

    // Attach the assistant-pane middleware FIRST (when enabled) so its
    // `isAssistantThread` predicate is available to the message listener's
    // no-double-delivery guard below.
    if (this.opts.assistant !== false) {
      this.assistantHandle = attachAssistant({
        app: this.app,
        sink,
        opts: this.opts.assistant ?? {},
        resolveUser: (id) => this.resolveUser(id),
      });
    }

    attachSlackListener({
      app: this.app,
      store: this.store,
      botUserId: this.botUserId,
      respondTo: resolveSlackRespondToOptions(this.opts.respondTo),
      isAssistantThread: this.assistantHandle?.isAssistantThread,
      onTurn: async (turn) => {
        await sink.onTurn({
          conversationKey: conversationKeyOf(turn.conversation),
          // Carry the sender id so native channel streams can pass
          // `recipient_user_id` to chat.startStream.
          replyTarget: {
            ...turn.replyTarget,
            recipientUserId: turn.senderUserId,
          },
          userText: turn.userText,
          user: turn.senderUserId
            ? await this.resolveUser(turn.senderUserId)
            : undefined,
          // Stable per-delivery id for inbound dedup (Events API event_id, or a
          // fallback derived by the listener); undefined when unavailable.
          eventId: turn.eventId,
          platform: "slack",
        });
      },
      onCommand: async (cmd) => {
        await sink.onCommand({
          command: cmd.command,
          text: cmd.text,
          // Slack delivers args as free text only; structured `rawOptions`
          // are a Discord-style capability, so they're left unset here.
          conversationKey: conversationKeyOf(cmd.conversation),
          replyTarget: cmd.replyTarget,
          user: cmd.senderUserId
            ? await this.resolveUser(cmd.senderUserId)
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
    this.app.action(/.*/, async ({ ack, body }) => {
      await ack();
      // Native feedback-row clicks are handled adapter-locally and never reach
      // the engine's interaction dispatch (which would swallow the unknown id).
      if (this.handleFeedbackClick(body)) return;
      const evt = this.decodeInteraction(body);
      if (evt) await sink.onInteraction(evt);
    });

    this.app.event("reaction_added", async ({ event }) => {
      // Loop guard: Slack delivers reaction events for the bot's OWN reactions
      // (e.g. our addReaction egress), which would echo back as phantom user
      // reactions. Skip them, like every other ingress path guards botUserId.
      if (event.user === this.botUserId) return;
      const evt = decodeReaction(event, true);
      if (!evt) return;
      // Enrich the reactor to parity with onTurn/onCommand so per-user
      // attribution (e.g. senderContext(evt.user) → filter by email) works
      // for reaction-triggered runs, not just mentions and commands.
      if (event.user) evt.user = await this.resolveUser(event.user);
      await sink.onReaction(evt);
    });
    this.app.event("reaction_removed", async ({ event }) => {
      if (event.user === this.botUserId) return;
      const evt = decodeReaction(event, false);
      if (!evt) return;
      if (event.user) evt.user = await this.resolveUser(event.user);
      await sink.onReaction(evt);
    });

    // Modal submit: route to the engine and ack. When the handler returns
    // per-field errors, ack with `response_action: "errors"` (keeps the modal
    // open with inline messages); otherwise a plain ack closes the modal.
    // A catch-all `/.*/` callback_id constraint defaults to `view_submission`.
    this.app.view(/.*/, async ({ ack, body, view }) => {
      const user = body.user?.id
        ? { id: body.user.id, name: body.user.name }
        : undefined;
      const result = await sink.onModalSubmit(decodeViewSubmission(view, user));
      if (result?.errors) {
        await ack({ response_action: "errors", errors: result.errors });
      } else {
        await ack();
      }
    });
    // Modal dismissed (only delivered when the view set `notify_on_close`).
    this.app.view(
      { type: "view_closed", callback_id: /.*/ },
      async ({ ack, body, view }) => {
        const user = body.user?.id
          ? { id: body.user.id, name: body.user.name }
          : undefined;
        await sink.onModalClose(decodeViewClosed(view, user));
        await ack();
      },
    );

    // Socket Mode ignores the port; HTTP mode binds it.
    await this.app.start(this.opts.port ?? 0);
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  render(ir: ChannelNode[]) {
    return renderBlockKit(ir);
  }

  async post(target: BotReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const { blocks, accent } = renderSlackMessage(ir);
    const summary = fallbackText(ir);
    // Suppress Slack link/media unfurling: a card with many links (e.g. an
    // issue_list of Linear URLs) would otherwise spawn a wall of preview
    // attachments. The gen-UI card IS the presentation.
    const base = {
      channel: t.channel,
      thread_ts: t.threadTs,
      unfurl_links: false,
      unfurl_media: false,
      // Short one-line notification/a11y fallback. Slack does NOT render a
      // top-level `text` as the message body when `blocks`/`attachments` are
      // present, so this is safe on both paths.
      text: summary,
    };
    // ACCENT path: render the colored attachment card. The attachment carries
    // ONLY `{ color, blocks }` — adding a legacy `fallback` field alongside
    // `blocks` makes Slack reject the payload with `invalid_attachments`.
    const args: ChatPostMessageArguments = accent
      ? { ...base, attachments: [{ color: accent, blocks }] }
      : { ...base, blocks };
    const res = await this.connector.postMessage(args);
    return { id: res.ts as string, channel: t.channel, ts: res.ts };
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    const channel = channelOf(ref);
    const { blocks, accent } = renderSlackMessage(ir);
    const summary = fallbackText(ir);
    // Mirror `post`'s accent/non-accent split. `chat.update` does not accept
    // the `unfurl_*` flags, so they are only set on `postMessage`.
    const args: ChatUpdateArguments = accent
      ? {
          channel,
          ts: ref.id,
          text: summary,
          attachments: [{ color: accent, blocks }],
        }
      : {
          channel,
          ts: ref.id,
          text: summary,
          blocks,
        };
    await this.connector.updateMessage(args);
  }

  async stream(
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    let firstTs: string | undefined;
    let channel = t.channel;

    // The shipped chat.update streamer — also the automatic fallback for native.
    const makeLegacy = (): TextStream =>
      new ChunkedMessageStream({
        postPlaceholder: async (text) => {
          const posted = await this.connector.postMessage({
            channel: t.channel,
            thread_ts: t.threadTs,
            text,
            unfurl_links: false,
            unfurl_media: false,
          });
          if (!posted.ts) throw new Error("postMessage returned no ts");
          if (!firstTs) {
            firstTs = posted.ts;
            channel = posted.channel ?? t.channel;
          }
          return posted.ts;
        },
        updateAt: async (ts, text) => {
          await this.connector.updateMessage({ channel: t.channel, ts, text });
        },
        transform: (s) => markdownToMrkdwn(autoCloseOpenMarkdown(s)),
      });

    // Native streaming only where a thread exists (Slack requires streams to be
    // thread replies); flat DMs always use the legacy streamer.
    const useNative =
      this.opts.streaming !== "legacy" &&
      !!t.threadTs &&
      this.nativeStreamingOk;

    let sink: TextStream;
    if (useNative) {
      sink = new NativeMessageStream({
        transport: this.nativeTransport(t, (ts, ch) => {
          if (!firstTs) {
            firstTs = ts;
            channel = ch ?? t.channel;
          }
        }),
        fallback: makeLegacy,
        onStartFailure: () => {
          this.nativeStreamingOk = false;
        },
      });
    } else {
      sink = makeLegacy();
    }

    let acc = "";
    for await (const chunk of chunks) {
      acc += chunk;
      sink.append(acc);
    }
    await sink.finish();

    return { id: firstTs ?? "", channel, ts: firstTs };
  }

  /**
   * Build the {@link NativeStreamTransport} (chat.startStream/appendStream/
   * stopStream) for a thread target. `onFirstTs` records the first streamed
   * message's ts/channel for the returned MessageRef. Native channel streams
   * pass `recipient_user_id` (the turn sender) + `recipient_team_id`.
   */
  private nativeTransport(
    t: ReplyTarget,
    onFirstTs: (ts: string, channel?: string) => void,
  ): NativeStreamTransport {
    const threadTs = t.threadTs;
    if (!threadTs) {
      // Native streaming is only wired up where a thread exists (Slack requires
      // streams to be thread replies); the callers gate on this already.
      throw new Error("native streaming requires a thread_ts");
    }
    // `recipient_user_id` / `recipient_team_id` are required when streaming to a
    // channel and implicit in DMs / assistant threads — pass them only for
    // non-DM targets (DM channel ids start with "D").
    const isChannel = !t.channel.startsWith("D");
    return {
      startStream: async () => {
        const args: ChatStartStreamArguments = {
          channel: t.channel,
          thread_ts: threadTs,
          task_display_mode: "timeline",
          ...(isChannel && t.recipientUserId
            ? { recipient_user_id: t.recipientUserId }
            : {}),
          ...(isChannel && this.teamId
            ? { recipient_team_id: this.teamId }
            : {}),
        };
        const res = await this.connector.startStream(args);
        if (!res.ts) throw new Error("startStream returned no ts");
        onFirstTs(res.ts, res.channel);
        return res.ts;
      },
      appendText: async (ts, markdownText) => {
        const args: ChatAppendStreamArguments = {
          channel: t.channel,
          ts,
          markdown_text: markdownText,
        };
        await this.connector.appendStream(args);
      },
      appendChunks: async (ts, chunks: AnyChunk[]) => {
        const args: ChatAppendStreamArguments = {
          channel: t.channel,
          ts,
          chunks,
        };
        await this.connector.appendStream(args);
      },
      stopStream: async (ts, finalBlocks?: KnownBlock[]) => {
        const args: ChatStopStreamArguments = {
          channel: t.channel,
          ts,
          ...(finalBlocks && finalBlocks.length > 0
            ? { blocks: finalBlocks }
            : {}),
        };
        await this.connector.stopStream(args);
      },
    };
  }

  /**
   * The credentialed {@link SlackRenderTransport} the run renderer calls
   * (setStatus / postMessage / update), wrapping this adapter's `WebClient`.
   * Extracted so `createRunRenderer` stays Bolt-free and the managed Connector
   * Outbox can drive the identical renderer with its own sender.
   */
  private renderTransport(): SlackRenderTransport {
    return {
      setStatus: async (a) => {
        await this.connector.setStatus(a);
      },
      postMessage: async (a) => {
        const res = await this.connector.postMessage(
          a as ChatPostMessageArguments,
        );
        return { ts: res.ts };
      },
      updateMessage: async (a) => {
        await this.connector.updateMessage(a as ChatUpdateArguments);
      },
    };
  }

  /**
   * Route a `feedback_buttons` click to the configured feedback callback.
   * Returns `true` if this was a feedback click (so the caller skips the
   * engine's interaction dispatch). Best-effort: payload-shape or handler
   * errors are logged, never thrown.
   */
  private handleFeedbackClick(raw: unknown): boolean {
    const feedback = this.opts.feedback;
    if (!feedback) return false;
    const body = raw as {
      actions?: Array<{ action_id?: string; value?: string }>;
      user?: { id?: string; name?: string; username?: string };
      channel?: { id?: string };
      container?: { channel_id?: string };
      message?: { ts?: string; thread_ts?: string };
    };
    const action = body.actions?.[0];
    if (action?.action_id !== FEEDBACK_ACTION_ID) return false;
    const sentiment = action.value === "negative" ? "negative" : "positive";
    const channel = body.channel?.id ?? body.container?.channel_id;
    const messageTs = body.message?.ts;
    if (!channel || !messageTs) {
      // It's a feedback click (so we still swallow it rather than forwarding to
      // the engine), but the payload lacked the refs the handler needs.
      console.warn(
        "[slack-adapter] feedback click missing channel/message ts; ignoring",
      );
      return true;
    }
    void Promise.resolve(
      feedback.onFeedback({
        sentiment,
        channel,
        messageTs,
        threadTs: body.message?.thread_ts,
        user: body.user?.id
          ? { id: body.user.id, name: body.user.name ?? body.user.username }
          : undefined,
      }),
    ).catch((err) =>
      console.error("[slack-adapter] onFeedback handler failed:", err),
    );
    return true;
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.connector.deleteMessage({ channel: channelOf(ref), ts: ref.id });
  }

  /**
   * True if `target` is a known assistant-pane thread (recorded by the
   * Assistant middleware). Pane targets drive native status and back the
   * pane-only `setSuggestedPrompts` / `setThreadTitle` methods.
   */
  private isPaneTarget(
    t: ReplyTarget,
  ): t is ReplyTarget & { threadTs: string } {
    return Boolean(
      t.threadTs &&
      this.assistantHandle?.isAssistantThread(t.channel, t.threadTs),
    );
  }

  createRunRenderer(target: BotReplyTarget): RunRenderer {
    const t = target as ReplyTarget;
    const assistantOpts: SlackAssistantOptions | undefined =
      this.opts.assistant === false ? undefined : (this.opts.assistant ?? {});
    const isPane = this.isPaneTarget(t);
    // Native `setStatus` ("is thinking…") works for any thread we can anchor it
    // to — pane, channel @-mention, tracked channel thread, or (via the carried
    // inbound ts) a flat DM. `assistant: false` opts out everywhere.
    const statusThreadTs = t.threadTs ?? t.statusTs;
    const status =
      assistantOpts && statusThreadTs
        ? {
            threadTs: statusThreadTs,
            isPane,
            config: assistantOpts.status ?? {},
          }
        : undefined;
    // Native streaming wherever a thread exists (and the workspace supports it).
    const useNative =
      this.opts.streaming !== "legacy" &&
      !!t.threadTs &&
      this.nativeStreamingOk;
    return createRunRenderer({
      transport: this.renderTransport(),
      target: t,
      interruptEventNames: this.opts.interruptEventNames,
      showToolStatus: this.opts.showToolStatus,
      status,
      nativeStreaming: useNative
        ? {
            transport: this.nativeTransport(t, () => {}),
            onStartFailure: () => {
              this.nativeStreamingOk = false;
            },
            // Pane threads keep composer status for tool progress; elsewhere
            // surface it as in-message task_update chunks (when supported).
            taskChunks: !isPane && this.nativeTaskChunksOk,
            onChunkFailure: () => {
              this.nativeTaskChunksOk = false;
            },
          }
        : undefined,
      // Native AI feedback row (opt-in); only attached to native streamed
      // replies, so omit it on the legacy path.
      feedbackBlocks:
        useNative && this.opts.feedback
          ? buildFeedbackBlocks({
              positiveLabel: this.opts.feedback.positiveLabel,
              negativeLabel: this.opts.feedback.negativeLabel,
            })
          : undefined,
    });
  }

  /** Backs the capability-gated `Thread.setSuggestedPrompts` for pane threads. */
  async setSuggestedPrompts(
    target: BotReplyTarget,
    prompts: ReadonlyArray<{ title: string; message: string }>,
    opts?: { title?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const t = target as ReplyTarget;
    if (!this.isPaneTarget(t)) {
      return {
        ok: false,
        error: "suggested prompts require an assistant-pane thread",
      };
    }
    try {
      await this.connector.setSuggestedPrompts({
        channel_id: t.channel,
        thread_ts: t.threadTs,
        prompts: prompts.map((p) => ({
          title: p.title,
          message: p.message,
        })) as [
          { title: string; message: string },
          ...{ title: string; message: string }[],
        ],
        ...(opts?.title ? { title: opts.title } : {}),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Backs the capability-gated `Thread.setTitle` for pane threads. */
  async setThreadTitle(
    target: BotReplyTarget,
    title: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const t = target as ReplyTarget;
    if (!this.isPaneTarget(t)) {
      return {
        ok: false,
        error: "thread title requires an assistant-pane thread",
      };
    }
    try {
      await this.connector.setThreadTitle({
        channel_id: t.channel,
        thread_ts: t.threadTs,
        title,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return decodeInteraction(raw);
  }

  async lookupUser(q: UserQuery): Promise<PlatformUser | undefined> {
    const query = q.query.trim().toLowerCase();
    if (!query) return undefined;
    try {
      let cursor: string | undefined;
      do {
        const r = await this.connector.listUsers({ cursor, limit: 200 });
        for (const m of r.members ?? []) {
          if (!m.id || m.deleted || m.is_bot) continue;
          const candidates = [
            m.name,
            m.real_name,
            m.profile?.display_name,
            m.profile?.email,
          ]
            .filter((s): s is string => Boolean(s))
            .map((s) => s.toLowerCase());
          if (candidates.some((c) => c === query || c.startsWith(query))) {
            return {
              id: m.id,
              name: m.real_name ?? m.name,
              handle: m.name,
              email: m.profile?.email,
            };
          }
        }
        cursor = r.response_metadata?.next_cursor || undefined;
      } while (cursor);
    } catch {
      return undefined;
    }
    return undefined;
  }

  /**
   * Resolve a Slack user id to a richer `PlatformUser` (name + email) for each
   * turn, cached by id so repeat turns in the same conversation are cheap.
   * Tolerates lookup failure by falling back to a bare `{ id }`.
   */
  async resolveUser(userId: string): Promise<PlatformUser> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    let user: PlatformUser = { id: userId };
    try {
      const r = await this.connector.getUserInfo({ user: userId });
      const u = r.user;
      if (u?.id) {
        user = {
          id: u.id,
          name:
            u.real_name ??
            u.profile?.real_name ??
            u.profile?.display_name ??
            u.name,
          email: u.profile?.email,
        };
      }
    } catch {
      // Fall back to the bare id on any lookup failure.
    }
    this.userCache.set(userId, user);
    return user;
  }

  get conversationStore(): ConversationStore {
    const store = this.store;
    return {
      async getOrCreate(
        conversationKey: string,
        replyTarget: BotReplyTarget,
        makeAgent: (threadId: string) => AbstractAgent,
      ): Promise<AgentSession> {
        const idx = conversationKey.indexOf("::");
        const channelId =
          idx >= 0 ? conversationKey.slice(0, idx) : conversationKey;
        const scope = idx >= 0 ? conversationKey.slice(idx + 2) : DM_SCOPE;
        const key: ConversationKey = { channelId, scope };
        const session = await store.getOrCreate(
          key,
          replyTarget as ReplyTarget,
          makeAgent as unknown as Parameters<
            SlackConversationStore["getOrCreate"]
          >[2],
        );
        return { agent: session.agent as unknown as AbstractAgent };
      },
    };
  }

  /**
   * Read the conversation's recent messages. Backs the capability-gated
   * `Thread.getMessages()`. For a thread target we read its replies; a flat
   * target (DM, no `threadTs`) has no thread to fetch, so we return `[]`.
   * Capped defensively to the last 100 messages.
   */
  async getMessages(target: BotReplyTarget): Promise<ThreadMessage[]> {
    const t = target as ReplyTarget;
    const threadTs = t.threadTs;
    if (!threadTs) return [];
    let messages: Array<{
      text?: string;
      ts?: string;
      user?: string;
      bot_id?: string;
      subtype?: string;
    }> = [];
    try {
      const r = await this.connector.getReplies({
        channel: t.channel,
        ts: threadTs,
        limit: 100,
      });
      messages = r.messages ?? [];
    } catch {
      return [];
    }
    const out: ThreadMessage[] = [];
    for (const m of messages.slice(-100)) {
      // Skip Slack's own join/system subtype messages; keep regular messages
      // and file shares.
      if (m.subtype && m.subtype !== "file_share") continue;
      out.push({
        text: m.text ?? "",
        ts: m.ts,
        isBot: Boolean(m.bot_id),
        user: m.user ? await this.resolveUser(m.user) : undefined,
      });
    }
    return out;
  }

  async postFile(
    target: BotReplyTarget,
    {
      bytes,
      filename,
      title,
      altText,
    }: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const t = target as ReplyTarget;
    try {
      // Slack's `FilesUploadV2Arguments` union types `thread_ts` as a
      // required `string` when present; omit the key entirely (rather
      // than passing `undefined`) under exactOptionalPropertyTypes.
      const args: Record<string, unknown> = {
        channel_id: t.channel,
        file: Buffer.from(bytes),
        filename,
        title,
        alt_text: altText,
      };
      if (t.threadTs) args.thread_ts = t.threadTs;
      await this.connector.uploadFile(
        args as unknown as FilesUploadV2Arguments,
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async addReaction(
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const name = toPlatformEmoji(emoji, "slack") ?? emoji;
    const channel =
      (messageRef as { channel?: string }).channel ??
      (target as ReplyTarget).channel;
    try {
      await this.connector.addReaction({
        channel,
        timestamp: messageRef.id,
        name,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async removeReaction(
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const name = toPlatformEmoji(emoji, "slack") ?? emoji;
    const channel =
      (messageRef as { channel?: string }).channel ??
      (target as ReplyTarget).channel;
    try {
      await this.connector.removeReaction({
        channel,
        timestamp: messageRef.id,
        name,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Post an ephemeral message visible only to `user`. Slack always supports
   * native ephemeral, so `fallbackToDM` is ignored and `usedFallback` is
   * always `false` on success. On API error returns `{ ok: false, error }`.
   */
  async postEphemeral(
    target: BotReplyTarget,
    user: PlatformUser | string,
    ir: ChannelNode[],
    _opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null> {
    const t = target as ReplyTarget;
    const userId = typeof user === "string" ? user : user.id;
    const { blocks } = renderSlackMessage(ir);
    const text = fallbackText(ir);
    try {
      const res = await this.connector.postEphemeral({
        channel: t.channel,
        user: userId,
        ...(t.threadTs ? { thread_ts: t.threadTs } : {}),
        blocks,
        text,
      });
      return {
        ok: true,
        usedFallback: false,
        ref: {
          id: res.message_ts ?? "",
          channel: t.channel,
        },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Render a modal IR tree to a Slack `views.open` `View` (pure; backs `openModal`). */
  renderModal(ir: ChannelNode[]): NativePayload {
    return renderSlackModal(ir);
  }

  /**
   * Open a modal against a Slack `trigger_id` via `views.open`. Degrades rather
   * than throwing: a render error (unsupported element) or API failure (expired
   * trigger, etc.) resolves to `{ ok: false, error }`.
   */
  async openModal(
    target: BotReplyTarget,
    triggerId: string,
    ir: ChannelNode[],
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const t = target as ReplyTarget;
      const view = renderSlackModal(ir);
      // Slack `view_submission`/`view_closed` payloads are detached from the
      // originating channel, so private_metadata is the only carrier of the
      // conversation context. Stamp a `__cpk` envelope with the reply target,
      // preserving any author-set private_metadata under `pm` for round-trip.
      view.private_metadata = JSON.stringify({
        __cpk: {
          channel: t.channel,
          ...(t.threadTs ? { threadTs: t.threadTs } : {}),
        },
        ...(view.private_metadata !== undefined
          ? { pm: view.private_metadata }
          : {}),
      });
      await this.connector.openModal({
        trigger_id: triggerId,
        view,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

/** Construct a Slack `PlatformAdapter`. */
export function slack(opts: SlackAdapterOptions): SlackAdapter {
  return new SlackAdapter(opts);
}

/** Read the channel stashed on a MessageRef by `post`/`stream`. */
function channelOf(ref: MessageRef): string {
  const channel = (ref as { channel?: unknown }).channel;
  return typeof channel === "string" ? channel : "";
}

/** Collect a node's descendant text into a single whitespace-joined string. */
function collectNodeText(node: ChannelNode): string {
  const acc: string[] = [];
  const visit = (n: ChannelNode): void => {
    if (typeof n.type === "string" && n.type === "text") {
      const value = n.props?.value;
      if (value != null) acc.push(String(value));
      return;
    }
    const children = n.props?.children;
    const list = Array.isArray(children)
      ? children
      : children && typeof children === "object" && "type" in children
        ? [children]
        : [];
    for (const child of list as ChannelNode[]) visit(child);
  };
  visit(node);
  return acc.join(" ");
}

/** Depth-first search for the first node of `type` in the IR tree. */
function findFirst(ir: ChannelNode[], type: string): ChannelNode | undefined {
  for (const node of ir) {
    if (typeof node.type === "string" && node.type === type) return node;
    const children = node.props?.children;
    const list = Array.isArray(children)
      ? children
      : children && typeof children === "object" && "type" in children
        ? [children]
        : [];
    const found = findFirst(list as ChannelNode[], type);
    if (found) return found;
  }
  return undefined;
}

/**
 * Slack requires a plain-text `text` fallback alongside `blocks`/`attachments`
 * (used for notifications and a11y) — NOT a rendering of the card body. Return
 * a concise one-line summary: the card's header (title) if present, else the
 * first text encountered. Collapse whitespace and truncate to ~150 chars. This
 * MUST stay short: it is the notification text, never a dump of the whole tree
 * (which Slack would render as a duplicate "text wall" above the card).
 */
function fallbackText(ir: ChannelNode[]): string {
  const header = findFirst(ir, "header");
  const source = header ? collectNodeText(header) : firstText(ir);
  const text = source.replace(/\s+/g, " ").trim();
  if (!text) return "…";
  return text.length > 150 ? text.slice(0, 149) + "…" : text;
}

/** First descendant text node's value across the whole IR, or "". */
function firstText(ir: ChannelNode[]): string {
  for (const node of ir) {
    const t = collectNodeText(node);
    if (t.trim()) return t;
  }
  return "";
}
