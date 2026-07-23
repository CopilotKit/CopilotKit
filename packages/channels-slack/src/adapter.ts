import { LogLevel } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type {
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
  ChannelEgress,
  ProviderEffect,
  EffectResultFor,
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
import type {
  SlackConnector,
  SlackIngressLogLevel,
} from "./slack-connector.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction } from "./interaction.js";
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
  /**
   * The connector instance `start()` handed ingress ownership to — kept
   * distinct from the throwaway `connector` getter (below) so `stop()` tears
   * down the SAME live Bolt `App`/socket `start()` built, not a fresh wrapper.
   */
  private ingressConnector: SlackConnector | undefined;
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
    // The Bolt `App`/socket now lives in the connector (Task 3b) — start()
    // hands it ownership. Construction here only needs a plain credentialed
    // `WebClient` for egress, equivalent to what `App.client` used to expose
    // (same token, same `logLevel`-only clientOptions; no custom `agent`/
    // `logger` was ever passed, so this is a faithful stand-in).
    this.client = new WebClient(opts.botToken, {
      logLevel: opts.logLevel ?? LogLevel.INFO,
    });
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
   * runner-supplied connector instead) is a later unit. The per-access
   * allocation is a DELIBERATE throwaway — `WebClientSlackConnector` is a
   * stateless facade over the stable `this.client`, so re-wrapping it is
   * free, not an oversight.
   */
  private get connector(): SlackConnector {
    return this.connectorOverride ?? new WebClientSlackConnector(this.client);
  }

  /**
   * The declarative egress entry point (Channel Runner plan §2, design D2:
   * "adapter owns the effect→native mapping"): renders IR via the adapter's
   * own `render()`/Block Kit logic and routes every op to a RUNNER-supplied
   * `connector` instead of this adapter's internal one — driving the exact
   * same native Slack calls the `PlatformAdapter` methods below build, just
   * against a different credentialed sender (e.g. the Intelligence Connector
   * Outbox). Every op here is a thin call into the SAME `*Via(connector, …)`
   * helper the `PlatformAdapter` method (via `this.connector`) also calls —
   * one egress implementation, two entry points.
   */
  makeEgress(connector: SlackConnector): ChannelEgress {
    return {
      send: async <E extends ProviderEffect>(
        effect: E,
      ): Promise<EffectResultFor<E>> => {
        switch (effect.op) {
          case "post":
            return (await this.postVia(
              connector,
              effect.target,
              effect.ir,
            )) as EffectResultFor<E>;
          case "update":
            await this.updateVia(connector, effect.ref, effect.ir);
            return effect.ref as EffectResultFor<E>;
          case "delete":
            await this.deleteVia(connector, effect.ref);
            return undefined as EffectResultFor<E>;
          case "react":
            return (await (effect.add
              ? this.addReactionVia(
                  connector,
                  effect.target,
                  effect.ref,
                  effect.emoji,
                )
              : this.removeReactionVia(
                  connector,
                  effect.target,
                  effect.ref,
                  effect.emoji,
                ))) as EffectResultFor<E>;
          case "ephemeral":
            return (await this.postEphemeralVia(
              connector,
              effect.target,
              effect.user,
              effect.ir,
              { fallbackToDM: effect.fallbackToDM },
            )) as EffectResultFor<E>;
          case "file":
            return (await this.postFileVia(
              connector,
              effect.target,
              effect.file,
            )) as EffectResultFor<E>;
          case "suggested":
            return (await this.setSuggestedPromptsVia(
              connector,
              effect.target,
              effect.prompts,
              effect.title !== undefined ? { title: effect.title } : undefined,
            )) as EffectResultFor<E>;
          case "title":
            return (await this.setThreadTitleVia(
              connector,
              effect.target,
              effect.title,
            )) as EffectResultFor<E>;
        }
      },
      stream: (target, chunks) => this.streamVia(connector, target, chunks),
      createRunRenderer: (target) =>
        this.createRunRendererVia(connector, target),
      getMessages: (target) => this.getMessagesVia(connector, target),
      lookupUser: (q) => this.lookupUserVia(connector, q),
    };
  }

  /**
   * Delegates ALL ingress ownership to `this.connector` (Task 3b, plan §2
   * D3): the Bolt `App`/socket, `app.init()`/`auth.test()`, and every raw
   * event subscription (slash commands, app_mention/message, block_actions,
   * reaction_added/removed, view submit/close, the assistant-pane
   * middleware) now live in `WebClientSlackConnector.startIngress` — this
   * method only resolves the ADAPTER-side config (still Bolt-free: tokens,
   * resolved `respondTo`, the `resolveUser`/`handleFeedbackClick` callbacks
   * whose decision logic stays here) and applies the connection facts the
   * connector hands back. Token removal + relocating this method off the
   * adapter entirely is a later unit (T3s-4 / A1).
   */
  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;

    const connector = this.connector;
    this.ingressConnector = connector;
    const conn = await connector.startIngress({
      botToken: this.opts.botToken,
      appToken: this.opts.appToken,
      signingSecret: this.opts.signingSecret,
      socketMode: this.opts.socketMode,
      port: this.opts.port,
      logLevel: this.opts.logLevel as SlackIngressLogLevel | undefined,
      sink,
      respondTo: resolveSlackRespondToOptions(this.opts.respondTo),
      assistant: this.opts.assistant,
      resolveUser: (id) => this.resolveUser(id),
      handleFeedbackClick: (raw) => this.handleFeedbackClick(raw),
    });

    this.botUserId = conn.botUserId;
    this.teamId = conn.teamId;
    (this.store as unknown as { botUserId: string }).botUserId = this.botUserId;
    this.assistantHandle = conn.assistantHandle;
  }

  async stop(): Promise<void> {
    await this.ingressConnector?.stopIngress();
  }

  render(ir: ChannelNode[]) {
    return renderBlockKit(ir);
  }

  async post(target: BotReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    return this.postVia(this.connector, target, ir);
  }

  /**
   * `post`'s connector-parameterized body. Shared by the `PlatformAdapter`
   * method (via `this.connector`) and `makeEgress` (via an injected
   * connector) so there is exactly one implementation of the effect→native
   * mapping.
   */
  private async postVia(
    connector: SlackConnector,
    target: BotReplyTarget,
    ir: ChannelNode[],
  ): Promise<MessageRef> {
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
    const res = await connector.postMessage(args);
    return { id: res.ts as string, channel: t.channel, ts: res.ts };
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    return this.updateVia(this.connector, ref, ir);
  }

  /** `update`'s connector-parameterized body (see {@link postVia}). */
  private async updateVia(
    connector: SlackConnector,
    ref: MessageRef,
    ir: ChannelNode[],
  ): Promise<void> {
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
    await connector.updateMessage(args);
  }

  async stream(
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    return this.streamVia(this.connector, target, chunks);
  }

  /** `stream`'s connector-parameterized body (see {@link postVia}). */
  private async streamVia(
    connector: SlackConnector,
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
          const posted = await connector.postMessage({
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
          await connector.updateMessage({ channel: t.channel, ts, text });
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
        transport: this.nativeTransportVia(connector, t, (ts, ch) => {
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
   * stopStream) for a thread target, driven by the given connector. `onFirstTs`
   * records the first streamed message's ts/channel for the returned MessageRef.
   * Native channel streams pass `recipient_user_id` (the turn sender) +
   * `recipient_team_id`. The managed Connector Outbox / a custom runner supply
   * their own connector here (see {@link makeEgress}).
   */
  private nativeTransportVia(
    connector: SlackConnector,
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
        const res = await connector.startStream(args);
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
        await connector.appendStream(args);
      },
      appendChunks: async (ts, chunks: AnyChunk[]) => {
        const args: ChatAppendStreamArguments = {
          channel: t.channel,
          ts,
          chunks,
        };
        await connector.appendStream(args);
      },
      stopStream: async (ts, finalBlocks?: KnownBlock[]) => {
        const args: ChatStopStreamArguments = {
          channel: t.channel,
          ts,
          ...(finalBlocks && finalBlocks.length > 0
            ? { blocks: finalBlocks }
            : {}),
        };
        await connector.stopStream(args);
      },
    };
  }

  /**
   * The credentialed {@link SlackRenderTransport} the run renderer calls
   * (setStatus / postMessage / update), driven by the given connector. Keeps
   * `createRunRenderer` Bolt-free so the managed Connector Outbox / a custom
   * runner can drive the identical renderer with their own sender (see
   * {@link makeEgress}).
   */
  private renderTransportVia(connector: SlackConnector): SlackRenderTransport {
    return {
      setStatus: async (a) => {
        await connector.setStatus(a);
      },
      postMessage: async (a) => {
        const res = await connector.postMessage(a as ChatPostMessageArguments);
        return { ts: res.ts };
      },
      updateMessage: async (a) => {
        await connector.updateMessage(a as ChatUpdateArguments);
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
    return this.deleteVia(this.connector, ref);
  }

  /** `delete`'s connector-parameterized body (see {@link postVia}). */
  private async deleteVia(
    connector: SlackConnector,
    ref: MessageRef,
  ): Promise<void> {
    await connector.deleteMessage({ channel: channelOf(ref), ts: ref.id });
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
    return this.createRunRendererVia(this.connector, target);
  }

  /** `createRunRenderer`'s connector-parameterized body (see {@link postVia}). */
  private createRunRendererVia(
    connector: SlackConnector,
    target: BotReplyTarget,
  ): RunRenderer {
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
      transport: this.renderTransportVia(connector),
      target: t,
      interruptEventNames: this.opts.interruptEventNames,
      showToolStatus: this.opts.showToolStatus,
      status,
      nativeStreaming: useNative
        ? {
            transport: this.nativeTransportVia(connector, t, () => {}),
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
    return this.setSuggestedPromptsVia(this.connector, target, prompts, opts);
  }

  /** `setSuggestedPrompts`'s connector-parameterized body (see {@link postVia}). */
  private async setSuggestedPromptsVia(
    connector: SlackConnector,
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
      await connector.setSuggestedPrompts({
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
    return this.setThreadTitleVia(this.connector, target, title);
  }

  /** `setThreadTitle`'s connector-parameterized body (see {@link postVia}). */
  private async setThreadTitleVia(
    connector: SlackConnector,
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
      await connector.setThreadTitle({
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
    return this.lookupUserVia(this.connector, q);
  }

  /** `lookupUser`'s connector-parameterized body (see {@link postVia}). */
  private async lookupUserVia(
    connector: SlackConnector,
    q: UserQuery,
  ): Promise<PlatformUser | undefined> {
    const query = q.query.trim().toLowerCase();
    if (!query) return undefined;
    try {
      let cursor: string | undefined;
      do {
        const r = await connector.listUsers({ cursor, limit: 200 });
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
    return this.resolveUserVia(this.connector, userId);
  }

  /**
   * `resolveUser`'s connector-parameterized body (see {@link postVia}).
   * `getMessagesVia` calls this with its own injected connector (rather than
   * `resolveUser`/`this.connector`) so history reads via `makeEgress` never
   * fall through to the adapter's internal connector for user enrichment.
   * The id→PlatformUser cache is shared across connectors — it's keyed only
   * by Slack user id, which is connector-independent.
   */
  private async resolveUserVia(
    connector: SlackConnector,
    userId: string,
  ): Promise<PlatformUser> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    let user: PlatformUser = { id: userId };
    try {
      const r = await connector.getUserInfo({ user: userId });
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
    return this.getMessagesVia(this.connector, target);
  }

  /** `getMessages`'s connector-parameterized body (see {@link postVia}). */
  private async getMessagesVia(
    connector: SlackConnector,
    target: BotReplyTarget,
  ): Promise<ThreadMessage[]> {
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
      const r = await connector.getReplies({
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
        user: m.user ? await this.resolveUserVia(connector, m.user) : undefined,
      });
    }
    return out;
  }

  async postFile(
    target: BotReplyTarget,
    file: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    return this.postFileVia(this.connector, target, file);
  }

  /** `postFile`'s connector-parameterized body (see {@link postVia}). */
  private async postFileVia(
    connector: SlackConnector,
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
      await connector.uploadFile(args as unknown as FilesUploadV2Arguments);
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
    return this.addReactionVia(this.connector, target, messageRef, emoji);
  }

  /** `addReaction`'s connector-parameterized body (see {@link postVia}). */
  private async addReactionVia(
    connector: SlackConnector,
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const name = toPlatformEmoji(emoji, "slack") ?? emoji;
    const channel =
      (messageRef as { channel?: string }).channel ??
      (target as ReplyTarget).channel;
    try {
      await connector.addReaction({
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
    return this.removeReactionVia(this.connector, target, messageRef, emoji);
  }

  /** `removeReaction`'s connector-parameterized body (see {@link postVia}). */
  private async removeReactionVia(
    connector: SlackConnector,
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const name = toPlatformEmoji(emoji, "slack") ?? emoji;
    const channel =
      (messageRef as { channel?: string }).channel ??
      (target as ReplyTarget).channel;
    try {
      await connector.removeReaction({
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
    opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null> {
    return this.postEphemeralVia(this.connector, target, user, ir, opts);
  }

  /** `postEphemeral`'s connector-parameterized body (see {@link postVia}). */
  private async postEphemeralVia(
    connector: SlackConnector,
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
      const res = await connector.postEphemeral({
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
