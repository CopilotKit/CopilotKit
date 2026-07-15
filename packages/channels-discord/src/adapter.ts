import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  REST,
} from "discord.js";
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
} from "@copilotkit/channels";
import type {
  ChannelNode,
  ThreadMessage,
  EmojiValue,
  EphemeralResult,
} from "@copilotkit/channels-ui";
import { toPlatformEmoji } from "@copilotkit/channels-ui";
import { DiscordConversationStore } from "./conversation-store.js";
import type { DiscordHistoryMessage } from "./conversation-store.js";
import { attachDiscordListener } from "./discord-listener.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction, decodeModalSubmit } from "./interaction.js";
import { PendingInteractions } from "./pending-interactions.js";
import {
  renderComponents,
  renderDiscordMessage,
} from "./render/components-v2.js";
import { renderDiscordModal } from "./render/modal.js";
import { registerCommands as putCommands } from "./commands.js";
import type { RestLike } from "./commands.js";
import {
  ChunkedMessageStream,
  STREAM_PLACEHOLDERS,
} from "./chunked-message-stream.js";
import { discordMarkdown } from "./markdown.js";
import { autoCloseOpenMarkdown } from "./auto-close-streaming.js";
import type { ReplyTarget } from "./types.js";

export interface DiscordAdapterOptions {
  botToken: string;
  appId: string;
  /** When set, slash commands register to this guild instantly (dev); else global. */
  guildId?: string;
  interruptEventNames?: ReadonlySet<string>;
}

/**
 * A discord.js channel/thread surface — only the members the adapter calls.
 * Kept loose (`any`-shaped per method) so tests can inject fakes without
 * pulling in discord.js's full union of channel types.
 */
interface SendableChannel {
  id: string;
  send(payload: unknown): Promise<{
    id: string;
    edit(p: unknown): Promise<unknown>;
    delete(): Promise<unknown>;
  }>;
  edit?(payload: unknown): Promise<unknown>;
  sendTyping?(): Promise<void>;
  messages: {
    fetch(arg: string | { limit: number }): Promise<any>;
  };
}

/**
 * Default Gateway intents for the bot.
 *
 * - `Guilds`, `GuildMessages`, `MessageContent`, `DirectMessages` — message ingress.
 * - `GuildMembers` — privileged; backs `lookup_discord_user` / `thread.lookupUser`.
 *   Must be toggled on in the Discord Developer Portal (Bot → Privileged Gateway Intents).
 * - `GuildMessageReactions` — non-privileged; no portal toggle needed.
 *   Required to receive reaction add/remove events in guild channels.
 * - `DirectMessageReactions` — non-privileged; required to receive reaction
 *   add/remove events in DMs. Distinct from `GuildMessageReactions` in discord.js v14.
 */
export const DISCORD_DEFAULT_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
  // Privileged intent — required for `guild.members.search` in
  // `lookupUser`. Like MessageContent, it must be enabled in the
  // Discord Developer Portal for the bot application.
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessageReactions, // reactions in guild channels — non-privileged
  GatewayIntentBits.DirectMessageReactions, // reactions in DMs — non-privileged
] as const;

/**
 * Default partials for the bot.
 *
 * - `Channel` — needed to receive DMs.
 * - `Message` + `Reaction` — required to receive reactions on uncached messages.
 *   Discord only delivers partial reaction events when the reacted-to message is not
 *   in the client's cache; without these partials those events are silently dropped.
 */
export const DISCORD_DEFAULT_PARTIALS = [
  Partials.Channel, // needed to receive DMs
  Partials.Message, // receive reactions on uncached messages
  Partials.Reaction,
] as const;

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

  private readonly client: Client;
  private readonly rest: RestLike;
  private readonly store: DiscordConversationStore;
  private botUserId = "";
  private isReady = false;
  private pendingCommands: readonly CommandSpec[] = [];
  private readonly userCache = new Map<string, PlatformUser>();
  /**
   * Tracks live component interactions so a handler can open a modal (which
   * must be the interaction's INITIAL response, within ~3s) before the adapter
   * auto-defers. Constructed in `start()`. Used by `openModal` (Task D4).
   */
  private pending!: PendingInteractions;
  /**
   * Tracks live slash-command interactions (a command's initial response is a
   * reply, not a component update, so it needs its own registry). `openModal`
   * consults this too, so a command handler can `showModal` before the adapter
   * auto-defers. Constructed in `start()`.
   */
  private commandPending!: PendingInteractions;

  constructor(
    private readonly opts: DiscordAdapterOptions,
    injected?: { client?: Client; rest?: RestLike },
  ) {
    this.client =
      injected?.client ??
      new Client({
        intents: [...DISCORD_DEFAULT_INTENTS],
        partials: [...DISCORD_DEFAULT_PARTIALS],
      });
    this.rest =
      injected?.rest ??
      (new REST().setToken(opts.botToken) as unknown as RestLike);
    // Reconstruct full channel history each turn (bot-slack parity). The store
    // reads the Discord channel — the source of truth — so the inbound message
    // and any earlier attachments are part of the rebuilt history.
    this.store = new DiscordConversationStore({
      fetchHistory: (channelId) => this.fetchHistory(channelId),
      botUserId: () => this.botUserId,
      filesConfig: undefined,
    });
  }

  registerCommands(commands: readonly CommandSpec[]): void {
    this.pendingCommands = commands;
    // `ready` may have already fired (start() resolves before the gateway READY
    // event, and the engine calls registerCommands AFTER start()). If so, the
    // once("ready") publish already ran with an empty list — publish now.
    if (this.isReady) void this.publishCommands();
  }

  /**
   * Publish the registered commands. Guards against an empty list: an empty
   * `setMyCommands`/`PUT` CLEARS all of the bot's commands, so a race where
   * `ready` fires before commands are stashed must not wipe them.
   */
  private async publishCommands(): Promise<void> {
    if (this.pendingCommands.length === 0) return;
    try {
      await putCommands(
        this.rest,
        this.opts.appId,
        this.opts.guildId,
        this.pendingCommands,
      );
    } catch (err) {
      console.error("[bot-discord] command registration failed:", err);
    }
  }

  async start(sink: IngressSink): Promise<void> {
    this.client.once("ready", async () => {
      this.botUserId = this.client.user?.id ?? "";
      this.isReady = true;
      await this.publishCommands();
    });

    // Slash commands ack via `deferReply` (a command's initial response is a
    // reply, not a component update), so they need a registry distinct from
    // the component one above. A handler may `openModal` first; otherwise the
    // auto-defer fires inside the 3s window.
    this.commandPending = new PendingInteractions({
      ackBufferMs: this.ackDeadlineMs - 500,
      defer: (i) =>
        (
          i as unknown as {
            deferReply(opts: { flags: number }): Promise<unknown>;
          }
        )
          .deferReply({ flags: MessageFlags.Ephemeral })
          .then(() => undefined),
    });

    attachDiscordListener({
      client: this.client as never,
      botUserId: () => this.botUserId, // read lazily — only known after `ready`
      commandPending: this.commandPending,
      onTurn: async (turn) => {
        // The conversation store reconstructs the full channel history each
        // turn — including the triggering message and ALL its attachments — so
        // the bridge passes context only; no per-turn content-part building.
        await sink.onTurn({
          conversationKey: turn.conversationKey,
          replyTarget: turn.replyTarget,
          userText: turn.userText,
          user: turn.senderUserId
            ? await this.resolveUser(turn.senderUserId)
            : undefined,
          platform: "discord",
        });
      },
      onCommand: async (cmd) => {
        const user = cmd.senderUserId
          ? await this.resolveUser(cmd.senderUserId)
          : undefined;
        await sink.onCommand({
          command: cmd.command,
          text: cmd.text,
          rawOptions: cmd.rawOptions,
          conversationKey: cmd.conversationKey,
          replyTarget: cmd.replyTarget,
          user,
          platform: "discord",
          triggerId: cmd.triggerId,
        });
      },
      onReaction: sink.onReaction ? sink.onReaction.bind(sink) : undefined,
    });

    // One registry per adapter. Auto-defer fires `ackBufferMs` after register,
    // leaving a ~500ms cushion inside Discord's 3s window. A handler may
    // `openModal` (Task D4) first, which calls `pending.respondWith` to win the
    // race and cancel the auto-defer.
    this.pending = new PendingInteractions({
      ackBufferMs: this.ackDeadlineMs - 500,
      defer: (i) =>
        (i as unknown as { deferUpdate(): Promise<void> }).deferUpdate(),
    });

    // Component interactions: register with the timer-race registry, hand the
    // decoded event to the sink (so a handler can open a modal first), then
    // settle — acking with deferUpdate if the handler never responded.
    this.client.on("interactionCreate", async (i: any) => {
      if (typeof i?.isButton !== "function") return;
      if (i.isButton() || i.isStringSelectMenu?.()) {
        const triggerId = this.pending.register(i);
        try {
          const evt = this.decodeInteraction(i);
          if (evt) {
            evt.triggerId = triggerId;
            await sink.onInteraction(evt);
          }
        } catch (err) {
          // Mirror discord-listener's onTurn/onCommand guards: a malformed
          // payload (decode throw) or a rejected sink dispatch must not become
          // an unhandled promise rejection. `settle` below still acks the
          // interaction, so logging here is sufficient.
          console.error("[bot-discord] interaction dispatch failed:", err);
        }
        await this.pending.settle(triggerId);
      } else if (i.isModalSubmit?.()) {
        try {
          await sink.onModalSubmit(decodeModalSubmit(i)); // result ignored — Discord can't re-open with errors
        } catch (err) {
          console.error("[bot-discord] modal submit dispatch failed:", err);
        }
        // Ack must match the modal's origin: `deferUpdate` is only valid for a
        // modal opened FROM a message component (button/select). A modal opened
        // from a slash command has no originating message, so `deferUpdate`
        // throws there — use `deferReply` (ephemeral) instead. Guard the ack so
        // it can never become an unhandled rejection in the event listener.
        try {
          if (!i.replied && !i.deferred) {
            if (i.isFromMessage?.()) await i.deferUpdate();
            else await i.deferReply({ flags: MessageFlags.Ephemeral });
          }
        } catch (err) {
          console.error("[bot-discord] modal submit ack failed:", err);
        }
      }
    });

    await this.client.login(this.opts.botToken);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  render(ir: ChannelNode[]) {
    return renderComponents(ir);
  }

  async post(target: BotReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const channel = await this.fetchSendable(t.channelId);
    const { components, flags } = renderDiscordMessage(ir);
    const msg = await channel.send({ components, flags });
    return { id: msg.id, channelId: t.channelId };
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    // An empty stream returns a ref with id "" (no message was ever posted);
    // a fetch on "" would throw, so treat update/delete on it as a no-op.
    if (!ref.id) return;
    const channel = await this.fetchSendable(this.channelIdOf(ref));
    const msg = await channel.messages.fetch(ref.id);
    const { components, flags } = renderDiscordMessage(ir);
    await msg.edit({ components, flags });
  }

  async stream(
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const channel = await this.fetchSendable(t.channelId);
    let firstId = "";
    // One handle per posted Discord message, keyed by the id returned from
    // `channel.send`. Multi-chunk replies (>2000 chars) post several
    // messages; `updateAt(id, …)` must edit the message that owns `id`,
    // not always message #0. Mirrors the `messages` Map in event-renderer.ts.
    const handles = new Map<string, { edit(p: unknown): Promise<unknown> }>();
    const stream = new ChunkedMessageStream({
      postPlaceholder: async (text) => {
        const m = await channel.send(text);
        if (!firstId) firstId = m.id;
        handles.set(m.id, m);
        return m.id;
      },
      updateAt: async (id, text) => {
        await handles.get(id)?.edit(text);
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
    if (!ref.id) return; // empty-stream ref — nothing was posted
    const channel = await this.fetchSendable(this.channelIdOf(ref));
    const msg = await channel.messages.fetch(ref.id);
    await msg.delete();
  }

  createRunRenderer(target: BotReplyTarget): RunRenderer {
    const t = target as ReplyTarget;
    // Resolve the channel lazily inside a thin wrapper so createRunRenderer stays sync.
    const channelPromise = this.fetchSendable(t.channelId);
    return createRunRenderer({
      channel: {
        async sendTyping() {
          await (await channelPromise).sendTyping?.();
        },
        async send(payload) {
          return (await channelPromise).send(payload) as never;
        },
      },
      interruptEventNames: this.opts.interruptEventNames,
    });
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return decodeInteraction(raw);
  }

  async lookupUser(q: UserQuery): Promise<PlatformUser | undefined> {
    const query = q.query.trim();
    if (!query) return undefined;
    // Search guild members by username/displayName across cached guilds.
    for (const guild of this.client.guilds.cache.values()) {
      try {
        const found = await guild.members.search({ query, limit: 1 });
        const member = found.first();
        if (member) {
          const user = member.user;
          return {
            id: user.id,
            name: user.globalName ?? user.username,
            handle: user.username,
          };
        }
      } catch (err) {
        console.error(
          `[bot-discord] member search failed (guild ${guild.id}, query "${query}"):`,
          err,
        );
        /* try the next guild */
      }
    }
    return undefined;
  }

  get conversationStore(): ConversationStore {
    return this.store;
  }

  async getMessages(target: BotReplyTarget): Promise<ThreadMessage[]> {
    const t = target as ReplyTarget;
    try {
      const channel = await this.fetchSendable(t.channelId);
      const fetched = await channel.messages.fetch({ limit: 100 });
      return (
        [...fetched.values()]
          .toReversed()
          // Drop the bot's own streaming placeholders ("_thinking…_" /
          // "_…(continued)_") so they don't pollute the read_thread history
          // (bot-slack parity — it filters its own status/placeholders too).
          .filter(
            (m: any) =>
              !(
                Boolean(m.author?.bot) &&
                (STREAM_PLACEHOLDERS as readonly string[]).includes(
                  m.content ?? "",
                )
              ),
          )
          .map((m: any) => ({
            text: m.content ?? "",
            ts: m.id,
            isBot: Boolean(m.author?.bot),
            user: m.author
              ? {
                  id: m.author.id,
                  name: m.author.globalName ?? m.author.username,
                  handle: m.author.username,
                }
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
    const t = target as ReplyTarget;
    try {
      const channel = await this.fetchSendable(t.channelId);
      const msg = await channel.send({
        files: [{ attachment: Buffer.from(args.bytes), name: args.filename }],
      });
      return { ok: true, fileId: msg.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async addReaction(
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const token = toPlatformEmoji(emoji, "discord") ?? String(emoji);
    try {
      // Fall back to the conversation's target channel when the reacted ref
      // carries no channelId — parity with Slack/Telegram, which the bot-ui
      // contract and the example rely on (the reacted ref is often just `{ id }`).
      const channel = await this.fetchSendable(
        this.channelIdOf(messageRef) || (target as ReplyTarget).channelId,
      );
      const msg = await channel.messages.fetch(messageRef.id);
      await msg.react(token);
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
    const token = toPlatformEmoji(emoji, "discord") ?? String(emoji);
    try {
      // Fall back to the conversation's target channel when the reacted ref
      // carries no channelId — parity with Slack/Telegram (see addReaction).
      const channel = await this.fetchSendable(
        this.channelIdOf(messageRef) || (target as ReplyTarget).channelId,
      );
      const msg = await channel.messages.fetch(messageRef.id);
      // Discord may key the cache by the bare codepoint while `token` carries
      // the table's trailing U+FE0F (e.g. "❤️" vs "❤"), so resolve tolerantly.
      const cache = (msg as any).reactions?.cache;
      const reaction = cache?.get(token) ?? cache?.get(token.replace(/️/g, ""));
      // Prefer the cached bot id (known after `ready`); fall back to the live
      // client user without a non-null assertion that could throw pre-`ready`.
      await reaction?.users?.remove(this.botUserId || this.client.user?.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async postEphemeral(
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
      const u = await this.client.users.fetch(userId);
      const dm = await u.createDM();
      const { components, flags } = renderDiscordMessage(ir);
      await dm.send({ components, flags });
      return {
        ok: true,
        usedFallback: true,
        ref: { id: "", channelId: dm.id },
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
    let modal: ReturnType<typeof renderDiscordModal>;
    try {
      modal = renderDiscordModal(ir);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    let shown: boolean;
    try {
      const show = (i: { id: string }) =>
        (i as unknown as { showModal(m: unknown): Promise<void> }).showModal(
          modal,
        );
      // A triggerId belongs to exactly one registry: component interactions
      // (buttons/selects) live in `pending`, slash commands in `commandPending`.
      // `respondWith` returns false (no throw) when the id isn't in a registry,
      // so try both — without this, opening a modal from a slash command (e.g.
      // /file-issue) silently fails because the command isn't in `pending`.
      shown =
        (await this.pending.respondWith(triggerId, show)) ||
        (await this.commandPending.respondWith(triggerId, show));
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    return shown
      ? { ok: true }
      : {
          ok: false,
          error:
            "interaction already acknowledged (open the modal before other work)",
        };
  }

  async resolveUser(userId: string): Promise<PlatformUser> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;
    try {
      const u = await this.client.users.fetch(userId);
      const user: PlatformUser = {
        id: u.id,
        name: u.globalName ?? u.username,
        handle: u.username,
      };
      // Note: bots cannot read user email; PlatformUser.email stays undefined.
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

  private async fetchSendable(channelId: string): Promise<SendableChannel> {
    const ch = await this.client.channels.fetch(channelId);
    if (!ch || !("send" in (ch as object))) {
      throw new Error(`channel ${channelId} is not sendable`);
    }
    return ch as unknown as SendableChannel;
  }

  /**
   * Fetch the channel's recent messages OLDEST→NEWEST, normalized for the
   * conversation store's history reconstruction. Best-effort: on any fetch
   * error returns [] (bot-slack's fetchHistory does the same).
   */
  private async fetchHistory(
    channelId: string,
  ): Promise<DiscordHistoryMessage[]> {
    const mapMsg = (m: any): DiscordHistoryMessage => ({
      id: m.id,
      content: m.content ?? "",
      authorId: m.author?.id,
      authorIsBot: Boolean(m.author?.bot),
      attachments: m.attachments
        ? Array.from(m.attachments.values()).map((a: any) => ({
            url: a.url,
            name: a.name,
            contentType: a.contentType,
            size: a.size,
          }))
        : [],
    });
    try {
      const channel = await this.fetchSendable(channelId);
      const fetched = await channel.messages.fetch({ limit: 100 });
      const msgs = [...fetched.values()].toReversed().map(mapMsg); // oldest→newest

      // A thread's *starter* message (the one the thread was created from) lives
      // in the PARENT channel and is NOT part of the thread's own message list,
      // so `messages.fetch` above never returns it. Pull it in so an image/text
      // on the message a thread was started from is part of the reconstructed
      // history. (Slack's `conversations.replies` returns the parent
      // automatically; Discord does not.) Best-effort: the starter may be
      // deleted, or the thread may have none (e.g. forum/standalone threads).
      const ch = channel as unknown as {
        isThread?: () => boolean;
        fetchStarterMessage?: () => Promise<unknown>;
      };
      if (typeof ch.isThread === "function" && ch.isThread()) {
        try {
          const starter = await ch.fetchStarterMessage?.();
          if (starter) msgs.unshift(mapMsg(starter));
        } catch {
          /* starter deleted or unavailable — best-effort */
        }
      }
      return msgs;
    } catch (err) {
      console.warn(
        `[bot-discord] fetchHistory failed (channel ${channelId}):`,
        err,
      );
      return [];
    }
  }
}

export function discord(opts: DiscordAdapterOptions): DiscordAdapter {
  return new DiscordAdapter(opts);
}
