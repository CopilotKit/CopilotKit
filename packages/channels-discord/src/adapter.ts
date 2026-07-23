import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  InteractionEvent,
  RunRenderer,
  ReplyTarget as BotReplyTarget,
  ConversationStore,
  MessageRef,
  PlatformUser,
  UserQuery,
  CommandSpec,
  NativePayload,
  ChannelEgress,
  ProviderEffect,
  EffectResultFor,
} from "@copilotkit/channels-core";
import type {
  ChannelNode,
  ThreadMessage,
  EmojiValue,
  EphemeralResult,
} from "@copilotkit/channels-ui";
import { toPlatformEmoji } from "@copilotkit/channels-ui";
import { DiscordConversationStore } from "./conversation-store.js";
import type { DiscordHistoryMessage } from "./conversation-store.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction } from "./interaction.js";
import {
  renderComponents,
  renderDiscordMessage,
} from "./render/components-v2.js";
import { renderDiscordModal } from "./render/modal.js";
import {
  ChunkedMessageStream,
  STREAM_PLACEHOLDERS,
} from "./chunked-message-stream.js";
import { discordMarkdown } from "./markdown.js";
import { autoCloseOpenMarkdown } from "./auto-close-streaming.js";
import type { ReplyTarget } from "./types.js";
import type {
  DiscordConnector,
  DiscordSendPayload,
} from "./discord-connector.js";

/**
 * Discord adapter config — CREDENTIAL-FREE (mirrors `SlackAdapterOptions`).
 * The adapter builds nothing from tokens; it only renders and decides. Every
 * credential (`botToken`/`appId`/`guildId`) now lives on
 * {@link WebClientDiscordConnectorOptions} instead — a runner constructs that
 * connector and injects it via `DiscordAdapter.ɵbindConnector` before
 * `start()`/any egress call. Running the adapter unbound throws (see the
 * `connector` getter below) — that's the intended "you need a custom
 * ChannelRunner" signpost for running Channels without CopilotKit
 * Intelligence.
 */
export interface DiscordAdapterOptions {
  interruptEventNames?: ReadonlySet<string>;
}

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = "discord";
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: true,
    supportsTyping: true,
    supportsReactions: true,
    supportsEphemeral: false, // ephemeral only via interaction reply / DM fallback
    supportsStreaming: true,
    maxBlocksPerMessage: 40,
  };
  readonly ackDeadlineMs = 3000;

  /**
   * The runner-injected {@link DiscordConnector} — set exactly once, via
   * {@link ɵbindConnector}, before `start()`/any egress call. The adapter
   * holds NO credentials and builds nothing from tokens; every credentialed
   * operation routes through this connector. `undefined` until bound — the
   * `connector` getter throws a clear error if anything runs unbound.
   */
  private boundConnector: DiscordConnector | undefined;
  private botUserId = "";
  /**
   * Lazily built on first access (after `ɵbindConnector`) and cached for the
   * adapter's lifetime so its per-turn history reconstruction has a stable
   * home.
   */
  private storeCache: DiscordConversationStore | undefined;
  private readonly userCache = new Map<string, PlatformUser>();

  constructor(private readonly opts: DiscordAdapterOptions = {}) {
    // Credential-free construction: nothing token-shaped is built here. The
    // Gateway `Client`/socket AND the egress `REST` client now both live
    // inside a runner-injected `DiscordConnector` (see `ɵbindConnector`).
  }

  /**
   * @internal Connector-injection seam. A runner (a custom `ChannelRunner`, or
   * the managed Connector Outbox's own binding path) calls this with a
   * credential-owning `DiscordConnector` — typically a `new
   * WebClientDiscordConnector({ botToken, appId, guildId, … })` — BEFORE
   * `start()` or any egress method runs. Every `PlatformAdapter` method this
   * class implements delegates to the bound connector; there is no
   * adapter-owned fallback. Marked with the ɵ prefix (Angular-style
   * internal-API marker) to signal this is plumbing for a runner, not a
   * user-facing option.
   */
  ɵbindConnector(connector: DiscordConnector): void {
    this.boundConnector = connector;
  }

  /**
   * The credentialed {@link DiscordConnector} every egress method routes
   * through — the one bound via {@link ɵbindConnector}. Throws if the
   * adapter is run unbound: running Channels without CopilotKit Intelligence
   * requires a custom `ChannelRunner` that supplies a connector (see docs).
   */
  private get connector(): DiscordConnector {
    if (!this.boundConnector) {
      throw new Error(
        "Discord channel has no connector: running Channels without CopilotKit " +
          "Intelligence requires a custom ChannelRunner that supplies a " +
          "DiscordConnector (see docs).",
      );
    }
    return this.boundConnector;
  }

  /** The `DiscordConversationStore`, built once (lazily) from the bound connector. */
  private get store(): DiscordConversationStore {
    if (!this.storeCache) {
      this.storeCache = new DiscordConversationStore({
        fetchHistory: (channelId) => this.fetchHistory(channelId),
        botUserId: () => this.botUserId,
        filesConfig: undefined,
      });
    }
    return this.storeCache;
  }

  registerCommands(commands: readonly CommandSpec[]): void {
    this.connector.registerCommands(commands);
  }

  /**
   * Delegates ALL ingress ownership to `this.connector`: the Gateway
   * `Client`/socket, `login()`, and every raw event subscription (messageCreate,
   * interactionCreate — commands/components/modals —, reactions) live in the
   * connector's `startIngress` — this method only resolves the ADAPTER-side
   * `resolveUser` callback (whose decision logic — the sender cache — stays
   * here) and applies the connection facts the connector hands back. Throws
   * (via the `connector` getter) if no connector has been bound via
   * `ɵbindConnector`.
   */
  async start(sink: IngressSink): Promise<void> {
    const connector = this.connector; // throws if unbound
    const conn = await connector.startIngress({
      sink,
      resolveUser: (id) => this.resolveUser(id),
    });
    this.botUserId = conn.botUserId;
  }

  async stop(): Promise<void> {
    // Lenient (not the throwing `connector` getter): stopping an adapter that
    // was never bound/started is a harmless no-op, not a signpost-worthy error.
    await this.boundConnector?.stopIngress();
  }

  render(ir: ChannelNode[]) {
    return renderComponents(ir);
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
    connector: DiscordConnector,
    target: BotReplyTarget,
    ir: ChannelNode[],
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const { components, flags } = renderDiscordMessage(ir);
    const msg = await connector.sendMessage(t.channelId, { components, flags });
    return { id: msg.id, channelId: t.channelId };
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    return this.updateVia(this.connector, ref, ir);
  }

  /** `update`'s connector-parameterized body (see {@link postVia}). */
  private async updateVia(
    connector: DiscordConnector,
    ref: MessageRef,
    ir: ChannelNode[],
  ): Promise<void> {
    // An empty stream returns a ref with id "" (no message was ever posted);
    // an edit on it would throw, so treat update on it as a no-op.
    if (!ref.id) return;
    const { components, flags } = renderDiscordMessage(ir);
    await connector.editMessage(this.channelIdOf(ref), ref.id, {
      components,
      flags,
    });
  }

  async stream(
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    return this.streamVia(this.connector, target, chunks);
  }

  /** `stream`'s connector-parameterized body (see {@link postVia}). */
  private async streamVia(
    connector: DiscordConnector,
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    let firstId = "";
    const stream = new ChunkedMessageStream({
      postPlaceholder: async (text) => {
        const m = await connector.sendMessage(t.channelId, text);
        if (!firstId) firstId = m.id;
        return m.id;
      },
      updateAt: async (id, text) => {
        await connector.editMessage(t.channelId, id, text);
      },
      transform: (s) => discordMarkdown(autoCloseOpenMarkdown(s)),
    });
    let acc = "";
    // If the source iterable rejects partway, `finish()` must still run so the
    // already-posted "_thinking…_" placeholder gets drained to its accumulated
    // text instead of being frozen forever; then let the original error
    // propagate.
    try {
      for await (const chunk of chunks) {
        acc += chunk;
        stream.append(acc);
      }
    } finally {
      await stream.finish();
    }
    return { id: firstId, channelId: t.channelId };
  }

  async delete(ref: MessageRef): Promise<void> {
    return this.deleteVia(this.connector, ref);
  }

  /** `delete`'s connector-parameterized body (see {@link postVia}). */
  private async deleteVia(
    connector: DiscordConnector,
    ref: MessageRef,
  ): Promise<void> {
    if (!ref.id) return; // empty-stream ref — nothing was posted
    await connector.deleteMessage(this.channelIdOf(ref), ref.id);
  }

  createRunRenderer(target: BotReplyTarget): RunRenderer {
    return this.createRunRendererVia(this.connector, target);
  }

  /** `createRunRenderer`'s connector-parameterized body (see {@link postVia}). */
  private createRunRendererVia(
    connector: DiscordConnector,
    target: BotReplyTarget,
  ): RunRenderer {
    const t = target as ReplyTarget;
    return createRunRenderer({
      channel: {
        async sendTyping() {
          await connector.sendTyping(t.channelId);
        },
        async send(payload) {
          const m = await connector.sendMessage(
            t.channelId,
            payload as DiscordSendPayload,
          );
          return {
            id: m.id,
            edit: (p: unknown) =>
              connector.editMessage(t.channelId, m.id, p as DiscordSendPayload),
          };
        },
      },
      interruptEventNames: this.opts.interruptEventNames,
    });
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return decodeInteraction(raw);
  }

  async lookupUser(q: UserQuery): Promise<PlatformUser | undefined> {
    return this.lookupUserVia(this.connector, q);
  }

  /** `lookupUser`'s connector-parameterized body (see {@link postVia}). */
  private async lookupUserVia(
    connector: DiscordConnector,
    q: UserQuery,
  ): Promise<PlatformUser | undefined> {
    const query = q.query.trim();
    if (!query) return undefined;
    return connector.lookupUser(query);
  }

  get conversationStore(): ConversationStore {
    return this.store;
  }

  async getMessages(target: BotReplyTarget): Promise<ThreadMessage[]> {
    return this.getMessagesVia(this.connector, target);
  }

  /** `getMessages`'s connector-parameterized body (see {@link postVia}). */
  private async getMessagesVia(
    connector: DiscordConnector,
    target: BotReplyTarget,
  ): Promise<ThreadMessage[]> {
    const t = target as ReplyTarget;
    try {
      const fetched = await connector.fetchMessages(t.channelId, {
        limit: 100,
      });
      return (
        fetched
          .toReversed()
          // Drop the bot's own streaming placeholders ("_thinking…_" /
          // "_…(continued)_") so they don't pollute the read_thread history
          // (bot-slack parity — it filters its own status/placeholders too).
          .filter(
            (m) =>
              !(
                Boolean(m.authorIsBot) &&
                (STREAM_PLACEHOLDERS as readonly string[]).includes(m.content)
              ),
          )
          .map((m) => ({
            text: m.content ?? "",
            ts: m.id,
            isBot: Boolean(m.authorIsBot),
            user: m.authorId
              ? { id: m.authorId, name: m.authorName, handle: m.authorHandle }
              : undefined,
          }))
      );
    } catch (err) {
      console.error(
        `[bot-discord] getMessages failed (channel ${t.channelId}):`,
        err,
      );
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
    return this.postFileVia(this.connector, target, args);
  }

  /** `postFile`'s connector-parameterized body (see {@link postVia}). */
  private async postFileVia(
    connector: DiscordConnector,
    target: BotReplyTarget,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const t = target as ReplyTarget;
    try {
      const res = await connector.postFile(t.channelId, {
        bytes: args.bytes,
        filename: args.filename,
      });
      return { ok: true, fileId: res.id };
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
    connector: DiscordConnector,
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const token = toPlatformEmoji(emoji, "discord") ?? String(emoji);
    try {
      // Fall back to the conversation's target channel when the reacted ref
      // carries no channelId — parity with Slack/Telegram, which the bot-ui
      // contract and the example rely on (the reacted ref is often just `{ id }`).
      const channelId =
        this.channelIdOf(messageRef) || (target as ReplyTarget).channelId;
      await connector.addReaction(channelId, messageRef.id, token);
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
    connector: DiscordConnector,
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const token = toPlatformEmoji(emoji, "discord") ?? String(emoji);
    try {
      const channelId =
        this.channelIdOf(messageRef) || (target as ReplyTarget).channelId;
      await connector.removeReaction(channelId, messageRef.id, token);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

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
    connector: DiscordConnector,
    _target: BotReplyTarget,
    user: PlatformUser | string,
    ir: ChannelNode[],
    opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null> {
    // Native interaction-ephemeral is only reachable from within a live,
    // unresponded interaction; that path is not plumbed into postEphemeral in
    // this pass, so we use the DM fallback (or null).
    if (!opts.fallbackToDM) return null;
    const userId = typeof user === "string" ? user : user.id;
    try {
      const { components, flags } = renderDiscordMessage(ir);
      const dm = await connector.sendDM(userId, { components, flags });
      return {
        ok: true,
        usedFallback: true,
        ref: { id: "", channelId: dm.channelId },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  renderModal(ir: ChannelNode[]): NativePayload {
    return renderDiscordModal(ir);
  }

  async openModal(
    _target: BotReplyTarget,
    triggerId: string,
    ir: ChannelNode[],
  ): Promise<{ ok: boolean; error?: string }> {
    let modal: NativePayload;
    try {
      modal = renderDiscordModal(ir);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    return this.connector.openModal(triggerId, modal);
  }

  async resolveUser(userId: string): Promise<PlatformUser> {
    return this.resolveUserVia(this.connector, userId);
  }

  /**
   * `resolveUser`'s connector-parameterized body (see {@link postVia}).
   * `getMessagesVia`/onTurn dispatch never fall through to the adapter's own
   * bound connector for user enrichment when driven via `makeEgress` — the
   * id→PlatformUser cache is shared across connectors, keyed only by Discord
   * user id (connector-independent).
   */
  private async resolveUserVia(
    connector: DiscordConnector,
    userId: string,
  ): Promise<PlatformUser> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    try {
      const user = await connector.resolveUser(userId);
      // Cache ONLY on success — a transient fetch failure must not pin the
      // bare-id fallback forever; a later call should retry.
      this.userCache.set(userId, user);
      return user;
    } catch (err) {
      console.error(`[bot-discord] resolveUser fetch failed (${userId}):`, err);
      return { id: userId }; // bare-id fallback, intentionally not cached
    }
  }

  private channelIdOf(ref: MessageRef): string {
    return String((ref as { channelId?: unknown }).channelId ?? "");
  }

  /**
   * Fetch the channel's recent messages OLDEST→NEWEST, normalized for the
   * conversation store's history reconstruction. Best-effort: on any fetch
   * error returns [] (bot-slack's fetchHistory does the same).
   */
  private async fetchHistory(
    channelId: string,
  ): Promise<DiscordHistoryMessage[]> {
    try {
      const fetched = await this.connector.fetchMessages(channelId, {
        limit: 100,
      });
      const msgs: DiscordHistoryMessage[] = fetched.toReversed(); // oldest→newest

      // A thread's *starter* message (the one the thread was created from) lives
      // in the PARENT channel and is NOT part of the thread's own message list.
      // Best-effort: the starter may be deleted, or the thread may have none
      // (e.g. forum/standalone threads) — the connector already swallows that.
      const starter = await this.connector.fetchStarterMessage(channelId);
      if (starter) msgs.unshift(starter);
      return msgs;
    } catch (err) {
      console.warn(
        `[bot-discord] fetchHistory failed (channel ${channelId}):`,
        err,
      );
      return [];
    }
  }

  /**
   * The declarative egress entry point (Channel Runner plan §2, design D2:
   * "adapter owns the effect→native mapping"): renders IR via the adapter's
   * own `render()`/components-v2 logic and routes every op to a
   * RUNNER-supplied `connector` instead of this adapter's internal one —
   * driving the exact same native Discord calls the `PlatformAdapter` methods
   * below build, just against a different credentialed sender (e.g. the
   * Intelligence Connector Outbox). Every op here is a thin call into the SAME
   * `*Via(connector, …)` helper the `PlatformAdapter` method (via
   * `this.connector`) also calls — one egress implementation, two entry
   * points. Discord has no assistant-pane equivalent, so `suggested`/`title`
   * degrade to a capability-gated `{ ok: false }` (mirrors
   * `DirectAdapterEgress`'s message for an adapter that omits those methods).
   */
  makeEgress(connector: DiscordConnector): ChannelEgress {
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
            return {
              ok: false,
              error: "discord does not support suggested prompts",
            } as EffectResultFor<E>;
          case "title":
            return {
              ok: false,
              error: "discord does not support thread titles",
            } as EffectResultFor<E>;
        }
      },
      stream: (target, chunks) => this.streamVia(connector, target, chunks),
      createRunRenderer: (target) =>
        this.createRunRendererVia(connector, target),
      getMessages: (target) => this.getMessagesVia(connector, target),
      lookupUser: (q) => this.lookupUserVia(connector, q),
    };
  }
}

export function discord(opts: DiscordAdapterOptions = {}): DiscordAdapter {
  return new DiscordAdapter(opts);
}
