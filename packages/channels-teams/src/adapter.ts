import type { TurnContext } from "@microsoft/agents-hosting";
import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  InteractionEvent,
  RunRenderer,
  ReplyTarget,
  ConversationStore,
  MessageRef,
  PlatformUser,
  UserQuery,
  ChannelEgress,
  ProviderEffect,
  EffectResultFor,
} from "@copilotkit/channels-core";
import type { ChannelNode, ThreadMessage } from "@copilotkit/channels-ui";
import type {
  Activity,
  ConversationReference,
} from "@microsoft/agents-activity";
import { TeamsConversationStore } from "./conversation-store.js";
import { createRunRenderer } from "./event-renderer.js";
import { renderTeamsMarkdown } from "./render/markdown.js";
import { renderAdaptiveCard, isPlainText } from "./render/adaptive-card.js";
import { conversationKeyOf, parseCardAction } from "./interaction.js";
import { TeamsMessageStream } from "./message-stream.js";
import type { TeamsAdapterOptions, TeamsReplyTarget } from "./types.js";
import type {
  TeamsConnector,
  TeamsActivityPayload,
  TeamsSendTarget,
} from "./teams-connector.js";

/**
 * A Teams `MessageRef`. `context` is a live turn context when one is in scope;
 * `reference` lets `update`/`delete` re-enter the conversation out-of-turn (via
 * the connector's proactive send) when it isn't, e.g. editing a picker card
 * after the agent run that posted it has detached from its inbound turn.
 */
interface TeamsMessageRef extends MessageRef {
  conversationKey: string;
  context?: TurnContext;
  reference?: Partial<ConversationReference>;
}

/**
 * Microsoft Teams `PlatformAdapter` — CREDENTIAL-FREE. The adapter builds
 * nothing from tokens; it only renders, decides, and holds the in-memory
 * conversation transcript. Every credentialed operation (the `CloudAdapter`,
 * the `POST /api/messages` HTTP listener, proactive `continueConversation`
 * re-entry, and Graph channel-file reads) now lives on a runner-injected
 * {@link TeamsConnector} (see `teams-connector.ts`), bound via
 * {@link ɵbindConnector} before `start()`/any egress call.
 *
 * Adaptive Card `Action.Submit` clicks arrive (via the connector) as Message
 * activities carrying the action `data` in `activity.value`; those are
 * decoded and routed to `sink.onInteraction` to resolve the waiter.
 */
export class TeamsAdapter implements PlatformAdapter {
  readonly platform = "teams";
  readonly capabilities: SurfaceCapabilities;
  // Teams keeps the inbound HTTP turn open while the bot works; ~15s is the
  // practical channel window. Declarative today (the engine doesn't enforce it).
  readonly ackDeadlineMs = 15000;

  private readonly store = new TeamsConversationStore();
  private sink: IngressSink | undefined;

  /**
   * The runner-injected {@link TeamsConnector} — set exactly once, via
   * {@link ɵbindConnector}, before `start()`/any egress call. The adapter
   * holds NO credentials and builds nothing from tokens; every credentialed
   * operation routes through this connector. `undefined` until bound — the
   * `connector` getter throws a clear error if anything runs unbound.
   */
  private boundConnector: TeamsConnector | undefined;

  constructor(private readonly opts: TeamsAdapterOptions = {}) {
    this.capabilities = {
      supportsModals: false,
      supportsTyping: true,
      supportsReactions: false,
      // Streamed by message edit (post-then-updateActivity), not native
      // token-by-token streaming, but the engine's streaming path is honored.
      supportsStreaming: true,
    };
    // Credential-free construction: nothing token-shaped is built here. The
    // CloudAdapter/HTTP listener now both live inside a runner-injected
    // TeamsConnector (see `ɵbindConnector`).
  }

  /**
   * @internal Connector-injection seam. A runner (a custom `ChannelRunner`, or
   * the managed Connector Outbox's own binding path) calls this with a
   * credential-owning `TeamsConnector` — typically a `new
   * CloudAdapterTeamsConnector({ clientId, clientSecret, tenantId, … })` —
   * BEFORE `start()` or any egress method runs. Every `PlatformAdapter` method
   * this class implements delegates to the bound connector; there is no
   * adapter-owned fallback. Marked with the ɵ prefix (Angular-style internal
   * marker) to signal this is plumbing for a runner, not a user-facing option.
   */
  ɵbindConnector(connector: TeamsConnector): void {
    this.boundConnector = connector;
  }

  /**
   * The credentialed {@link TeamsConnector} every egress method routes
   * through — the one bound via {@link ɵbindConnector}. Throws if the
   * adapter is run unbound: running Channels without CopilotKit Intelligence
   * requires a custom `ChannelRunner` that supplies a connector (see docs).
   */
  private get connector(): TeamsConnector {
    if (!this.boundConnector) {
      throw new Error(
        "Teams channel has no connector: running Channels without CopilotKit " +
          "Intelligence requires a custom ChannelRunner that supplies a " +
          "TeamsConnector (see docs).",
      );
    }
    return this.boundConnector;
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;
    const connector = this.connector; // throws if unbound
    await connector.startIngress({
      sink,
      files: this.opts.files,
      recordUser: (key, content) => this.store.recordUser(key, content),
    });
  }

  async stop(): Promise<void> {
    // Lenient (not the throwing `connector` getter): stopping an adapter that
    // was never bound/started is a harmless no-op, not a signpost-worthy error.
    await this.boundConnector?.stopIngress();
  }

  /**
   * The declarative egress entry point (Channel Runner plan §2): renders IR
   * via the adapter's own render logic and routes every op to a
   * RUNNER-supplied `connector` instead of this adapter's internal one. Every
   * op here is a thin call into the SAME `*Via(connector, …)` helper the
   * `PlatformAdapter` method (via `this.connector`) also calls — one egress
   * implementation, two entry points.
   */
  makeEgress(connector: TeamsConnector): ChannelEgress {
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
            return {
              ok: false,
              error: "teams does not support reactions",
            } as EffectResultFor<E>;
          case "ephemeral":
            return {
              ok: false,
              error: "teams does not support ephemeral messages",
            } as EffectResultFor<E>;
          case "file":
            return (await this.postFileVia(
              connector,
              effect.target,
              effect.file,
            )) as EffectResultFor<E>;
          case "suggested":
            return {
              ok: false,
              error: "teams does not support suggested prompts",
            } as EffectResultFor<E>;
          case "title":
            return {
              ok: false,
              error: "teams does not support thread titles",
            } as EffectResultFor<E>;
        }
      },
      stream: (target, chunks) => this.streamVia(connector, target, chunks),
      createRunRenderer: (target) =>
        this.createRunRendererVia(connector, target),
      getMessages: (target) => this.getMessages(target),
      lookupUser: (q) => this.lookupUser(q),
    };
  }

  /**
   * Render IR to a native payload: plain text when it collapses to text,
   * otherwise an Adaptive Card. (A bare `Echo: hi` is a text bubble; structured
   * or interactive UI becomes a card.)
   */
  render(ir: ChannelNode[]): TeamsActivityPayload {
    return isPlainText(ir)
      ? { text: renderTeamsMarkdown(ir) }
      : { card: renderAdaptiveCard(ir) };
  }

  async post(target: ReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    return this.postVia(this.connector, target, ir);
  }

  /** `post`'s connector-parameterized body (see {@link makeEgress}). */
  private async postVia(
    connector: TeamsConnector,
    target: ReplyTarget,
    ir: ChannelNode[],
  ): Promise<MessageRef> {
    const t = target as TeamsReplyTarget;
    const payload = this.render(ir);
    const id = await connector.sendActivity(t as TeamsSendTarget, payload);
    return { id, conversationKey: t.conversationKey, context: t.context };
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    return this.updateVia(this.connector, ref, ir);
  }

  /** `update`'s connector-parameterized body (see {@link makeEgress}). */
  private async updateVia(
    connector: TeamsConnector,
    ref: MessageRef,
    ir: ChannelNode[],
  ): Promise<void> {
    const r = ref as TeamsMessageRef;
    if (!r.id) return;
    const payload = this.render(ir);
    await connector.updateActivity(r as TeamsSendTarget, r.id, payload);
  }

  async stream(
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    return this.streamVia(this.connector, target, chunks);
  }

  /**
   * Stream a text reply by message edit: post the first content, then
   * `updateActivity` the same message as the buffer grows (throttled). This is
   * Teams' baseline streaming model: no native token streaming.
   */
  private async streamVia(
    connector: TeamsConnector,
    target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as TeamsReplyTarget;
    const stream = new TeamsMessageStream({
      post: (text) => connector.sendActivity(t as TeamsSendTarget, { text }),
      update: (id, text) =>
        connector.updateActivity(t as TeamsSendTarget, id, { text }),
      typing: () => connector.sendTyping(t as TeamsSendTarget),
    });
    let acc = "";
    for await (const chunk of chunks) {
      acc += chunk;
      stream.append(acc);
    }
    const id = (await stream.finish()) ?? "";
    return { id, conversationKey: t.conversationKey, context: t.context };
  }

  async delete(ref: MessageRef): Promise<void> {
    return this.deleteVia(this.connector, ref);
  }

  /** `delete`'s connector-parameterized body (see {@link makeEgress}). */
  private async deleteVia(
    connector: TeamsConnector,
    ref: MessageRef,
  ): Promise<void> {
    const r = ref as TeamsMessageRef;
    if (!r.id) return;
    await connector.deleteActivity(r as TeamsSendTarget, r.id);
  }

  /**
   * Post a file to the conversation. Teams renders an image inline when it's
   * sent as an attachment whose `contentUrl` is a `data:` URI, so we base64 the
   * bytes into one — exactly what `render_chart`/`render_diagram` need to drop a
   * PNG into the thread (the bot-slack `postFile` parallel). Non-image bytes are
   * still attached with their inferred MIME; whether Teams previews them is up
   * to the client. Sends via the connector, on the live turn context or
   * proactively by reference.
   */
  async postFile(
    target: ReplyTarget,
    file: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    return this.postFileVia(this.connector, target, file);
  }

  /** `postFile`'s connector-parameterized body (see {@link makeEgress}). */
  private async postFileVia(
    connector: TeamsConnector,
    target: ReplyTarget,
    {
      bytes,
      filename,
      altText,
    }: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const t = target as TeamsReplyTarget;
    const mime = mimeFromFilename(filename);
    const base64 = Buffer.from(bytes).toString("base64");
    try {
      const fileId = await connector.sendFile(t as TeamsSendTarget, {
        contentType: mime,
        contentUrl: `data:${mime};base64,${base64}`,
        name: altText ?? filename,
      });
      return { ok: true, fileId };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  createRunRenderer(target: ReplyTarget): RunRenderer {
    return this.createRunRendererVia(this.connector, target);
  }

  /** `createRunRenderer`'s connector-parameterized body (see {@link makeEgress}). */
  private createRunRendererVia(
    connector: TeamsConnector,
    target: ReplyTarget,
  ): RunRenderer {
    const t = target as TeamsReplyTarget;
    return createRunRenderer({
      interruptEventNames: this.opts.interruptEventNames,
      post: (text) => connector.sendActivity(t as TeamsSendTarget, { text }),
      update: (id, text) =>
        connector.updateActivity(t as TeamsSendTarget, id, { text }),
      typing: () => connector.sendTyping(t as TeamsSendTarget),
      recordAssistant: (text) =>
        this.store.recordAssistant(t.conversationKey, text),
    });
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    const activity = raw as Activity;
    const action = parseCardAction(activity);
    if (!action) return undefined;
    const conversationKey = conversationKeyOf(activity);
    const reference = activity.getConversationReference?.();
    const from = activity.from;
    return {
      id: action.id,
      conversationKey,
      value: action.value,
      user: from?.id ? { id: from.id, name: from.name } : undefined,
      replyTarget: { conversationKey, reference } satisfies TeamsReplyTarget,
      messageRef: {
        id: activity.replyToId ?? "",
        conversationKey,
        reference,
      } as TeamsMessageRef,
    };
  }

  async lookupUser(_q: UserQuery): Promise<PlatformUser | undefined> {
    // Directory lookups require Microsoft Graph; not wired in milestone-1.
    return undefined;
  }

  get conversationStore(): ConversationStore {
    return this.store;
  }

  /** Return the conversation transcript the adapter has accumulated. */
  async getMessages(target: ReplyTarget): Promise<ThreadMessage[]> {
    const t = target as TeamsReplyTarget;
    return this.store.getTranscript(t.conversationKey);
  }
}

/** Construct a Microsoft Teams `PlatformAdapter`. */
export function teams(opts: TeamsAdapterOptions = {}): TeamsAdapter {
  return new TeamsAdapter(opts);
}

/** Best-effort MIME from a filename extension; defaults to PNG (the common case). */
function mimeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    default:
      return "image/png";
  }
}
