import { Client, GatewayIntentBits, Partials, REST } from "discord.js";
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
} from "@copilotkit/bot";
import type { BotNode, ThreadMessage } from "@copilotkit/bot-ui";
import { DiscordConversationStore } from "./conversation-store.js";
import { attachDiscordListener } from "./discord-listener.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction } from "./interaction.js";
import {
  renderComponents,
  renderDiscordMessage,
} from "./render/components-v2.js";
import { registerCommands as putCommands, type RestLike } from "./commands.js";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
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
  send(payload: unknown): Promise<{ id: string; edit(p: unknown): Promise<unknown>; delete(): Promise<unknown> }>;
  edit?(payload: unknown): Promise<unknown>;
  sendTyping?(): Promise<void>;
  messages: {
    fetch(arg: string | { limit: number }): Promise<any>;
  };
}

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = "discord";
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: false,
    supportsTyping: true,
    supportsReactions: true,
    supportsStreaming: true,
    maxBlocksPerMessage: 40,
  };
  readonly ackDeadlineMs = 3000;

  private readonly client: Client;
  private readonly rest: RestLike;
  private readonly store = new DiscordConversationStore();
  private botUserId = "";
  private pendingCommands: readonly CommandSpec[] = [];
  private readonly userCache = new Map<string, PlatformUser>();

  constructor(
    private readonly opts: DiscordAdapterOptions,
    injected?: { client?: Client; rest?: RestLike },
  ) {
    this.client =
      injected?.client ??
      new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
          // Privileged intent — required for `guild.members.search` in
          // `lookupUser`. Like MessageContent, it must be enabled in the
          // Discord Developer Portal for the bot application.
          GatewayIntentBits.GuildMembers,
        ],
        partials: [Partials.Channel], // needed to receive DMs
      });
    this.rest =
      injected?.rest ?? (new REST().setToken(opts.botToken) as unknown as RestLike);
  }

  registerCommands(commands: readonly CommandSpec[]): void {
    this.pendingCommands = commands; // published on ready
  }

  async start(sink: IngressSink): Promise<void> {
    this.client.once("ready", async () => {
      this.botUserId = this.client.user?.id ?? "";
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
    });

    attachDiscordListener({
      client: this.client as never,
      botUserId: () => this.botUserId, // read lazily — only known after `ready`
      onTurn: async (turn) => {
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
        await sink.onCommand({
          command: cmd.command,
          text: cmd.text,
          rawOptions: cmd.rawOptions,
          conversationKey: cmd.conversationKey,
          replyTarget: cmd.replyTarget,
          user: cmd.senderUserId
            ? await this.resolveUser(cmd.senderUserId)
            : undefined,
          platform: "discord",
        });
      },
    });

    // Component interactions: ack within 3s, then hand the decoded event to the sink.
    this.client.on("interactionCreate", async (i: any) => {
      if (typeof i?.isButton !== "function") return;
      if (!i.isButton() && !i.isStringSelectMenu?.()) return;
      try {
        await i.deferUpdate();
      } catch (err) {
        // Usually a benign "already acknowledged" race; but an expired token
        // or network error also lands here, so surface it before proceeding.
        console.error("[bot-discord] interaction deferUpdate failed:", err);
      }
      const evt = this.decodeInteraction(i);
      if (evt) await sink.onInteraction(evt);
    });

    await this.client.login(this.opts.botToken);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  render(ir: BotNode[]) {
    return renderComponents(ir);
  }

  async post(target: BotReplyTarget, ir: BotNode[]): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const channel = await this.fetchSendable(t.channelId);
    const { components, flags } = renderDiscordMessage(ir);
    const msg = await channel.send({ components, flags });
    return { id: msg.id, channelId: t.channelId };
  }

  async update(ref: MessageRef, ir: BotNode[]): Promise<void> {
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
    for await (const chunk of chunks) {
      acc += chunk;
      stream.append(acc);
    }
    await stream.finish();
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
      return [...fetched.values()].reverse().map((m: any) => ({
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
      }));
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
    args: { bytes: Uint8Array; filename: string; title?: string; altText?: string },
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
}

export function discord(opts: DiscordAdapterOptions): DiscordAdapter {
  return new DiscordAdapter(opts);
}
