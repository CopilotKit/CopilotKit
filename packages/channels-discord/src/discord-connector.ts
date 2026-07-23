import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  REST,
} from "discord.js";
import type {
  IngressSink,
  PlatformUser,
  CommandSpec,
} from "@copilotkit/channels-core";
import type { NativePayload } from "@copilotkit/channels-core";
import { attachDiscordListener } from "./discord-listener.js";
import { decodeInteraction, decodeModalSubmit } from "./interaction.js";
import { PendingInteractions } from "./pending-interactions.js";
import { registerCommands as putCommands } from "./commands.js";
import type { RestLike } from "./commands.js";

/**
 * Default Gateway intents for the bot. Moved here from `adapter.ts` (Task
 * B/discord gut) — the Client these describe is now built INSIDE the
 * credential-owning connector, not the (now credential-free) adapter.
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
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.DirectMessageReactions,
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
  Partials.Channel,
  Partials.Message,
  Partials.Reaction,
] as const;

/** A message payload accepted by `sendMessage`/`editMessage` — plain data, no client types. */
export type DiscordSendPayload =
  | string
  | {
      content?: string;
      components?: unknown[];
      flags?: number;
      files?: Array<{ attachment: Buffer | Uint8Array; name: string }>;
    };

/** A single message row, normalized for history reconstruction / `getMessages`. */
export interface DiscordConnectorMessage {
  id: string;
  content: string;
  authorId?: string;
  authorName?: string;
  authorHandle?: string;
  authorIsBot?: boolean;
  attachments: Array<{
    url: string;
    name: string;
    contentType?: string | null;
    size: number;
  }>;
}

/**
 * Everything the adapter hands the connector to start OWNING the live Discord
 * connection (mirrors `SlackIngressConfig`): the Gateway `Client`, `login()`,
 * every raw event subscription, and the slash-command PUT — all built from
 * credentials the CONNECTOR is constructed with. Only serializable config +
 * the sink + a `resolveUser` callback cross this port.
 */
export interface DiscordIngressConfig {
  /** Where every normalized turn/command/interaction/reaction/modal event lands. */
  sink: IngressSink;
  /** Resolve a Discord user id to a richer PlatformUser (adapter-owned cache). */
  resolveUser: (userId: string) => Promise<PlatformUser>;
}

/** Connection facts resolved once ingress starts (the bot's own user id, known after `ready`). */
export interface DiscordIngressConnection {
  botUserId: string;
}

/**
 * Every credentialed Discord operation `DiscordAdapter`/`DiscordConversationStore`
 * perform, behind a port whose method signatures carry only serializable data
 * (channelId/messageId/payload/etc.) — never a discord.js `Client`/`REST`
 * instance or a bot token. A runner (custom `ChannelRunner`, or the managed
 * Connector Outbox's own implementation of this interface) constructs one —
 * typically a `WebClientDiscordConnector` — and injects it via
 * `DiscordAdapter.ɵbindConnector`.
 */
export interface DiscordConnector {
  /** Post a message to a channel/thread/DM channel id. */
  sendMessage(
    channelId: string,
    payload: DiscordSendPayload,
  ): Promise<{ id: string }>;
  /** Edit an existing message by id. */
  editMessage(
    channelId: string,
    messageId: string,
    payload: DiscordSendPayload,
  ): Promise<void>;
  /** Delete a message by id. */
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  /** Trigger the typing indicator. Best-effort — the connector swallows failures internally where noted by callers. */
  sendTyping(channelId: string): Promise<void>;
  /** Fetch up to `limit` recent messages, in the platform's native (newest-first) order. */
  fetchMessages(
    channelId: string,
    opts: { limit: number },
  ): Promise<DiscordConnectorMessage[]>;
  /** The message a THREAD was created from (lives in the parent channel); undefined if not a thread or unavailable. */
  fetchStarterMessage(
    channelId: string,
  ): Promise<DiscordConnectorMessage | undefined>;
  /** Add a reaction (emoji as a Discord-ready token: unicode char or `name:id`). */
  addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;
  /** Remove the BOT's OWN reaction (VS16-tolerant cache lookup; the connector knows its own user id). */
  removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;
  /** Upload a file to a channel. */
  postFile(
    channelId: string,
    file: { bytes: Uint8Array; filename: string },
  ): Promise<{ id: string }>;
  /** Open (or fetch) a DM channel with a user and post to it. */
  sendDM(
    userId: string,
    payload: DiscordSendPayload,
  ): Promise<{ id: string; channelId: string }>;
  /** Search guild members by name/handle across cached guilds. */
  lookupUser(query: string): Promise<PlatformUser | undefined>;
  /** Resolve a user id to a richer PlatformUser. No caching — the adapter owns that. */
  resolveUser(userId: string): Promise<PlatformUser>;
  /**
   * Publish (or re-publish) the bot's slash commands. Guild-scoped when the
   * connector was constructed with a `guildId` (instant), else global. The
   * connector stashes the list and publishes once the gateway is `ready`
   * (guarding against an empty PUT, which clears all commands) — mirrors the
   * pre-gut adapter's `registerCommands`/`publishCommands` dance.
   */
  registerCommands(commands: readonly CommandSpec[]): void;
  /**
   * Open a modal against a live interaction's `triggerId` (a component click or
   * a slash command — the connector owns both pending-interaction registries
   * internally). Returns `{ ok: false }` if the trigger is unknown or already
   * acknowledged.
   */
  openModal(
    triggerId: string,
    modal: NativePayload,
  ): Promise<{ ok: boolean; error?: string }>;
  /**
   * Start OWNING the live Discord connection: build the Gateway `Client`,
   * `login()`, resolve our own identity on `ready`, and subscribe to every raw
   * Discord event (messageCreate, interactionCreate — commands/components/
   * modals —, message reactions), normalizing each via the adapter's pure
   * decode functions before forwarding to `config.sink`. Resolves once the
   * gateway `ready` event fires after a successful `login()`; rejects (and
   * tears down the half-open connection) if `ready` doesn't arrive within
   * `readyTimeoutMs`.
   */
  startIngress(config: DiscordIngressConfig): Promise<DiscordIngressConnection>;
  /** Stop the live connection started by {@link startIngress}. */
  stopIngress(): Promise<void>;
}

/** Constructor config for {@link WebClientDiscordConnector} — everything Discord-credential/deployment-shaped now lives HERE, not on the adapter. */
export interface WebClientDiscordConnectorOptions {
  /** Discord bot token. */
  botToken: string;
  /** Discord application id (required to register slash commands). */
  appId: string;
  /** When set, slash commands register to this guild instantly (dev); else global. */
  guildId?: string;
  /** Gateway intents. Defaults to {@link DISCORD_DEFAULT_INTENTS}. */
  intents?: readonly GatewayIntentBits[];
  /** Client partials. Defaults to {@link DISCORD_DEFAULT_PARTIALS}. */
  partials?: readonly (typeof Partials)[keyof typeof Partials][];
  /**
   * How long to wait for the gateway `ready` event after a successful
   * `login()` before giving up and tearing down the connection. A rare
   * gateway stall (or a bad intents/token combo that doesn't reject
   * `login()` itself) can otherwise leave `startIngress` hanging forever,
   * which — via `create-channel`'s `Promise.allSettled` — would block the
   * ENTIRE multi-adapter channel from finishing startup. Defaults to 30s.
   */
  readyTimeoutMs?: number;
}

/** A discord.js channel/thread surface — only the members the connector calls. */
interface SendableChannel {
  id: string;
  isThread?(): boolean;
  send(payload: unknown): Promise<{
    id: string;
    edit(p: unknown): Promise<unknown>;
    delete(): Promise<unknown>;
  }>;
  sendTyping?(): Promise<void>;
  fetchStarterMessage?(): Promise<unknown>;
  messages: {
    fetch(arg: string | { limit: number }): Promise<any>;
  };
}

function toConnectorMessage(m: any): DiscordConnectorMessage {
  return {
    id: m.id,
    content: m.content ?? "",
    authorId: m.author?.id,
    authorName: m.author?.globalName ?? m.author?.username,
    authorHandle: m.author?.username,
    authorIsBot: Boolean(m.author?.bot),
    attachments: m.attachments
      ? Array.from(m.attachments.values()).map((a: any) => ({
          url: a.url,
          name: a.name,
          contentType: a.contentType,
          size: a.size,
        }))
      : [],
  };
}

/**
 * The default {@link DiscordConnector}: CREDENTIAL-OWNING — constructed with
 * `botToken`/`appId`/`guildId` and building BOTH its own `Client` (gateway,
 * ingress + most egress) and its own `REST` (slash-command registration)
 * internally. Nothing token-shaped ever crosses back out to the adapter. A
 * runner (custom `ChannelRunner`, or the managed Connector Outbox's own
 * implementation of this interface) constructs one of these — or an
 * equivalent — and injects it via `DiscordAdapter.ɵbindConnector`.
 */
export class WebClientDiscordConnector implements DiscordConnector {
  private readonly client: Client;
  private readonly rest: RestLike;
  private readonly botToken: string;
  private readonly appId: string;
  private readonly guildId: string | undefined;
  private readonly readyTimeoutMs: number;
  private botUserId = "";
  private isReady = false;
  private pendingCommands: readonly CommandSpec[] = [];
  /** Component interactions (buttons/selects) — a click's initial response is a component update. */
  private pending: PendingInteractions | undefined;
  /** Slash-command interactions — a command's initial response is a reply, not a component update. */
  private commandPending: PendingInteractions | undefined;

  constructor(opts: WebClientDiscordConnectorOptions) {
    this.botToken = opts.botToken;
    this.appId = opts.appId;
    this.guildId = opts.guildId;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 30_000;
    this.client = new Client({
      intents: [...(opts.intents ?? DISCORD_DEFAULT_INTENTS)],
      partials: [...(opts.partials ?? DISCORD_DEFAULT_PARTIALS)],
    });
    this.rest = new REST().setToken(this.botToken) as unknown as RestLike;
  }

  private async fetchSendable(channelId: string): Promise<SendableChannel> {
    const ch = await this.client.channels.fetch(channelId);
    if (!ch || !("send" in (ch as object))) {
      throw new Error(`channel ${channelId} is not sendable`);
    }
    return ch as unknown as SendableChannel;
  }

  async sendMessage(
    channelId: string,
    payload: DiscordSendPayload,
  ): Promise<{ id: string }> {
    const channel = await this.fetchSendable(channelId);
    const msg = await channel.send(payload as never);
    return { id: msg.id };
  }

  async editMessage(
    channelId: string,
    messageId: string,
    payload: DiscordSendPayload,
  ): Promise<void> {
    const channel = await this.fetchSendable(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit(payload as never);
  }

  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    const channel = await this.fetchSendable(channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.delete();
  }

  async sendTyping(channelId: string): Promise<void> {
    const channel = await this.fetchSendable(channelId);
    await channel.sendTyping?.();
  }

  async fetchMessages(
    channelId: string,
    opts: { limit: number },
  ): Promise<DiscordConnectorMessage[]> {
    const channel = await this.fetchSendable(channelId);
    const fetched = await channel.messages.fetch({ limit: opts.limit });
    return [...fetched.values()].map(toConnectorMessage);
  }

  async fetchStarterMessage(
    channelId: string,
  ): Promise<DiscordConnectorMessage | undefined> {
    const channel = await this.fetchSendable(channelId);
    if (typeof channel.isThread !== "function" || !channel.isThread()) {
      return undefined;
    }
    try {
      const starter = await channel.fetchStarterMessage?.();
      return starter ? toConnectorMessage(starter) : undefined;
    } catch {
      return undefined; // starter deleted or unavailable — best-effort
    }
  }

  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const channel = await this.fetchSendable(channelId);
    const msg = await channel.messages.fetch(messageId);
    await (msg as any).react(emoji);
  }

  async removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const channel = await this.fetchSendable(channelId);
    const msg = await channel.messages.fetch(messageId);
    // Discord may key the cache by the bare codepoint while `emoji` carries a
    // trailing U+FE0F (e.g. "❤️" vs "❤"), so resolve tolerantly.
    const cache = (msg as any).reactions?.cache;
    const reaction = cache?.get(emoji) ?? cache?.get(emoji.replace(/️/g, ""));
    await reaction?.users?.remove(this.botUserId || this.client.user?.id);
  }

  async postFile(
    channelId: string,
    file: { bytes: Uint8Array; filename: string },
  ): Promise<{ id: string }> {
    const channel = await this.fetchSendable(channelId);
    const msg = await channel.send({
      files: [{ attachment: Buffer.from(file.bytes), name: file.filename }],
    } as never);
    return { id: msg.id };
  }

  async sendDM(
    userId: string,
    payload: DiscordSendPayload,
  ): Promise<{ id: string; channelId: string }> {
    const u = await this.client.users.fetch(userId);
    const dm = await u.createDM();
    const msg = await dm.send(payload as never);
    return { id: msg.id, channelId: dm.id };
  }

  async lookupUser(query: string): Promise<PlatformUser | undefined> {
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

  async resolveUser(userId: string): Promise<PlatformUser> {
    const u = await this.client.users.fetch(userId);
    return {
      id: u.id,
      name: u.globalName ?? u.username,
      handle: u.username,
    };
    // Note: bots cannot read user email; PlatformUser.email stays undefined.
  }

  registerCommands(commands: readonly CommandSpec[]): void {
    this.pendingCommands = commands;
    // In the normal path `ready` has already fired by the time the engine
    // calls `registerCommands` — `startIngress`/`start()` now resolves AFTER
    // the gateway `ready` event, not before. This guard exists for the
    // custom-runner path: a caller that constructs the connector and calls
    // `registerCommands` before `startIngress` has resolved (or ever
    // resolves) still needs its list stashed and, once `ready` does fire,
    // published — the once("ready") handler's own `publishCommands` call
    // covers that case; this one covers `ready` having ALREADY fired.
    if (this.isReady) void this.publishCommands();
  }

  /**
   * Publish the registered commands. Guards against an empty list: an empty
   * `PUT` CLEARS all of the bot's commands, so a race where `ready` fires
   * before commands are stashed must not wipe them.
   */
  private async publishCommands(): Promise<void> {
    if (this.pendingCommands.length === 0) return;
    try {
      await putCommands(
        this.rest,
        this.appId,
        this.guildId,
        this.pendingCommands,
      );
    } catch (err) {
      console.error("[bot-discord] command registration failed:", err);
    }
  }

  async openModal(
    triggerId: string,
    modal: NativePayload,
  ): Promise<{ ok: boolean; error?: string }> {
    const show = (i: { id: string }) =>
      (i as unknown as { showModal(m: unknown): Promise<void> }).showModal(
        modal,
      );
    try {
      // A triggerId belongs to exactly one registry: component interactions
      // (buttons/selects) live in `pending`, slash commands in `commandPending`.
      const shown =
        (await this.pending?.respondWith(triggerId, show)) ||
        (await this.commandPending?.respondWith(triggerId, show));
      return shown
        ? { ok: true }
        : {
            ok: false,
            error:
              "interaction already acknowledged (open the modal before other work)",
          };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async startIngress(
    config: DiscordIngressConfig,
  ): Promise<DiscordIngressConnection> {
    const { sink, resolveUser } = config;

    // Resolve our own bot user id before `startIngress` resolves — unlike
    // Slack (whose `auth.test()` answers synchronously during startup),
    // Discord only reports its own identity on the async Gateway `ready`
    // event, so we await it here rather than returning a possibly-empty
    // `botUserId` (which would then never update — the adapter reads this
    // connection's `botUserId` exactly once). `registerCommands` calls that
    // land BEFORE this resolves still hit the empty-list guard below (an
    // empty `PUT` would clear all commands) — the `isReady` flag stays in
    // place for callers that construct the connector but never `await
    // startIngress` fully before registering.
    const ready = new Promise<void>((resolve) => {
      this.client.once("ready", async () => {
        this.botUserId = this.client.user?.id ?? "";
        this.isReady = true;
        await this.publishCommands();
        resolve();
      });
    });

    // Slash commands ack via `deferReply` (a command's initial response is a
    // reply, not a component update), so they need a registry distinct from
    // the component one below. A handler may `openModal` first; otherwise the
    // auto-defer fires inside the 3s window.
    const ackDeadlineMs = 3000;
    this.commandPending = new PendingInteractions({
      ackBufferMs: ackDeadlineMs - 500,
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
        // the connector passes context only; no per-turn content-part building.
        await sink.onTurn({
          conversationKey: turn.conversationKey,
          replyTarget: turn.replyTarget,
          userText: turn.userText,
          user: turn.senderUserId
            ? await resolveUser(turn.senderUserId)
            : undefined,
          platform: "discord",
          conversationKind: turn.conversationKind,
          mentioned: turn.mentioned,
        });
      },
      onCommand: async (cmd) => {
        const user = cmd.senderUserId
          ? await resolveUser(cmd.senderUserId)
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

    // One registry per connector. Auto-defer fires `ackBufferMs` after
    // register, leaving a ~500ms cushion inside Discord's 3s window. A handler
    // may `openModal` first, which calls `pending.respondWith` to win the race
    // and cancel the auto-defer.
    this.pending = new PendingInteractions({
      ackBufferMs: ackDeadlineMs - 500,
      defer: (i) =>
        (i as unknown as { deferUpdate(): Promise<void> }).deferUpdate(),
    });

    // Component interactions: register with the timer-race registry, hand the
    // decoded event to the sink (so a handler can open a modal first), then
    // settle — acking with deferUpdate if the handler never responded.
    this.client.on("interactionCreate", async (i: any) => {
      if (typeof i?.isButton !== "function") return;
      if (i.isButton() || i.isStringSelectMenu?.()) {
        const triggerId = this.pending!.register(i);
        try {
          const evt = decodeInteraction(i);
          if (evt) {
            evt.triggerId = triggerId;
            await sink.onInteraction(evt);
          }
        } catch (err) {
          console.error("[bot-discord] interaction dispatch failed:", err);
        }
        await this.pending!.settle(triggerId);
      } else if (i.isModalSubmit?.()) {
        try {
          await sink.onModalSubmit(decodeModalSubmit(i)); // result ignored — Discord can't re-open with errors
        } catch (err) {
          console.error("[bot-discord] modal submit dispatch failed:", err);
        }
        // Ack must match the modal's origin: `deferUpdate` is only valid for a
        // modal opened FROM a message component (button/select). A modal opened
        // from a slash command has no originating message, so `deferUpdate`
        // throws there — use `deferReply` (ephemeral) instead.
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

    await this.client.login(this.botToken);

    // `login()` can succeed while the gateway `ready` event never fires (a
    // rare gateway stall, or an intents/token combo that doesn't reject
    // `login()` itself). Bound the wait so a stalled Discord start can't hang
    // `startIngress` forever — which, via `create-channel`'s
    // `Promise.allSettled`, would otherwise block the ENTIRE multi-adapter
    // channel from finishing startup, not just Discord.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const readyTimeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `Discord gateway did not become ready within ${this.readyTimeoutMs}ms of a successful login() — check the bot's intents/token`,
          ),
        );
      }, this.readyTimeoutMs);
    });

    try {
      await Promise.race([ready, readyTimeout]);
    } catch (err) {
      // Tear down the half-open connection so we don't leak the socket; the
      // rejection propagates so `create-channel`'s `allSettled` degrades ONLY
      // this adapter.
      await this.client.destroy().catch(() => {});
      throw err;
    } finally {
      clearTimeout(timer);
    }

    return { botUserId: this.botUserId };
  }

  async stopIngress(): Promise<void> {
    await this.client.destroy();
  }
}
