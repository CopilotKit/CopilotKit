import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  InteractionEvent,
  RunRenderer,
  ConversationStore,
  UserQuery,
} from "@copilotkit/channels";
import type {
  ChannelNode,
  MessageRef,
  PlatformUser,
  ThreadMessage,
} from "@copilotkit/channels-ui";
import type {
  ReplyTarget,
  WhatsAppAdapterOptions,
  WhatsAppMessageRef,
  WebhookBody,
  InboundMessage,
} from "./types.js";
import { WhatsAppClient } from "./client.js";
import { WhatsAppConversationStore } from "./conversation-store.js";
import { InMemoryHistoryStore } from "./history-store.js";
import type { HistoryStore } from "./history-store.js";
import { WebhookServer } from "./webhook-server.js";
import { handleWebhookValue } from "./webhook-listener.js";
import { createRunRenderer } from "./event-renderer.js";
import { conversationKeyOf, decodeInteraction } from "./interaction.js";
import { renderWhatsAppMessage } from "./render/message.js";
import type { WhatsAppOutbound } from "./render/message.js";
import { markdownToWhatsApp } from "./markdown-to-wa.js";
import { WA_LIMITS } from "./render/budget.js";

/** Factory mirroring `slack(opts)`. */
export function whatsapp(opts: WhatsAppAdapterOptions): WhatsAppAdapter {
  return new WhatsAppAdapter(opts);
}

export class WhatsAppAdapter implements PlatformAdapter {
  readonly platform = "whatsapp";
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: false,
    supportsTyping: true,
    supportsReactions: false,
    supportsStreaming: false,
  };
  readonly ackDeadlineMs = 5000;
  readonly conversationStore: ConversationStore;

  client: WhatsAppClient;
  private readonly history: HistoryStore;
  private readonly server: WebhookServer;
  private readonly port: number;
  private readonly commandPrefix: string;
  private readonly interruptEventNames?: ReadonlySet<string>;
  private readonly waStore: WhatsAppConversationStore;
  private sink: IngressSink | undefined;

  constructor(private readonly opts: WhatsAppAdapterOptions) {
    this.client = new WhatsAppClient({
      accessToken: opts.accessToken,
      phoneNumberId: opts.phoneNumberId,
      apiVersion: opts.apiVersion,
      graphBaseUrl: opts.graphBaseUrl,
    });
    this.history = opts.historyStore ?? new InMemoryHistoryStore();
    this.waStore = new WhatsAppConversationStore({
      historyStore: this.history,
    });
    this.conversationStore = this.waStore;
    this.port = opts.port ?? 3000;
    this.commandPrefix = opts.commandPrefix ?? "/";
    this.interruptEventNames = opts.interruptEventNames;
    this.server = new WebhookServer({
      path: opts.path ?? "/webhook",
      verifyToken: opts.verifyToken,
      appSecret: opts.appSecret,
      onEvent: (body) => this.onWebhook(body),
    });
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;
    await this.server.start(this.port);
  }

  async stop(): Promise<void> {
    await this.server.stop();
  }

  private async onWebhook(body: WebhookBody): Promise<void> {
    if (!this.sink) return;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (!change.value) continue;
        await handleWebhookValue(change.value, {
          sink: this.sink,
          history: this.history,
          phoneNumberId: this.opts.phoneNumberId,
          commandPrefix: this.commandPrefix,
          client: this.client,
          files: this.opts.files ?? {},
        });
      }
    }
  }

  render(ir: ChannelNode[]): WhatsAppOutbound[] {
    return renderWhatsAppMessage(ir);
  }

  async post(target: ReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    const payloads = this.render(ir);
    let last: WhatsAppMessageRef = {
      id: "",
      to: target.to,
      phoneNumberId: target.phoneNumberId,
    };
    for (const p of payloads) {
      last = await this.client.sendMessage(target.to, p);
      this.recordOutbound(target.to, outboundText(p), last);
    }
    return last;
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    // WhatsApp can't edit messages; "update" posts a fresh message instead.
    const r = ref as unknown as WhatsAppMessageRef;
    await this.post({ to: r.to, phoneNumberId: r.phoneNumberId }, ir);
  }

  async stream(
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    // No live streaming: buffer the whole iterable, then send once.
    let text = "";
    for await (const c of chunks) text += c;
    return this.sendText(target.to, text);
  }

  async delete(_ref: MessageRef): Promise<void> {
    // WhatsApp has no message-delete API for business-sent messages; no-op.
  }

  createRunRenderer(target: ReplyTarget): RunRenderer {
    // `sendText` records each outbound message in history (with its wamid), so
    // the renderer doesn't need a separate `onAssistantText` history hook.
    return createRunRenderer({
      send: async (text) => {
        await this.sendText(target.to, text);
      },
      interruptEventNames: this.interruptEventNames,
    });
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    const r = raw as { message?: InboundMessage; replyTarget?: ReplyTarget };
    if (!r?.message || !r.replyTarget) return undefined;
    return decodeInteraction(r.message, r.replyTarget);
  }

  async lookupUser(_q: UserQuery): Promise<PlatformUser | undefined> {
    return undefined; // WhatsApp exposes no user directory.
  }

  async getMessages(target: ReplyTarget): Promise<ThreadMessage[]> {
    return this.waStore.getMessages(target);
  }

  async postFile(
    target: ReplyTarget,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    try {
      const mime = guessMime(args.filename);
      const mediaId = await this.client.uploadMedia(
        args.bytes,
        mime,
        args.filename,
      );
      const payload: WhatsAppOutbound = mime.startsWith("image/")
        ? {
            type: "image",
            image: {
              id: mediaId,
              ...(args.altText ? { caption: args.altText } : {}),
            },
          }
        : {
            type: "document",
            document: {
              id: mediaId,
              filename: args.filename,
              ...(args.title ? { caption: args.title } : {}),
            },
          };
      const ref = await this.client.sendMessage(target.to, payload);
      this.recordOutbound(
        target.to,
        args.title ??
          args.altText ??
          (mime.startsWith("image/") ? "[image]" : "[document]"),
        ref,
      );
      return { ok: true, fileId: mediaId };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Send agent/freeform text: convert markdown to WhatsApp formatting, split to ≤bodyText chunks. */
  private async sendText(
    to: string,
    text: string,
  ): Promise<WhatsAppMessageRef> {
    const body = markdownToWhatsApp(text);
    if (!body) return { id: "", to, phoneNumberId: this.opts.phoneNumberId };
    const parts = splitForWhatsApp(body, WA_LIMITS.bodyText);
    let last: WhatsAppMessageRef = {
      id: "",
      to,
      phoneNumberId: this.opts.phoneNumberId,
    };
    for (const part of parts) {
      last = await this.client.sendMessage(to, {
        type: "text",
        text: { body: part, preview_url: false },
      });
      this.recordOutbound(to, part, last);
    }
    return last;
  }

  /**
   * Record an outbound message in history keyed by its WhatsApp id, so a later
   * quote-reply to it (the webhook sends only the quoted id) resolves to this
   * text. Best-effort: no id or no text → skip. Errors are swallowed so a
   * history write can never break a send.
   */
  private recordOutbound(
    to: string,
    text: string,
    ref: WhatsAppMessageRef,
  ): void {
    if (!ref.id || !text) return;
    void this.history
      .append(conversationKeyOf(to), {
        role: "assistant",
        content: text,
        ts: `${Date.now()}`,
        id: ref.id,
      })
      .catch(() => {});
  }
}

/** A short text representation of an outbound payload, for history/quote-resolution. */
function outboundText(p: WhatsAppOutbound): string {
  switch (p.type) {
    case "text":
      return p.text.body;
    case "image":
      return p.image.caption ?? "[image]";
    case "document":
      return p.document.caption ?? p.document.filename ?? "[document]";
    case "interactive":
      return p.interactive.body.text;
  }
}

/** Split text into chunks no longer than `max` characters. */
export function splitForWhatsApp(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    parts.push(text.slice(i, i + max));
    i += max;
  }
  return parts;
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}
