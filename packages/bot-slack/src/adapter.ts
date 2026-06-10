import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
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
import { SlackConversationStore } from "./conversation-store.js";
import { attachSlackListener } from "./slack-listener.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction, conversationKeyOf } from "./interaction.js";
import { renderBlockKit, renderSlackMessage } from "./render/block-kit.js";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { autoCloseOpenMarkdown } from "./auto-close-streaming.js";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";
import { DM_SCOPE, type ConversationKey, type ReplyTarget } from "./types.js";

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
}

/** Slack `PlatformAdapter`: ingress via Bolt, egress via Block Kit + streaming. */
export class SlackAdapter implements PlatformAdapter {
  readonly platform = "slack";
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    supportsStreaming: true,
    maxBlocksPerMessage: 50,
  };
  readonly ackDeadlineMs = 3000;

  readonly app: App;
  client: WebClient;
  botUserId = "";
  private readonly store: SlackConversationStore;
  private sink: IngressSink | undefined;
  /** Per-id cache for sender-profile resolution (repeat turns are cheap). */
  private readonly userCache = new Map<string, PlatformUser>();

  constructor(private readonly opts: SlackAdapterOptions) {
    this.app = new App({
      token: opts.botToken,
      appToken: opts.appToken,
      signingSecret: opts.signingSecret,
      socketMode: opts.socketMode ?? true,
      logLevel: opts.logLevel ?? LogLevel.INFO,
    });
    this.client = this.app.client;
    this.store = new SlackConversationStore({
      client: this.client,
      botUserId: "",
      botToken: opts.botToken,
    });
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;

    // Resolve our own bot user id before attaching the listener so the loop
    // guard (skip our own posts) is in place from the first event.
    const auth = await this.client.auth.test();
    this.botUserId = auth.user_id as string;
    (this.store as unknown as { botUserId: string }).botUserId = this.botUserId;

    attachSlackListener({
      app: this.app,
      store: this.store,
      botUserId: this.botUserId,
      onTurn: async (turn) => {
        await sink.onTurn({
          conversationKey: conversationKeyOf(turn.conversation),
          replyTarget: turn.replyTarget,
          userText: turn.userText,
          user: turn.senderUserId
            ? await this.resolveUser(turn.senderUserId)
            : undefined,
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
          platform: "slack",
        });
      },
    });

    // Every block_actions click → decode to an opaque-id InteractionEvent and
    // hand to the sink. The matching `ck:` action either resolves an awaiting
    // HITL picker or dispatches via the ActionRegistry; unrelated clicks decode
    // to events the bot harmlessly ignores.
    this.app.action(/.*/, async ({ ack, body }) => {
      await ack();
      const evt = this.decodeInteraction(body);
      if (evt) await sink.onInteraction(evt);
    });

    // Socket Mode ignores the port; HTTP mode binds it.
    await this.app.start(this.opts.port ?? 0);
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  render(ir: BotNode[]) {
    return renderBlockKit(ir);
  }

  async post(target: BotReplyTarget, ir: BotNode[]): Promise<MessageRef> {
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
    const res = await this.client.chat.postMessage(
      (accent
        ? { ...base, attachments: [{ color: accent, blocks }] }
        : { ...base, blocks }) as unknown as Parameters<
        WebClient["chat"]["postMessage"]
      >[0],
    );
    return { id: res.ts as string, channel: t.channel, ts: res.ts };
  }

  async update(ref: MessageRef, ir: BotNode[]): Promise<void> {
    const channel = channelOf(ref);
    const { blocks, accent } = renderSlackMessage(ir);
    const summary = fallbackText(ir);
    // Mirror `post`'s accent/non-accent split. `chat.update` does not accept
    // the `unfurl_*` flags, so they are only set on `postMessage`.
    await this.client.chat.update(
      accent
        ? ({
            channel,
            ts: ref.id,
            text: summary,
            attachments: [{ color: accent, blocks }],
          } as unknown as Parameters<WebClient["chat"]["update"]>[0])
        : {
            channel,
            ts: ref.id,
            text: summary,
            blocks,
          },
    );
  }

  async stream(
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    let firstTs: string | undefined;
    let channel = t.channel;
    const stream = new ChunkedMessageStream({
      postPlaceholder: async (text) => {
        const posted = await this.client.chat.postMessage({
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
        await this.client.chat.update({ channel: t.channel, ts, text });
      },
      transform: (s) => markdownToMrkdwn(autoCloseOpenMarkdown(s)),
    });

    let acc = "";
    for await (const chunk of chunks) {
      acc += chunk;
      stream.append(acc);
    }
    await stream.finish();

    return { id: firstTs ?? "", channel, ts: firstTs };
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.client.chat.delete({ channel: channelOf(ref), ts: ref.id });
  }

  createRunRenderer(target: BotReplyTarget): RunRenderer {
    return createRunRenderer({
      client: this.client,
      target: target as ReplyTarget,
      interruptEventNames: this.opts.interruptEventNames,
      showToolStatus: this.opts.showToolStatus,
    });
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
        const r = (await this.client.users.list({ cursor, limit: 200 })) as {
          members?: Array<{
            id?: string;
            name?: string;
            real_name?: string;
            deleted?: boolean;
            is_bot?: boolean;
            profile?: { display_name?: string; email?: string };
          }>;
          response_metadata?: { next_cursor?: string };
        };
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
      const r = (await this.client.users.info({ user: userId })) as {
        user?: {
          id?: string;
          name?: string;
          real_name?: string;
          profile?: {
            real_name?: string;
            display_name?: string;
            email?: string;
          };
        };
      };
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
      const r = (await this.client.conversations.replies({
        channel: t.channel,
        ts: threadTs,
        limit: 100,
      })) as {
        messages?: Array<{
          text?: string;
          ts?: string;
          user?: string;
          bot_id?: string;
          subtype?: string;
        }>;
      };
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
      await this.client.files.uploadV2(
        args as unknown as Parameters<WebClient["files"]["uploadV2"]>[0],
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
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
function collectNodeText(node: BotNode): string {
  const acc: string[] = [];
  const visit = (n: BotNode): void => {
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
    for (const child of list as BotNode[]) visit(child);
  };
  visit(node);
  return acc.join(" ");
}

/** Depth-first search for the first node of `type` in the IR tree. */
function findFirst(ir: BotNode[], type: string): BotNode | undefined {
  for (const node of ir) {
    if (typeof node.type === "string" && node.type === type) return node;
    const children = node.props?.children;
    const list = Array.isArray(children)
      ? children
      : children && typeof children === "object" && "type" in children
        ? [children]
        : [];
    const found = findFirst(list as BotNode[], type);
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
function fallbackText(ir: BotNode[]): string {
  const header = findFirst(ir, "header");
  const source = header ? collectNodeText(header) : firstText(ir);
  const text = source.replace(/\s+/g, " ").trim();
  if (!text) return "…";
  return text.length > 150 ? text.slice(0, 149) + "…" : text;
}

/** First descendant text node's value across the whole IR, or "". */
function firstText(ir: BotNode[]): string {
  for (const node of ir) {
    const t = collectNodeText(node);
    if (t.trim()) return t;
  }
  return "";
}
