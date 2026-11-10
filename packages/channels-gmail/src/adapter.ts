import { MemoryStore } from "@copilotkit/channels-core";
import type {
  ConversationStore,
  IncomingTurn,
  IngressSink,
  InteractionEvent,
  PlatformAdapter,
  RunRenderer,
  StateStore,
  SurfaceCapabilities,
  UserQuery,
} from "@copilotkit/channels-core";
import type {
  AgentContentPart,
  ChannelNode,
  MessageRef,
  PostFileResult,
  ProviderActor,
  ThreadMessage,
} from "@copilotkit/channels-ui";
import {
  ACTION_PARAM,
  DEFAULT_ACTION_TTL_MS,
  actionUrl,
  confirmPage,
  page,
  signAction,
  verifyAction,
} from "./action-links.js";
import type { ActionClaims } from "./action-links.js";
import { attachmentParts } from "./attachments.js";
import { GmailConversationStore } from "./conversation-store.js";
import { GmailClient, RefreshTokenAuth } from "./gmail-api.js";
import type { GmailMessage } from "./gmail-api.js";
import { buildReplyMime, contentTypeFor, isEmailAddress } from "./mime.js";
import type { MimeAttachment } from "./mime.js";
import { NodeServer } from "./node-server.js";
import { parseGmailMessage } from "./parse.js";
import type { ParsedEmail } from "./parse.js";
import {
  GoogleKeys,
  PushAuthError,
  parsePushBody,
  verifyOidcToken,
  verifySharedToken,
} from "./pubsub.js";
import { markdownEmail, renderEmail } from "./render.js";
import type { EmailBody, LinkControl } from "./render.js";
import { createGmailRunRenderer } from "./run-renderer.js";
import { GmailSync } from "./sync.js";
import type {
  GmailAdapterOptions,
  GmailMessageRef,
  GmailReplyTarget,
} from "./types.js";

/** Gmail's limit for attachments on one email. */
export const GMAIL_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** Renew the watch at least this often. Google recommends once a day. */
const WATCH_RENEW_MS = 24 * 60 * 60 * 1000;
/** Retry a failed watch renewal after this long. */
const WATCH_RETRY_MS = 5 * 60 * 1000;

/** Create a Gmail adapter. Mirrors `slack(opts)`, `whatsapp(opts)`, … */
export function gmail(opts: GmailAdapterOptions): GmailAdapter {
  return new GmailAdapter(opts);
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * A direct adapter for one Gmail mailbox.
 *
 * Inbound: Gmail `users.watch` publishes mailbox changes to a Pub/Sub topic.
 * A push subscription posts them to {@link GmailAdapter.handler}, which
 * verifies the push and reads new mail with `users.history.list`. Each email
 * thread is one conversation; every email in the intake label is a mention.
 *
 * Outbound: one reply email per post, in the same thread. Agent text is
 * collected for the whole turn and sent as one email.
 */
export class GmailAdapter implements PlatformAdapter {
  readonly platform = "gmail";
  readonly capabilities: SurfaceCapabilities;
  readonly ackDeadlineMs = 10_000;
  readonly conversationStore: ConversationStore;
  /** The Gmail REST client the adapter uses. */
  readonly client: GmailClient;

  private readonly store: StateStore;
  private readonly sync: GmailSync;
  private readonly keys: GoogleKeys;
  private readonly server: NodeServer | undefined;
  private readonly labelId: string;
  private readonly interruptEventNames: ReadonlySet<string>;
  private readonly maxAttachmentBytes: number;
  private readonly gmailStore: GmailConversationStore;
  private sink: IngressSink | undefined;
  private mailbox = "";
  private renewTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly threadChains = new Map<string, Promise<void>>();

  constructor(private readonly opts: GmailAdapterOptions) {
    if (!opts.oauth && !opts.getAccessToken) {
      throw new Error("gmail(): give `oauth` credentials or `getAccessToken`");
    }
    if (!opts.pubsubAuth && !opts.verificationToken) {
      throw new Error(
        "gmail(): give `pubsubAuth` or `verificationToken` so push requests can be verified",
      );
    }
    if (opts.watch !== false && !opts.topicName) {
      throw new Error(
        "gmail(): `topicName` is required unless `watch` is false",
      );
    }
    if (opts.address !== undefined && !isEmailAddress(opts.address)) {
      throw new Error("gmail(): `address` is not a valid email address");
    }
    if (opts.actions) {
      if (!URL.canParse(opts.actions.baseUrl)) {
        throw new Error("gmail(): `actions.baseUrl` is not a valid URL");
      }
      if (opts.actions.secret.length < 32) {
        throw new Error(
          "gmail(): `actions.secret` must be at least 32 characters",
        );
      }
    }
    const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const auth = opts.oauth
      ? new RefreshTokenAuth(opts.oauth, fetchImpl)
      : undefined;
    this.client = new GmailClient({
      fetch: fetchImpl,
      getAccessToken: async () =>
        auth ? auth.getAccessToken() : await opts.getAccessToken!(),
      ...(auth ? { onUnauthorized: () => auth.invalidate() } : {}),
    });
    this.store = opts.store ?? new MemoryStore();
    this.keys = new GoogleKeys(fetchImpl);
    this.labelId = opts.labelId ?? "INBOX";
    this.interruptEventNames =
      opts.interruptEventNames ?? new Set(["on_interrupt"]);
    this.maxAttachmentBytes = Math.min(
      opts.maxAttachmentBytes ?? GMAIL_MAX_ATTACHMENT_BYTES,
      GMAIL_MAX_ATTACHMENT_BYTES,
    );
    this.capabilities = {
      supportsMessageEvents: true,
      supportsModals: false,
      supportsTyping: false,
      supportsReactions: false,
      supportsStreaming: false,
      supportsSuggestedPrompts: false,
      supportsThreadTitle: false,
      supportsEphemeral: false,
      // A click arrives through a signed link. Without links there is no way
      // to answer a picker, so `awaitChoice` is refused up front.
      supportsBlockingChoice: opts.actions !== undefined,
    };
    this.gmailStore = new GmailConversationStore(this.client, (a) =>
      this.isOwnAddress(a),
    );
    this.conversationStore = this.gmailStore;
    this.sync = new GmailSync({
      client: this.client,
      store: this.store,
      labelId: this.labelId,
      mailbox: () => this.mailbox,
      isOwnAddress: (a) => this.isOwnAddress(a),
      onEmail: (email, message) => this.enqueue(email, message),
    });
    this.server =
      opts.port === undefined
        ? undefined
        : new NodeServer({
            port: opts.port,
            ...(opts.host !== undefined ? { host: opts.host } : {}),
            path: opts.path ?? "/gmail",
            handler: (request) => this.handler(request),
          });
    this.handler = this.handler.bind(this);
  }

  /** The bound port of the `port` server, after `start()`. */
  get port(): number | undefined {
    return this.server?.port;
  }

  /** The bot's address: the `address` option, else the authenticated mailbox. */
  get address(): string {
    return (this.opts.address ?? this.mailbox).toLowerCase();
  }

  async start(sink: IngressSink): Promise<void> {
    const profile = await this.client.getProfile();
    this.mailbox = profile.emailAddress.toLowerCase();
    if (this.opts.watch !== false) {
      await this.watch();
    } else {
      await this.sync.init(profile.historyId);
    }
    this.sink = sink;
    await this.server?.start();
  }

  async stop(): Promise<void> {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = undefined;
    this.sink = undefined;
    await this.server?.stop();
  }

  /**
   * Fetch-style request handler. Mount it on the route your Pub/Sub push
   * subscription posts to (Next.js route handler, Hono, Bun, a Worker, …).
   * The same route serves signed action links (`?a=…`).
   *
   * Answers `204` once new mail is read; your handlers then run in the
   * background (see the `waitUntil` option). Answers `401` for an
   * unverified push and `500` when Gmail cannot be read, so Pub/Sub retries.
   */
  async handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isForm = (request.headers.get("content-type") ?? "").startsWith(
      "application/x-www-form-urlencoded",
    );
    if (url.searchParams.has(ACTION_PARAM) || isForm) {
      if (request.method === "GET") return this.showAction(url);
      if (request.method === "POST") return this.runAction(request);
      return new Response(null, {
        status: 405,
        headers: { allow: "GET, POST" },
      });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    if (!this.sink)
      return new Response("channel is not started", { status: 503 });
    try {
      if (this.opts.verificationToken) {
        verifySharedToken(url, this.opts.verificationToken);
      }
      if (this.opts.pubsubAuth) {
        await verifyOidcToken(
          request.headers.get("authorization"),
          this.opts.pubsubAuth,
          this.keys,
        );
      }
    } catch (err) {
      if (err instanceof PushAuthError) {
        return new Response("unauthorized", { status: 401 });
      }
      throw err;
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = undefined;
    }
    const note = parsePushBody(body);
    // A verified push that is not a Gmail notification is acknowledged, so
    // Pub/Sub does not retry it for a week.
    if (!note) {
      console.warn(
        "[channels-gmail] ignored a push without a Gmail notification",
      );
      return noContent();
    }
    if (note.emailAddress !== this.mailbox) return noContent();
    try {
      await this.sync.sync(note.historyId);
    } catch (err) {
      console.error("[channels-gmail] mailbox sync failed:", err);
      return new Response("sync failed", { status: 500 });
    }
    return noContent();
  }

  render(ir: ChannelNode[]): EmailBody {
    return renderEmail(ir);
  }

  async post(target: unknown, ir: ChannelNode[]): Promise<MessageRef> {
    const t = target as GmailReplyTarget;
    const link = this.linker(t);
    return this.send(t, renderEmail(ir, link ? { link } : {}));
  }

  /** Sent email cannot be changed. Post a new reply instead. */
  async update(_ref: MessageRef, _ir: ChannelNode[]): Promise<void> {
    throw new Error(
      "Gmail cannot edit an email after it is sent. Post a new reply instead.",
    );
  }

  /** Sent email cannot be taken back. */
  async delete(_ref: MessageRef): Promise<void> {
    throw new Error(
      "Gmail cannot delete an email from the recipient's mailbox.",
    );
  }

  /** Email does not stream: the chunks are collected and sent as one reply. */
  async stream(
    target: unknown,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    let text = "";
    for await (const chunk of chunks) text += chunk;
    return this.send(target as GmailReplyTarget, markdownEmail(text));
  }

  createRunRenderer(target: unknown): RunRenderer {
    const t = target as GmailReplyTarget;
    return createGmailRunRenderer({
      send: async (markdown) => {
        await this.send(t, markdownEmail(markdown));
      },
      interruptEventNames: this.interruptEventNames,
    });
  }

  /**
   * Decode a signed action token (the `a` query value of an action link)
   * into an interaction event. It checks the signature and expiry, but not
   * whether the link was used before; the request handler does that. The
   * reply target has no subject or threading headers.
   */
  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    if (!this.opts.actions || typeof raw !== "string") return undefined;
    const result = verifyAction(this.opts.actions.secret, raw);
    if (!result.ok) return undefined;
    const claims = result.claims;
    return this.interaction(claims, {
      threadId: claims.conversationKey,
      to: claims.recipient,
      subject: "",
      references: [],
    });
  }

  async lookupUser(_q: UserQuery): Promise<ProviderActor | undefined> {
    return undefined; // Gmail has no user directory to search.
  }

  async getMessages(target: unknown): Promise<ThreadMessage[]> {
    return this.gmailStore.getMessages(target as GmailReplyTarget);
  }

  async postFile(
    target: unknown,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<PostFileResult> {
    if (args.bytes.byteLength > this.maxAttachmentBytes) {
      return {
        ok: false,
        error: `file is larger than ${this.maxAttachmentBytes} bytes`,
      };
    }
    try {
      const ref = await this.send(
        target as GmailReplyTarget,
        markdownEmail(args.title ?? args.altText ?? args.filename),
        [
          {
            filename: args.filename,
            contentType: contentTypeFor(args.filename),
            bytes: args.bytes,
          },
        ],
      );
      return { ok: true, messageId: ref.id, messageRef: ref };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private isOwnAddress(address: string): boolean {
    const a = address.toLowerCase();
    return a === this.mailbox || a === this.address;
  }

  private async watch(): Promise<void> {
    const res = await this.client.watch({
      topicName: this.opts.topicName!,
      labelIds: [this.labelId],
    });
    await this.sync.init(res.historyId);
    const untilExpiry = Number(res.expiration) - Date.now() - 60 * 60 * 1000;
    this.scheduleRenewal(
      Number.isFinite(untilExpiry)
        ? Math.max(60_000, Math.min(WATCH_RENEW_MS, untilExpiry))
        : WATCH_RENEW_MS,
    );
  }

  private scheduleRenewal(delayMs: number): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    this.renewTimer = setTimeout(() => {
      this.renewTimer = undefined;
      this.watch().catch((err: unknown) => {
        console.error("[channels-gmail] watch renewal failed:", err);
        if (this.sink) this.scheduleRenewal(WATCH_RETRY_MS);
      });
    }, delayMs);
    this.renewTimer.unref?.();
  }

  /** Run `work` in the background, kept alive by `waitUntil` when given. */
  private background(work: Promise<void>): void {
    this.opts.waitUntil?.(work);
  }

  /** Hand an email to the Channel. Emails in one thread go in order. */
  private enqueue(email: ParsedEmail, message: GmailMessage): void {
    const key = email.threadId;
    const previous = this.threadChains.get(key) ?? Promise.resolve();
    const next = previous
      .then(() => this.deliver(email, message))
      .catch((err: unknown) => {
        console.error("[channels-gmail] handling an email failed:", err);
      });
    this.threadChains.set(key, next);
    void next.finally(() => {
      if (this.threadChains.get(key) === next) this.threadChains.delete(key);
    });
    this.background(next);
  }

  private async deliver(
    email: ParsedEmail,
    message: GmailMessage,
  ): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    const { parts, notes } = await attachmentParts(
      email.attachments,
      (id) => this.client.getAttachment(email.id, id),
      this.opts.files,
    );
    const userText = email.text || email.subject;
    let contentParts: AgentContentPart[] | undefined;
    if (parts.length > 0 || notes.length > 0) {
      contentParts = [
        {
          type: "text",
          text: [userText, ...notes.map((n) => `(${n})`)].join("\n\n"),
        },
        ...parts,
      ];
    }
    const target: GmailReplyTarget = {
      threadId: email.threadId,
      inboundId: email.id,
      to: email.replyTo,
      subject: email.subject,
      ...(email.rfcMessageId ? { rfcMessageId: email.rfcMessageId } : {}),
      references: email.references,
    };
    const actor: ProviderActor = {
      id: email.fromAddress,
      kind: "human",
      email: email.fromAddress,
      ...(email.fromName ? { name: email.fromName } : {}),
    };
    const turn: IncomingTurn = {
      conversationKey: email.threadId,
      replyTarget: target,
      actor,
      identityContext: {
        tenant: { id: this.mailbox },
        installation: { id: this.mailbox },
        conversation: { id: email.threadId, kind: "email" },
        trigger: "message",
        event: {
          id: email.id,
          ...(email.receivedAt ? { occurredAt: email.receivedAt } : {}),
        },
        raw: message,
      },
      eventId: email.id,
      userText,
      operation: {
        kind: "created",
        logicalMessageId: email.id,
        revisionId: email.id,
        // Every email in the intake label is addressed to the bot.
        mentioned: true,
      },
      messageRef: { id: email.id, threadId: email.threadId },
      ...(contentParts ? { contentParts } : {}),
      platform: this.platform,
    };
    await sink.onTurn(turn);
  }

  private async send(
    target: GmailReplyTarget,
    body: EmailBody,
    attachments?: MimeAttachment[],
  ): Promise<GmailMessageRef> {
    const raw = buildReplyMime({
      from: this.address,
      ...(this.opts.fromName ? { fromName: this.opts.fromName } : {}),
      to: target.to,
      subject: target.subject,
      ...(target.rfcMessageId ? { inReplyTo: target.rfcMessageId } : {}),
      references: target.references,
      text: body.text,
      html: body.html,
      ...(attachments ? { attachments } : {}),
    });
    const sent = await this.client.send(raw, target.threadId);
    return { id: sent.id, threadId: sent.threadId };
  }

  /** Signs handler controls for one reply, when action links are on. */
  private linker(
    target: GmailReplyTarget,
  ): ((control: LinkControl) => string) | undefined {
    const actions = this.opts.actions;
    if (!actions) return undefined;
    return (control) =>
      actionUrl(
        actions.baseUrl,
        signAction(
          actions.secret,
          {
            id: control.id,
            ...(control.value !== undefined ? { value: control.value } : {}),
            conversationKey: target.threadId,
            recipient: target.to,
            label: control.label,
          },
          { ttlMs: actions.ttlMs ?? DEFAULT_ACTION_TTL_MS },
        ),
      );
  }

  private verifyLink(
    token: string,
  ): { claims: ActionClaims } | { response: Response } {
    if (!this.opts.actions) {
      return {
        response: page(
          "Link not available",
          "<p>This link is not active.</p>",
          404,
        ),
      };
    }
    const result = verifyAction(this.opts.actions.secret, token);
    if (result.ok) return { claims: result.claims };
    return result.reason === "expired"
      ? { response: page("Link expired", "<p>This link has expired.</p>", 410) }
      : {
          response: page(
            "Link not valid",
            "<p>This link is not valid.</p>",
            400,
          ),
        };
  }

  /** GET on a link: a confirm page. Mail scanners open links; only a POST acts. */
  private showAction(url: URL): Response {
    const token = url.searchParams.get(ACTION_PARAM) ?? "";
    const checked = this.verifyLink(token);
    if ("response" in checked) return checked.response;
    return confirmPage(token, checked.claims.label ?? "Run this action?");
  }

  /** POST on a link: check it, spend it, and dispatch the click. */
  private async runAction(request: Request): Promise<Response> {
    let token = new URL(request.url).searchParams.get(ACTION_PARAM) ?? "";
    try {
      const form = new URLSearchParams(await request.text());
      token = form.get(ACTION_PARAM) ?? token;
    } catch {
      // Keep the token from the URL.
    }
    const checked = this.verifyLink(token);
    if ("response" in checked) return checked.response;
    const sink = this.sink;
    if (!sink) {
      return page(
        "Not available",
        "<p>The service is not running. Try again later.</p>",
        503,
      );
    }
    const { claims } = checked;
    const ttl = Math.max(1000, claims.expiresAt - Date.now());
    if (
      await this.store.dedup.seen(`channels-gmail:action:${claims.nonce}`, ttl)
    ) {
      return page("Already done", "<p>This link was already used.</p>", 409);
    }
    const work = this.targetFor(claims)
      .then((target) => sink.onInteraction(this.interaction(claims, target)))
      .catch((err: unknown) => {
        console.error("[channels-gmail] handling a link click failed:", err);
      });
    this.background(work);
    return page("Done", "<p>Thanks. You can close this page.</p>");
  }

  /** Reply target for a click: the latest email in the thread from someone else. */
  private async targetFor(claims: ActionClaims): Promise<GmailReplyTarget> {
    const fallback: GmailReplyTarget = {
      threadId: claims.conversationKey,
      to: claims.recipient,
      subject: "",
      references: [],
    };
    try {
      const thread = await this.client.getThread(claims.conversationKey);
      const emails = (thread.messages ?? []).map(parseGmailMessage);
      const last =
        [...emails]
          .toReversed()
          .find((e) => !this.isOwnAddress(e.fromAddress)) ??
        emails[emails.length - 1];
      if (!last) return fallback;
      return {
        threadId: claims.conversationKey,
        to: claims.recipient,
        subject: last.subject,
        ...(last.rfcMessageId ? { rfcMessageId: last.rfcMessageId } : {}),
        references: last.references,
      };
    } catch (err) {
      console.warn(
        "[channels-gmail] could not read the thread for a click:",
        (err as Error).message,
      );
      return fallback;
    }
  }

  private interaction(
    claims: ActionClaims,
    target: GmailReplyTarget,
  ): InteractionEvent {
    const value = claims.value;
    return {
      id: claims.id,
      ...(value !== undefined ? { value } : {}),
      ...(typeof value === "string" ? { rawValue: value } : {}),
      conversationKey: claims.conversationKey,
      replyTarget: target,
      actor: { id: claims.recipient, kind: "human", email: claims.recipient },
      identityContext: {
        tenant: { id: this.mailbox },
        installation: { id: this.mailbox },
        conversation: { id: claims.conversationKey, kind: "email" },
        trigger: "interaction",
        event: { id: claims.nonce },
        raw: claims,
      },
      eventId: claims.nonce,
    };
  }
}
