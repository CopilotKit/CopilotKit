import { MemoryStore } from "@copilotkit/channels-core";
import type {
  ConversationStore,
  IncomingTurn,
  IngressSink,
  InteractionEvent,
  PlatformAdapter,
  RunRenderer,
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
  DEFAULT_ACTION_LINK_TTL_MS,
  actionLinkUrl,
  signActionLink,
  verifyActionLink,
} from "./action-links.js";
import type { ActionLinkClaims } from "./action-links.js";
import { buildAttachmentParts } from "./attachments.js";
import { ResendClient } from "./client.js";
import type {
  ResendOutboundAttachment,
  ResendReceivedEmail,
  ResendSendPayload,
} from "./client.js";
import { ResendConversationStore } from "./conversation-store.js";
import { NodeServer } from "./node-server.js";
import { extractReplyText } from "./quote.js";
import { escapeHtml, renderEmail, renderMarkdownEmail } from "./render.js";
import type { EmailBody, EmailControl } from "./render.js";
import { createEmailRunRenderer } from "./run-renderer.js";
import { verifyWebhook } from "./svix.js";
import { ResendThreadStore } from "./thread-store.js";
import type { ResendThreadState } from "./thread-store.js";
import {
  addressKey,
  formatMailbox,
  normalizeMessageId,
  parseMailbox,
  parseMessageIds,
  replyHeaders,
  replySubject,
} from "./threading.js";
import type { Mailbox } from "./threading.js";
import type {
  ResendAdapterOptions,
  ResendMessageRef,
  ResendReplyTarget,
} from "./types.js";

/**
 * Largest email Resend accepts, in bytes, counted after base64-encoding the
 * attachments. `postFile` keeps a margin for the body and headers.
 */
export const RESEND_MAX_EMAIL_BYTES = 40 * 1024 * 1024;
const BODY_MARGIN_BYTES = 512 * 1024;

/** Create a Resend (email) adapter. Mirrors `slack(opts)`, `whatsapp(opts)`, … */
export function resend(opts: ResendAdapterOptions): ResendAdapter {
  return new ResendAdapter(opts);
}

/** The shape of a Resend webhook body this adapter reads. */
interface WebhookEvent {
  type?: unknown;
  created_at?: unknown;
  data?: {
    email_id?: unknown;
    from?: unknown;
    to?: unknown;
    cc?: unknown;
    received_for?: unknown;
  };
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/** Case-insensitive header lookup on a received email. */
function headerOf(
  email: ResendReceivedEmail,
  name: string,
): string | string[] | undefined {
  const headers = email.headers ?? {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function firstHeader(
  email: ResendReceivedEmail,
  name: string,
): string | undefined {
  const value = headerOf(email, name);
  return Array.isArray(value) ? value[0] : value;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#1f2328;line-height:1.5"><h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // The link token is in the URL: never send it to another site.
      "referrer-policy": "no-referrer",
      // The confirmation button must not be framed (clickjacking).
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      "x-frame-options": "DENY",
    },
  });
}

/**
 * A direct adapter for email through Resend.
 *
 * Inbound: Resend posts an `email.received` webhook to
 * {@link ResendAdapter.handler}. The adapter checks the Svix signature,
 * fetches the email's body and attachments from the Resend API, and hands
 * the Channel one turn per email. Each email thread is one conversation.
 *
 * Outbound: email cannot stream or edit. The adapter collects an agent's
 * reply and sends it as one email, in the same thread, to the sender of
 * the latest email.
 */
export class ResendAdapter implements PlatformAdapter {
  readonly platform = "resend";
  readonly capabilities: SurfaceCapabilities = {
    supportsMessageEvents: true,
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    supportsStreaming: false,
    supportsSuggestedPrompts: false,
    supportsThreadTitle: false,
    supportsEphemeral: false,
  };
  readonly ackDeadlineMs = 10_000;
  readonly conversationStore: ConversationStore;

  /** The Resend API client the adapter uses. */
  readonly client: ResendClient;
  private readonly threads: ResendThreadStore;
  private readonly store: ResendConversationStore;
  private readonly sender: Mailbox;
  private readonly fromHeader: string;
  private readonly replyTo: string[];
  private readonly allowed: ReadonlySet<string> | undefined;
  private readonly interruptEventNames: ReadonlySet<string>;
  private readonly server: NodeServer | undefined;
  private sink: IngressSink | undefined;

  constructor(private readonly opts: ResendAdapterOptions) {
    if (!opts.apiKey) throw new Error("resend: `apiKey` is required");
    if (!opts.webhookSecret) {
      throw new Error("resend: `webhookSecret` is required");
    }
    const sender = parseMailbox(opts.from);
    if (!sender) {
      throw new Error(
        'resend: `from` must be an address like "Bot <bot@example.com>"',
      );
    }
    this.sender = sender;
    this.fromHeader = formatMailbox(sender);
    this.replyTo = (
      typeof opts.replyTo === "string" ? [opts.replyTo] : (opts.replyTo ?? [])
    ).map((value) => {
      const mailbox = parseMailbox(value);
      if (!mailbox) throw new Error(`resend: invalid replyTo address`);
      return formatMailbox(mailbox);
    });
    this.allowed = opts.allowedRecipients
      ? new Set(opts.allowedRecipients.map(addressKey))
      : undefined;
    if (opts.actions) {
      // Fail at startup, not on the first email.
      const base = new URL(opts.actions.baseUrl);
      if (base.protocol !== "https:" && base.protocol !== "http:") {
        throw new Error("resend: `actions.baseUrl` must be an http(s) URL");
      }
      if (!opts.actions.secret) {
        throw new Error("resend: `actions.secret` is required");
      }
    }
    this.client = new ResendClient({
      apiKey: opts.apiKey,
      baseUrl: opts.apiUrl,
      fetch: opts.fetch,
    });
    this.threads = new ResendThreadStore(opts.store ?? new MemoryStore());
    this.store = new ResendConversationStore(this.threads);
    this.conversationStore = this.store;
    this.interruptEventNames =
      opts.interruptEventNames ?? new Set(["on_interrupt"]);
    this.server =
      opts.port === undefined
        ? undefined
        : new NodeServer({
            port: opts.port,
            host: opts.host,
            path: opts.path ?? "/",
            handler: (request) => this.handler(request),
          });
    this.handler = this.handler.bind(this);
  }

  /** The bound port of the `port` server, after `start()`. */
  get port(): number | undefined {
    return this.server?.port;
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;
    await this.server?.start();
  }

  async stop(): Promise<void> {
    await this.server?.stop();
    this.sink = undefined;
  }

  /**
   * Fetch-style request handler. Mount it on the route you give Resend as
   * the webhook URL (Next.js route handler, Hono, Bun, Deno, a Worker, …).
   * The same route serves signed action links (`?ck_action=...`).
   *
   * The Channel must be started first (`channel.start()`); before that the
   * handler answers `503`, and Resend retries the webhook later.
   */
  async handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get(ACTION_PARAM);
    if (token !== null) return this.handleActionLink(request, token);
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json", allow: "POST" },
      });
    }
    const sink = this.sink;
    if (!sink) return json(503, { error: "channel is not started" });

    const body = await request.text();
    const verified = verifyWebhook({
      secret: this.opts.webhookSecret,
      headers: request.headers,
      body,
    });
    if (!verified.ok) return json(401, { error: "invalid signature" });

    let event: WebhookEvent;
    try {
      event = JSON.parse(body) as WebhookEvent;
    } catch {
      return json(400, { error: "body is not JSON" });
    }
    if (event.type !== "email.received") {
      return json(200, { ignored: "event type" });
    }
    const emailId = event.data?.email_id;
    if (typeof emailId !== "string" || emailId.length === 0) {
      return json(400, { error: "missing data.email_id" });
    }
    if (await this.threads.emailSeen(emailId)) {
      return json(200, { ignored: "duplicate" });
    }
    const skip = this.skipReason(strings(event.data?.from)[0], [
      ...strings(event.data?.to),
      ...strings(event.data?.cc),
      ...strings(event.data?.received_for),
    ]);
    if (skip) return json(200, { ignored: skip });

    let turn: IncomingTurn | string;
    try {
      turn = await this.buildTurn(emailId);
    } catch (err) {
      // Resend retries non-2xx deliveries, so a failed fetch is tried again.
      console.error(`[channels-resend] could not read email ${emailId}:`, err);
      return json(502, { error: "could not read the email from Resend" });
    }
    if (typeof turn === "string") return json(200, { ignored: turn });

    const work = Promise.resolve()
      .then(() => sink.onTurn(turn))
      .catch((err: unknown) => {
        console.error(
          `[channels-resend] turn for email ${emailId} failed:`,
          err,
        );
      });
    this.opts.waitUntil?.(work);
    return json(200, { ok: true });
  }

  render(ir: ChannelNode[]): EmailBody {
    return renderEmail(ir);
  }

  async post(target: unknown, ir: ChannelNode[]): Promise<MessageRef> {
    const t = target as ResendReplyTarget;
    const body = renderEmail(ir, {
      linkFor: this.opts.actions
        ? (control) => this.linkFor(t, control)
        : undefined,
    });
    return this.send(t, body);
  }

  /** Sent email cannot be edited. */
  async update(_ref: MessageRef, _ir: ChannelNode[]): Promise<void> {
    throw new Error(
      "Resend cannot edit an email after it is sent. Post a new reply instead.",
    );
  }

  /** Sent email cannot be taken back. */
  async delete(_ref: MessageRef): Promise<void> {
    throw new Error(
      "Resend cannot delete an email from the recipient's mailbox.",
    );
  }

  /** Collect the whole stream, then send it as one email. */
  async stream(
    target: unknown,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    let text = "";
    for await (const chunk of chunks) text += chunk;
    return this.send(target as ResendReplyTarget, renderMarkdownEmail(text));
  }

  createRunRenderer(target: unknown): RunRenderer {
    const t = target as ResendReplyTarget;
    return createEmailRunRenderer({
      send: async (text) => {
        await this.send(t, renderMarkdownEmail(text));
      },
      interruptEventNames: this.interruptEventNames,
    });
  }

  /**
   * Decode a signed action token (or a full action URL) into an interaction
   * event. The request handler does this itself, and also checks that the
   * link was not used before; this method exists for custom transports and
   * does not check reuse.
   */
  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    if (!this.opts.actions || typeof raw !== "string") return undefined;
    let token = raw;
    if (raw.includes(`${ACTION_PARAM}=`)) {
      try {
        token = new URL(raw).searchParams.get(ACTION_PARAM) ?? "";
      } catch {
        return undefined;
      }
    }
    const result = verifyActionLink(this.opts.actions.secret, token);
    return result.ok
      ? this.interactionFor(result.claims, undefined)
      : undefined;
  }

  async lookupUser(_q: UserQuery): Promise<ProviderActor | undefined> {
    return undefined; // Email has no user directory.
  }

  async getMessages(target: unknown): Promise<ThreadMessage[]> {
    return this.store.getMessages(target as ResendReplyTarget);
  }

  /**
   * Send a file as an email attachment. The email body is the `title`,
   * else the `altText`, else the file name. Resend accepts up to 40 MB per
   * email after base64 encoding, so files over about 29 MB are refused.
   */
  async postFile(
    target: unknown,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<PostFileResult> {
    const encodedSize = Math.ceil(args.bytes.byteLength / 3) * 4;
    if (encodedSize > RESEND_MAX_EMAIL_BYTES - BODY_MARGIN_BYTES) {
      return {
        ok: false,
        error: `file is too large for email (${args.bytes.byteLength} bytes; Resend allows 40 MB per email after encoding)`,
      };
    }
    const filename = args.filename.replace(/[\r\n"\\/]/g, "_") || "file";
    const attachment: ResendOutboundAttachment = {
      filename,
      content: Buffer.from(args.bytes).toString("base64"),
    };
    try {
      const ref = await this.send(
        target as ResendReplyTarget,
        renderMarkdownEmail(args.title ?? args.altText ?? filename),
        [attachment],
      );
      return { ok: true, fileId: ref.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  /** Why an email should be skipped, or `undefined` to handle it. */
  private skipReason(
    from: string | undefined,
    recipients: readonly string[],
  ): string | undefined {
    const sender = parseMailbox(from);
    if (!sender) return "no sender";
    if (addressKey(sender.address) === addressKey(this.sender.address)) {
      return "sent by the bot";
    }
    if (this.allowed) {
      const addressed = recipients.some((value) => {
        const mailbox = parseMailbox(value);
        return (
          mailbox !== undefined &&
          this.allowed!.has(addressKey(mailbox.address))
        );
      });
      if (!addressed) return "recipient not allowed";
    }
    return undefined;
  }

  /** Read a received email and turn it into a Channel turn, or a skip reason. */
  private async buildTurn(emailId: string): Promise<IncomingTurn | string> {
    const email = await this.client.getReceivedEmail(emailId);
    const sender =
      parseMailbox(firstHeader(email, "from")) ?? parseMailbox(email.from);
    if (!sender) return "no sender";
    const skip = this.skipReason(sender.address, [
      ...(email.to ?? []),
      ...(email.cc ?? []),
      ...(email.received_for ?? []),
    ]);
    if (skip) return skip;
    const dmarc = email.authentication?.dmarc?.toLowerCase();
    if (dmarc === "fail") return "dmarc failed";
    if (this.opts.requireDmarcPass && dmarc !== "pass")
      return "dmarc not passed";

    const headers = {
      messageId:
        normalizeMessageId(email.message_id) ??
        normalizeMessageId(firstHeader(email, "message-id")),
      inReplyTo: parseMessageIds(headerOf(email, "in-reply-to")),
      references: parseMessageIds(headerOf(email, "references")),
    };
    const conversationKey =
      (await this.threads.resolveConversation(headers)) ??
      `resend:email:${emailId}`;
    const startsThread =
      headers.inReplyTo.length === 0 && headers.references.length === 0;

    const body = extractReplyText(email);
    const subject = (email.subject ?? "").trim();
    // A new thread's subject is often the whole request ("Reset my password").
    const text =
      startsThread && subject
        ? body
          ? `Subject: ${subject}\n\n${body}`
          : subject
        : body || subject;

    let parts: AgentContentPart[] = [];
    if ((email.attachments?.length ?? 0) > 0) {
      const built = await buildAttachmentParts(
        emailId,
        this.client,
        this.opts.files,
      );
      parts = built.parts;
      for (const note of built.notes) {
        console.warn(`[channels-resend] email ${emailId}: ${note}`);
      }
    }
    if (!text && parts.length === 0) return "empty email";

    // Claim last: a failure above leaves the email unclaimed, so Resend's retry works.
    if (!(await this.threads.claimEmail(emailId))) return "duplicate";

    const reply = replyHeaders(headers.messageId, headers.references);
    const target: ResendReplyTarget = {
      conversationKey,
      to: sender,
      subject: replySubject(subject),
      ...(reply.inReplyTo ? { inReplyTo: reply.inReplyTo } : {}),
      references: reply.references,
      inbound: {
        id: emailId,
        content: parts.length > 0 ? [{ type: "text", text }, ...parts] : text,
      },
    };
    if (headers.messageId) {
      await this.threads.rememberMessage(headers.messageId, conversationKey);
    }
    await this.threads.setThread(conversationKey, {
      to: target.to,
      subject: target.subject,
      ...(target.inReplyTo ? { inReplyTo: target.inReplyTo } : {}),
      references: target.references,
    });
    await this.threads.appendHistory(conversationKey, {
      role: "user",
      text,
      id: emailId,
      ts: Date.now(),
    });

    const actor = this.actorFor(sender);
    return {
      conversationKey,
      replyTarget: target,
      actor,
      identityContext: {
        tenant: { id: addressKey(this.sender.address) },
        installation: { id: addressKey(this.sender.address) },
        conversation: { id: conversationKey, kind: "email-thread" },
        trigger: "message",
        event: {
          id: emailId,
          ...(email.created_at ? { occurredAt: email.created_at } : {}),
        },
        raw: email,
      },
      eventId: emailId,
      userText: text,
      operation: {
        kind: "created",
        logicalMessageId: emailId,
        revisionId: emailId,
        // Every email to the bot is addressed to it.
        mentioned: true,
      },
      messageRef: { id: emailId, conversationKey },
      ...(parts.length > 0
        ? { contentParts: [{ type: "text" as const, text }, ...parts] }
        : {}),
      platform: this.platform,
    };
  }

  private actorFor(mailbox: Mailbox): ProviderActor {
    return {
      id: addressKey(mailbox.address),
      kind: "human",
      email: mailbox.address,
      ...(mailbox.name ? { name: mailbox.name } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  private async send(
    target: ResendReplyTarget,
    body: EmailBody,
    attachments?: ResendOutboundAttachment[],
  ): Promise<ResendMessageRef> {
    const headers: Record<string, string> = {};
    if (target.inReplyTo) headers["In-Reply-To"] = target.inReplyTo;
    if (target.references.length > 0) {
      headers["References"] = target.references.join(" ");
    }
    const payload: ResendSendPayload = {
      from: this.fromHeader,
      to: [formatMailbox(target.to)],
      subject: target.subject,
      html: body.html,
      text: body.text,
      ...(this.replyTo.length > 0 ? { reply_to: this.replyTo } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(attachments ? { attachments } : {}),
    };
    const { id } = await this.client.sendEmail(payload);
    try {
      await this.threads.appendHistory(target.conversationKey, {
        role: "assistant",
        text: body.text,
        id,
        ts: Date.now(),
      });
    } catch (err) {
      // The email is sent; a history write must not turn that into a failure.
      console.warn("[channels-resend] could not record a sent email:", err);
    }
    return { id, conversationKey: target.conversationKey };
  }

  // -------------------------------------------------------------------------
  // Action links
  // -------------------------------------------------------------------------

  private linkFor(target: ResendReplyTarget, control: EmailControl): string {
    const actions = this.opts.actions!;
    const token = signActionLink(actions.secret, {
      actionId: control.actionId,
      ...(control.value !== undefined ? { value: control.value } : {}),
      conversationKey: target.conversationKey,
      recipient: target.to.address,
      expiresAt: Date.now() + (actions.ttlMs ?? DEFAULT_ACTION_LINK_TTL_MS),
      label: control.label.slice(0, 120),
    });
    return actionLinkUrl(actions.baseUrl, token);
  }

  private interactionFor(
    claims: ActionLinkClaims,
    stored: ResendThreadState | undefined,
  ): InteractionEvent {
    const recipient = addressKey(claims.recipient);
    const to: Mailbox =
      stored && addressKey(stored.to.address) === recipient
        ? stored.to
        : { address: claims.recipient };
    const replyTarget: ResendReplyTarget = stored
      ? { ...stored, conversationKey: claims.conversationKey, to }
      : {
          conversationKey: claims.conversationKey,
          to,
          subject: replySubject(undefined),
          references: [],
        };
    return {
      id: claims.actionId,
      ...("value" in claims ? { value: claims.value } : {}),
      ...(typeof claims.value === "string" ? { rawValue: claims.value } : {}),
      conversationKey: claims.conversationKey,
      replyTarget,
      actor: this.actorFor(to),
      identityContext: {
        tenant: { id: addressKey(this.sender.address) },
        installation: { id: addressKey(this.sender.address) },
        conversation: { id: claims.conversationKey, kind: "email-thread" },
        trigger: "interaction",
        event: { id: claims.nonce },
        raw: claims,
      },
      eventId: `link:${claims.nonce}`,
      platform: this.platform,
    };
  }

  private async handleActionLink(
    request: Request,
    token: string,
  ): Promise<Response> {
    const actions = this.opts.actions;
    if (!actions) return page(404, "Not found", "");
    if (request.method !== "GET" && request.method !== "POST") {
      return page(405, "Not allowed", "");
    }
    const result = verifyActionLink(actions.secret, token);
    if (!result.ok) {
      return result.reason === "expired"
        ? page(
            410,
            "This link has expired",
            "<p>Reply to the email instead.</p>",
          )
        : page(400, "This link is not valid", "");
    }
    const { claims } = result;
    const confirm = actions.confirm ?? true;
    if (request.method === "GET" && confirm) {
      // Opening the link does nothing yet: mail scanners open links too.
      return page(
        200,
        "Confirm your choice",
        `<p>${escapeHtml(claims.label)}</p><form method="post"><button type="submit" style="padding:8px 16px;border:1px solid #1f6feb;border-radius:6px;background:#1f6feb;color:#fff;font-weight:600;font-size:14px;cursor:pointer">Confirm</button></form>`,
      );
    }
    const sink = this.sink;
    if (!sink) return page(503, "Try again later", "");
    const fresh = await this.threads.consumeNonce(
      claims.nonce,
      claims.expiresAt - Date.now(),
    );
    if (!fresh) return page(409, "This link was already used", "");
    const stored = await this.threads.getThread(claims.conversationKey);
    const event = this.interactionFor(claims, stored);
    const work = Promise.resolve()
      .then(() => sink.onInteraction(event))
      .catch((err: unknown) => {
        console.error("[channels-resend] action link failed:", err);
      });
    this.opts.waitUntil?.(work);
    return page(
      200,
      "Done",
      `<p>Your choice was sent: ${escapeHtml(claims.label)}. You can close this page.</p>`,
    );
  }
}
