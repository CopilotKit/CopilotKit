import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  InteractionEvent,
  RunRenderer,
  ConversationStore,
  UserQuery,
  ChannelEgress,
  ProviderEffect,
  EffectResultFor,
} from "@copilotkit/channels-core";
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
  InboundMessage,
} from "./types.js";
import type { WhatsAppConnector } from "./whatsapp-connector.js";
import { WhatsAppConversationStore } from "./conversation-store.js";
import { InMemoryHistoryStore } from "./history-store.js";
import type { HistoryStore } from "./history-store.js";
import { createRunRenderer } from "./event-renderer.js";
import { conversationKeyOf, decodeInteraction } from "./interaction.js";
import { renderWhatsAppMessage } from "./render/message.js";
import type { WhatsAppOutbound } from "./render/message.js";
import { markdownToWhatsApp } from "./markdown-to-wa.js";
import { WA_LIMITS } from "./render/budget.js";

/** Factory mirroring `slack(opts)`. */
export function whatsapp(opts: WhatsAppAdapterOptions = {}): WhatsAppAdapter {
  return new WhatsAppAdapter(opts);
}

/**
 * WhatsApp `PlatformAdapter` — CREDENTIAL-FREE (Task 3/T3s-4a). The adapter
 * builds nothing from tokens; it only renders and normalizes. Every
 * credential (`accessToken`/`phoneNumberId`/`appSecret`/`verifyToken`/`port`/
 * `path`/`apiVersion`/`graphBaseUrl`) now lives on
 * `WebClientWhatsAppConnectorOptions` instead — a runner constructs that
 * connector and injects it via `WhatsAppAdapter.ɵbindConnector` before
 * `start()`/any egress call. Running the adapter unbound throws (see the
 * `connector` getter below) — that's the intended "you need a custom
 * ChannelRunner" signpost for running Channels without CopilotKit
 * Intelligence.
 */
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

  /**
   * The runner-injected {@link WhatsAppConnector} — set exactly once, via
   * {@link ɵbindConnector}, before `start()`/any egress method. The adapter
   * holds NO credentials and builds nothing from tokens; every credentialed
   * operation routes through this connector. `undefined` until bound — the
   * `connector` getter throws a clear error if anything runs unbound.
   */
  private boundConnector: WhatsAppConnector | undefined;
  private readonly history: HistoryStore;
  private readonly commandPrefix: string;
  private readonly interruptEventNames?: ReadonlySet<string>;
  private readonly waStore: WhatsAppConversationStore;

  constructor(private readonly opts: WhatsAppAdapterOptions) {
    this.history = opts.historyStore ?? new InMemoryHistoryStore();
    this.waStore = new WhatsAppConversationStore({
      historyStore: this.history,
    });
    this.conversationStore = this.waStore;
    this.commandPrefix = opts.commandPrefix ?? "/";
    this.interruptEventNames = opts.interruptEventNames;
    // Credential-free construction (Task 3/T3s-4a): nothing token-shaped is
    // built here. The webhook HTTP server AND the egress Cloud API client now
    // both live inside a runner-injected `WhatsAppConnector` (see
    // `ɵbindConnector`).
  }

  /**
   * @internal Connector-injection seam. A runner (a custom `ChannelRunner`, or
   * the managed Connector Outbox's own binding path) calls this with a
   * credential-owning `WhatsAppConnector` — typically a `new
   * WebClientWhatsAppConnector({ accessToken, phoneNumberId, … })` — BEFORE
   * `start()` or any egress method runs. Every `PlatformAdapter` method this
   * class implements delegates to the bound connector; there is no
   * adapter-owned fallback. Marked with the ɵ prefix (Angular-style internal-
   * API marker) to signal this is plumbing for a runner, not a user-facing
   * option.
   */
  ɵbindConnector(connector: WhatsAppConnector): void {
    this.boundConnector = connector;
  }

  /**
   * The credentialed {@link WhatsAppConnector} every egress method routes
   * through — the one bound via {@link ɵbindConnector}. Throws if the
   * adapter is run unbound: running Channels without CopilotKit Intelligence
   * requires a custom `ChannelRunner` that supplies a connector (see docs).
   */
  private get connector(): WhatsAppConnector {
    if (!this.boundConnector) {
      throw new Error(
        "WhatsApp channel has no connector: running Channels without " +
          "CopilotKit Intelligence requires a custom ChannelRunner that " +
          "supplies a WhatsAppConnector (see docs).",
      );
    }
    return this.boundConnector;
  }

  /**
   * The declarative egress entry point (Channel Runner plan §2, design D2:
   * "adapter owns the effect→native mapping"): renders IR via the adapter's
   * own `render()` logic and routes every op to a RUNNER-supplied `connector`
   * instead of this adapter's internal one — driving the exact same native
   * Cloud API calls the `PlatformAdapter` methods below build, just against a
   * different credentialed sender (e.g. the Intelligence Connector Outbox).
   * WhatsApp has no reactions/ephemeral/suggested-prompts/thread-title
   * concept (see `capabilities`), so those ops resolve to the same
   * `{ ok: false, error }` shape `DirectAdapterEgress` returns for an absent
   * adapter method.
   */
  makeEgress(connector: WhatsAppConnector): ChannelEgress {
    return {
      send: async <E extends ProviderEffect>(
        effect: E,
      ): Promise<EffectResultFor<E>> => {
        switch (effect.op) {
          case "post":
            return (await this.postVia(
              connector,
              effect.target as ReplyTarget,
              effect.ir,
            )) as EffectResultFor<E>;
          case "update":
            await this.updateVia(connector, effect.ref, effect.ir);
            return effect.ref as EffectResultFor<E>;
          case "delete":
            await this.deleteVia(effect.ref);
            return undefined as EffectResultFor<E>;
          case "file":
            return (await this.postFileVia(
              connector,
              effect.target as ReplyTarget,
              effect.file,
            )) as EffectResultFor<E>;
          case "react":
            return {
              ok: false,
              error: "whatsapp does not support reactions",
            } as EffectResultFor<E>;
          case "ephemeral":
            return {
              ok: false,
              error: "whatsapp does not support ephemeral messages",
            } as EffectResultFor<E>;
          case "suggested":
            return {
              ok: false,
              error: "whatsapp does not support suggested prompts",
            } as EffectResultFor<E>;
          case "title":
            return {
              ok: false,
              error: "whatsapp does not support thread titles",
            } as EffectResultFor<E>;
        }
      },
      stream: (target, chunks) =>
        this.streamVia(connector, target as ReplyTarget, chunks),
      createRunRenderer: (target) =>
        this.createRunRendererVia(connector, target as ReplyTarget),
      getMessages: (target) => this.waStore.getMessages(target as ReplyTarget),
      lookupUser: () => Promise.resolve(undefined),
    };
  }

  /**
   * Delegates ALL ingress ownership to `this.connector` (Task 3b, plan §2
   * D3; Task 3/T3s-4a dropped every credential from this call — the bound
   * connector uses its OWN token): the webhook HTTP server (GET verify
   * handshake + signed POST intake) and every normalized turn/command/
   * interaction live in the connector's `startIngress` — this method only
   * hands over the ADAPTER-side config (`history`/`commandPrefix`/`files`,
   * whose decision logic stays here). Throws (via the `connector` getter) if
   * no connector has been bound via `ɵbindConnector`.
   */
  async start(sink: IngressSink): Promise<void> {
    await this.connector.startIngress({
      sink,
      history: this.history,
      commandPrefix: this.commandPrefix,
      files: this.opts.files ?? {},
    });
  }

  async stop(): Promise<void> {
    // Lenient (not the throwing `connector` getter): stopping an adapter that
    // was never bound/started is a harmless no-op, not a signpost-worthy error.
    await this.boundConnector?.stopIngress();
  }

  render(ir: ChannelNode[]): WhatsAppOutbound[] {
    return renderWhatsAppMessage(ir);
  }

  async post(target: ReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    return this.postVia(this.connector, target, ir);
  }

  /**
   * `post`'s connector-parameterized body. Shared by the `PlatformAdapter`
   * method (via `this.connector`) and `makeEgress` (via an injected
   * connector) so there is exactly one implementation of the effect→native
   * mapping.
   */
  private async postVia(
    connector: WhatsAppConnector,
    target: ReplyTarget,
    ir: ChannelNode[],
  ): Promise<MessageRef> {
    const payloads = this.render(ir);
    let last: WhatsAppMessageRef = {
      id: "",
      to: target.to,
      phoneNumberId: target.phoneNumberId,
    };
    for (const p of payloads) {
      last = await connector.sendMessage(target.to, p);
      this.recordOutbound(target.to, outboundText(p), last);
    }
    return last;
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    return this.updateVia(this.connector, ref, ir);
  }

  /**
   * WhatsApp can't edit messages; "update" posts a fresh message instead
   * (see {@link postVia}).
   */
  private async updateVia(
    connector: WhatsAppConnector,
    ref: MessageRef,
    ir: ChannelNode[],
  ): Promise<void> {
    const r = ref as unknown as WhatsAppMessageRef;
    await this.postVia(
      connector,
      { to: r.to, phoneNumberId: r.phoneNumberId },
      ir,
    );
  }

  async stream(
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    return this.streamVia(this.connector, target, chunks);
  }

  /**
   * No live streaming: buffer the whole iterable, then send once (see
   * {@link postVia}).
   */
  private async streamVia(
    connector: WhatsAppConnector,
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    let text = "";
    for await (const c of chunks) text += c;
    return this.sendTextVia(connector, target, text);
  }

  async delete(ref: MessageRef): Promise<void> {
    return this.deleteVia(ref);
  }

  /** WhatsApp has no message-delete API for business-sent messages; no-op. */
  private async deleteVia(_ref: MessageRef): Promise<void> {
    // no-op
  }

  createRunRenderer(target: ReplyTarget): RunRenderer {
    return this.createRunRendererVia(this.connector, target);
  }

  /** `createRunRenderer`'s connector-parameterized body (see {@link postVia}). */
  private createRunRendererVia(
    connector: WhatsAppConnector,
    target: ReplyTarget,
  ): RunRenderer {
    // `sendTextVia` records each outbound message in history (with its
    // wamid), so the renderer doesn't need a separate `onAssistantText`
    // history hook.
    return createRunRenderer({
      send: async (text) => {
        await this.sendTextVia(connector, target, text);
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
    return this.postFileVia(this.connector, target, args);
  }

  /** `postFile`'s connector-parameterized body (see {@link postVia}). */
  private async postFileVia(
    connector: WhatsAppConnector,
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
      const mediaId = await connector.uploadMedia(
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
      const ref = await connector.sendMessage(target.to, payload);
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

  /**
   * Send agent/freeform text: convert markdown to WhatsApp formatting, split
   * to ≤bodyText chunks (see {@link postVia}).
   */
  private async sendTextVia(
    connector: WhatsAppConnector,
    target: ReplyTarget,
    text: string,
  ): Promise<WhatsAppMessageRef> {
    const body = markdownToWhatsApp(text);
    if (!body)
      return { id: "", to: target.to, phoneNumberId: target.phoneNumberId };
    const parts = splitForWhatsApp(body, WA_LIMITS.bodyText);
    let last: WhatsAppMessageRef = {
      id: "",
      to: target.to,
      phoneNumberId: target.phoneNumberId,
    };
    for (const part of parts) {
      last = await connector.sendMessage(target.to, {
        type: "text",
        text: { body: part, preview_url: false },
      });
      this.recordOutbound(target.to, part, last);
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
