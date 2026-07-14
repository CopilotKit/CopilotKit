import type { AgentSubscriber } from "@ag-ui/client";
import type {
  BotNode,
  MessageRef,
  PlatformUser,
} from "@copilotkit/channels-ui";
import type {
  StateStore,
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  ReplyTarget,
  NativePayload,
  RunRenderer,
  CapturedToolCall,
  CapturedInterrupt,
  ConversationStore,
  UserQuery,
  InteractionEvent,
} from "@copilotkit/channels";
import type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
  AgentMessage,
} from "./transports.js";
import type {
  ChannelIngressEnvelope,
  EgressOp,
  EgressOperation,
  ChannelRenderEvent,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";
import {
  HttpDeliverySource,
  HttpEgressSink,
  HttpRenderEventSink,
  resolveTransportConfig,
} from "./http-transports.js";
import type { IntelligenceTransportConfig } from "./http-transports.js";
import { IntelligenceStateStore } from "./intelligence-state-store.js";
import { buildContentParts } from "./content-parts.js";

/** Reply target the adapter mints during ingress and threads back to egress. */
interface ChannelReplyTarget {
  route: unknown;
  turnId: string;
  deliveryId: string;
}

/** Recover the routing a minted {@link MessageRef} carries (for update/delete). */
function targetFromRef(ref: MessageRef): ChannelReplyTarget {
  if (ref.__deliveryId === undefined || ref.__turnId === undefined) {
    // A ref without stamped routing can't address an update/delete egress op.
    // This happens when a handler updates a ref that carries no delivery routing
    // — e.g. a ref-less interaction whose `message.ref` bot core defaulted to
    // `{ id: "" }`. Fail with a clear, actionable message rather than coercing
    // `String(undefined)` → `deliveryId:"undefined"` and hitting the opaque
    // "no leased scope for delivery undefined" downstream (which would nack and
    // burn the delivery's retries before app-api dead-letters it).
    throw new Error(
      `IntelligenceAdapter: cannot address message ref ${JSON.stringify(
        ref.id,
      )} for update/delete — it carries no delivery routing (the ref must come ` +
        `from a prior post/render frame in a live delivery)`,
    );
  }
  return {
    route: ref.__route,
    turnId: String(ref.__turnId),
    deliveryId: String(ref.__deliveryId),
  };
}

const textNode = (value: string): BotNode[] => [
  { type: "text", props: { value } },
];

const INTERRUPTED_SUFFIX = "\n_(interrupted)_";

export interface IntelligenceAdapterOptions {
  /**
   * Inbound transport. Omit to use the default {@link HttpDeliverySource}
   * (built at `start()` from env/`config`); inject in-memory for tests.
   */
  source?: DeliverySource;
  /**
   * Outbound transport. Omit to use the default {@link HttpEgressSink}
   * (built at `start()` from env/`config`); inject in-memory for tests.
   */
  egress?: EgressSink;
  /**
   * Streaming render transport (OSS-402). When set, the run renderer streams
   * semantic render frames to it and awaits durable acceptance receipts (the
   * realtime-gateway path). When omitted, the renderer falls back to
   * translating frames into `post` operations on {@link egress} so plain-text
   * replies still flow without a Connector Outbox.
   */
  renderSink?: RenderEventSink;
  /** Optional Intelligence-backed persistence the adapter exposes as `stateStore`. */
  store?: StateStore;
  /**
   * Overrides for the default-transport config (baseUrl/apiKey/channelName/…).
   * Anything omitted is resolved from env. Ignored when both `source` and
   * `egress` are injected.
   */
  config?: Partial<IntelligenceTransportConfig>;
  /**
   * Max prior thread turns to seed onto a fresh agent's `messages` before a
   * turn runs — parity with bot-slack/bot-discord/bot-whatsapp's
   * reconstructed-history conversation stores. Ignored when the transport has
   * no {@link DeliverySource.getHistory} (each turn then starts fresh, today's
   * behavior). Default 20.
   */
  historyLimit?: number;
}

/**
 * @internal Not a publicly documented API.
 *
 * Bridges Intelligence-delivered Channel ingress to the framework Bot core and emits generic
 * egress operations — pure plumbing over the injected {@link DeliverySource} /
 * {@link EgressSink}, with no Slack/Intelligence credentials. Production wires
 * the Realtime Gateway + Connector Outbox transports; tests/headless runs wire
 * in-memory ones. Must be the only adapter on a framework Bot (V1).
 */
export class IntelligenceAdapter implements PlatformAdapter {
  readonly platform = "intelligence";
  /** Marks this as the Intelligence Channel adapter (exclusivity guard + dedup opt-out). */
  readonly __intelligenceChannel = true;
  /**
   * Channel delivery is at-least-once and idempotency is enforced at egress
   * (deterministic operation ids → Connector Outbox dedupe), so bot core must
   * NOT drop redeliveries at ingress — that would lose a legitimate retry.
   */
  readonly skipIngressDedup = true;
  readonly ackDeadlineMs = 0;
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    // Conservative for V1: the async egress hop posts whole messages rather
    // than editing a native streaming message in place.
    supportsStreaming: false,
    supportsEphemeral: false,
    // The claim loop processes one lease-bounded delivery at a time, so a
    // blocking `awaitChoice` would deadlock (the click lands as a separate
    // delivery). HITL uses the ack-first post-then-resume flow instead.
    supportsBlockingChoice: false,
  };

  /**
   * Seeds a fresh agent's `messages` from the Channel transport's conversation
   * history (parity with bot-slack/bot-discord/bot-whatsapp, whose stores
   * rebuild `agent.messages` from platform history every turn) — an arrow
   * function property so `this` resolves to the adapter instance (not this
   * object literal) when bot core calls `adapter.conversationStore.getOrCreate(…)`.
   * `replyTarget` here is the {@link ChannelReplyTarget} framework core threads
   * through from `dispatchTo`; `.route` is the opaque {@link EgressRoute} the
   * transport actually needs. Best-effort: `getHistory` degrading to `[]` (no
   * transport support, or a fetch failure) just means the turn starts fresh.
   */
  readonly conversationStore: ConversationStore = {
    getOrCreate: async (conversationKey, replyTarget, makeAgent) => {
      const agent = makeAgent(conversationKey);
      const route = (replyTarget as ChannelReplyTarget).route;
      let history: AgentMessage[] = [];
      try {
        history =
          ((await this.source?.getHistory?.(
            route,
            this.opts.historyLimit ?? 20,
          )) as AgentMessage[] | undefined) ?? [];
      } catch (err) {
        // The DeliverySource contract says getHistory is best-effort (resolve
        // to [] on failure), but guard here too so a source that violates it
        // (or a future edit dropping HttpDeliverySource's internal catch) can't
        // nack an otherwise-fine turn just because history couldn't be fetched.
        this.opts.config?.log?.(
          "intelligence getHistory failed; starting fresh",
          err,
        );
      }
      // AG-UI types an assistant `Message.content` as string-only, but our
      // reconstructed history's `content` is `string | AgentContentPart[]`
      // (a historical user turn may carry files) — cast past the stricter
      // union rather than narrow the type, same as bot-slack/bot-discord/
      // bot-whatsapp's conversation stores.
      (agent as unknown as { messages: AgentMessage[] }).messages = history;
      return { agent };
    },
  };

  /** Persistence supplied by the Channel transport (Intelligence-backed); picked
   * up by createChannel's `resolveBackend` when no explicit `store.adapter` is set. */
  readonly stateStore?: StateStore;

  private sink?: IngressSink;
  /** Inbound transport — injected via opts, or the default HTTP source built at `start()`. */
  private source?: DeliverySource;
  /** Outbound transport — injected via opts, or the default HTTP sink built at `start()`. */
  private egress?: EgressSink;
  /** Streaming render transport — injected via opts (realtime path). When unset,
   * the run renderer translates frames to `post` ops on {@link egress}. */
  private renderSink?: RenderEventSink;
  /** Per-turn egress sequence; reset at the start of each turn's processing so
   * a redelivered turn reproduces the same operation id sequence. */
  private readonly seq = new Map<string, number>();

  constructor(private readonly opts: IntelligenceAdapterOptions = {}) {
    this.source = opts.source;
    this.egress = opts.egress;
    this.renderSink = opts.renderSink;
    // Default to the Intelligence-backed durable KV store so Channel Bots
    // persist action-registry snapshots + thread state across restarts (HITL
    // cards survive). Skipped when a store is passed explicitly or when
    // in-memory transports are injected (tests) — a durable store hitting HTTP
    // would be wrong there. Falls back to createChannel's MemoryStore if baseUrl /
    // apiKey can't be resolved.
    this.stateStore = opts.store ?? this.buildDefaultStore();
  }

  /** Build the default Intelligence-backed durable store, or undefined. */
  private buildDefaultStore(): StateStore | undefined {
    if (this.opts.source || this.opts.egress) return undefined;
    const env =
      typeof process !== "undefined"
        ? process.env
        : ({} as Record<string, string | undefined>);
    const baseUrl = (
      this.opts.config?.baseUrl ?? env["COPILOTKIT_INTELLIGENCE_URL"]
    )?.replace(/\/+$/, "");
    const apiKey = this.opts.config?.apiKey ?? env["COPILOTKIT_API_KEY"];
    if (!baseUrl || !apiKey) return undefined;
    return new IntelligenceStateStore({
      baseUrl,
      apiKey,
      fetch: this.opts.config?.fetch,
    });
  }

  private requireSource(): DeliverySource {
    if (!this.source)
      throw new Error("IntelligenceAdapter: transport not started");
    return this.source;
  }

  private requireEgress(): EgressSink {
    if (!this.egress)
      throw new Error("IntelligenceAdapter: transport not started");
    return this.egress;
  }

  private requireRenderSink(): RenderEventSink {
    if (!this.renderSink)
      throw new Error("IntelligenceAdapter: render sink not started");
    return this.renderSink;
  }

  async start(sink: IngressSink, ctx?: { botName?: string }): Promise<void> {
    this.sink = sink;
    // Config-free default: build the HTTP transports from env (+ the bot's
    // name from createChannel, passed by bot core) when none were injected.
    if (!this.source || !this.egress) {
      const cfg = resolveTransportConfig({
        ...this.opts.config,
        channelName: this.opts.config?.channelName ?? ctx?.botName,
      });
      const source = (this.source ??= new HttpDeliverySource(cfg));
      this.egress ??= new HttpEgressSink(cfg);
      // Default the realtime render path to the HTTP render-accept route,
      // sharing the HttpDeliverySource's per-delivery scope. Only when we built
      // (or were given) an HttpDeliverySource — injected in-memory sources fall
      // back to the egress-backed render sink in createRunRenderer.
      if (!this.renderSink && source instanceof HttpDeliverySource) {
        this.renderSink = new HttpRenderEventSink(cfg, source);
      }
    }
    await this.requireSource().start((env) => this.dispatch(env));
  }

  async stop(): Promise<void> {
    await this.source?.stop();
  }

  private async dispatch(env: ChannelIngressEnvelope): Promise<void> {
    // Reset the per-turn sequence so egress ids are deterministic across
    // redelivery (same turn id -> same op id sequence). Assumes the
    // DeliverySource delivers (and awaits) one envelope per turnId at a time —
    // true for at-least-once, lease-based delivery; overlapping redeliveries of
    // the same turnId would perturb the counter.
    this.seq.set(env.turnId, 0);
    try {
      await this.dispatchTo(env);
      await this.requireSource().ack(env.deliveryId);
    } catch (err) {
      await this.requireSource().nack(
        env.deliveryId,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      // Drop the per-turn counter once the turn is fully processed (renderer
      // chain drained inside dispatchTo) so the Map can't grow unbounded over a
      // long-running Channel Bot. A redelivery re-seeds it at the top.
      this.seq.delete(env.turnId);
    }
  }

  private async dispatchTo(env: ChannelIngressEnvelope): Promise<void> {
    const sink = this.sink;
    if (!sink) throw new Error("IntelligenceAdapter: not started");
    const replyTarget: ChannelReplyTarget = {
      route: env.route,
      turnId: env.turnId,
      deliveryId: env.deliveryId,
    };
    const user = env.user ? { id: env.user.id } : undefined;

    switch (env.kind) {
      case "turn": {
        // Shared with `HttpDeliverySource.getHistory` (via ./content-parts.js)
        // so a live inbound file and a historical one hydrate identically.
        const contentParts = await buildContentParts(
          env.files,
          this.source?.fetchFile?.bind(this.source),
          this.opts.config?.log,
        );
        await sink.onTurn({
          conversationKey: env.conversationKey,
          replyTarget,
          userText: env.text ?? "",
          ...(contentParts.length ? { contentParts } : {}),
          user,
          eventId: env.eventId,
          turnId: env.turnId,
          deliveryId: env.deliveryId,
          platform: env.platform,
        });
        return;
      }
      case "command":
        await sink.onCommand({
          command: env.command,
          text: env.text ?? "",
          rawOptions: env.rawOptions,
          conversationKey: env.conversationKey,
          replyTarget,
          user,
          eventId: env.eventId,
          turnId: env.turnId,
          deliveryId: env.deliveryId,
          platform: env.platform,
          triggerId: env.triggerId,
        });
        return;
      case "interaction": {
        // The clicked card was posted in a PRIOR delivery, so its messageRef
        // (minted by app-api as { id: <slackTs>, channel, ts }) carries no SDK
        // render routing. Stamp THIS interaction delivery's route/turnId/
        // deliveryId onto it so `thread.update(ref)` emits a valid `update`
        // frame (routed under this live delivery) whose `ref` is the original
        // card's ts — the Connector Outbox then `chat.update`s that card in
        // place. Without this, `targetFromRef` yields `deliveryId:"undefined"`,
        // the frame is rejected, and the interaction delivery dead-letters.
        //
        // CONTRACT (app-api side): the interaction delivery MUST carry a turnId
        // distinct from the turn that originally posted the card. Egress op ids
        // are `${turnId}:${seq}` (see mintOp/postRenderFrame) and seq resets to
        // 0 per delivery, so a reused turnId makes the update's op id collide
        // with the original post's — the Connector Outbox dedupes on op id and
        // SILENTLY DROPS the update, so the card never flips. This layer can't
        // detect the collision (the ref only carries the Slack ts, not the
        // original turnId); it relies on app-api minting a fresh turnId here.
        const messageRef = env.messageRef
          ? {
              ...env.messageRef,
              __route: replyTarget.route,
              __turnId: replyTarget.turnId,
              __deliveryId: replyTarget.deliveryId,
            }
          : undefined;
        await sink.onInteraction({
          id: env.actionId,
          conversationKey: env.conversationKey,
          replyTarget,
          value: env.value,
          user,
          eventId: env.eventId,
          turnId: env.turnId,
          deliveryId: env.deliveryId,
          messageRef,
          triggerId: env.triggerId,
        });
        return;
      }
      case "thread_started":
        await sink.onThreadStarted({
          conversationKey: env.conversationKey,
          replyTarget,
          user,
          platform: env.platform,
        });
        return;
      case "reaction":
        await sink.onReaction({
          rawEmoji: env.rawEmoji,
          added: env.added,
          user,
          conversationKey: env.conversationKey,
          replyTarget,
          messageId: env.messageId,
          // The reaction arrives keyed by the provider ts; app-api reverse-maps
          // it to the SDK post-time ref so a `<Message onReaction>` handler
          // (persisted under that ref) resolves. `messageId` stays the ts.
          ...(env.postedRef ? { postedMessageId: env.postedRef } : {}),
          threadId: env.threadId,
          raw: env,
        });
        return;
      default: {
        // Exhaustiveness guard: a delivery whose kind we don't dispatch must
        // fail loud, not fall through — dispatch() acks on resolve, so a silent
        // no-op here would ack an unhandled delivery as if it were processed.
        const unhandled: never = env;
        throw new Error(
          `IntelligenceAdapter: unhandled delivery kind ${JSON.stringify(unhandled)}`,
        );
      }
    }
  }

  /** Allocate the next monotonic frame/op seq for a turn. Shared by the run
   * renderer and discrete post/update so all of a turn's render frames land on
   * one ordered `(turnId, "main")` lane. Reset per delivery in {@link dispatch}. */
  private nextFrameSeq(turnId: string): number {
    const seq = this.seq.get(turnId) ?? 0;
    this.seq.set(turnId, seq + 1);
    return seq;
  }

  private mintOp(target: ChannelReplyTarget, op: EgressOp): EgressOperation {
    const seq = this.nextFrameSeq(target.turnId);
    return {
      operationId: `${target.turnId}:${seq}`,
      turnId: target.turnId,
      deliveryId: target.deliveryId,
      route: target.route,
      op,
    };
  }

  /**
   * Push a discrete render frame (post/update) through the realtime render sink
   * so the Connector Outbox renders it as Block Kit — preserving rich JSX/IR
   * instead of flattening to text. Returns a {@link MessageRef} keyed to the
   * frame so a later update/delete can re-address it.
   */
  private async postRenderFrame(
    target: ChannelReplyTarget,
    event: ChannelRenderEvent,
  ): Promise<MessageRef> {
    const seq = this.nextFrameSeq(target.turnId);
    const receipt = await this.requireRenderSink().push({
      deliveryId: target.deliveryId,
      turnId: target.turnId,
      slot: "main",
      seq,
      event,
    });
    return {
      id: receipt.egressOperationId ?? `${target.turnId}:main:${seq}`,
      __route: target.route,
      __turnId: target.turnId,
      __deliveryId: target.deliveryId,
    };
  }

  private async emit(
    target: ChannelReplyTarget,
    op: EgressOp,
  ): Promise<MessageRef> {
    const operation = this.mintOp(target, op);
    const res = await this.requireEgress().emit(operation);
    // The minted ref carries routing so a later update/delete can re-address
    // the same operation; the Outbox maps operationId -> real platform message.
    return {
      id: res.ok ? res.ref : operation.operationId,
      __route: target.route,
      __turnId: target.turnId,
      __deliveryId: target.deliveryId,
    };
  }

  render(ir: BotNode[]): NativePayload {
    // Passthrough: platform rendering (IR -> Slack/Discord/...) happens in the
    // Connector Outbox via the per-platform codec (OSS-363).
    return ir;
  }

  async post(target: ReplyTarget, ir: BotNode[]): Promise<MessageRef> {
    // Realtime path: stream a `post` render frame carrying the IR so the
    // Connector Outbox renders full Block Kit (rich JSX preserved). Fallback
    // (no render sink wired — e.g. in-memory tests): the egress op path.
    if (this.renderSink) {
      return this.postRenderFrame(target as ChannelReplyTarget, {
        kind: "post",
        content: ir,
      });
    }
    return this.emit(target as ChannelReplyTarget, { kind: "post", ir });
  }

  async update(ref: MessageRef, ir: BotNode[]): Promise<void> {
    if (this.renderSink) {
      await this.postRenderFrame(targetFromRef(ref), {
        kind: "update",
        ref: ref.id,
        content: ir,
      });
      return;
    }
    await this.emit(targetFromRef(ref), { kind: "update", ref: ref.id, ir });
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
    const channelTarget = target as ChannelReplyTarget;
    const uploadFile = this.source?.uploadFile?.bind(this.source);
    if (!uploadFile || !this.renderSink) {
      return {
        ok: false,
        error: "Channel adapter: outbound file upload is not available",
      };
    }
    try {
      // Stream bytes to app-api first (durable in S3), then emit a `file` frame
      // referencing the handle; the Connector Outbox does the Slack uploadV2.
      const { handle } = await uploadFile(channelTarget.deliveryId, args);
      await this.postRenderFrame(channelTarget, {
        kind: "file",
        handle,
        filename: args.filename,
        ...(args.title ? { title: args.title } : {}),
        ...(args.altText ? { altText: args.altText } : {}),
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async stream(
    _target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    // Non-streaming surface: accumulate the full reply and emit one post.
    let acc = "";
    for await (const c of chunks) acc += c;
    const target = _target as ChannelReplyTarget;
    if (this.renderSink) {
      return this.postRenderFrame(target, {
        kind: "post",
        content: textNode(acc),
      });
    }
    return this.emit(target, { kind: "post", ir: textNode(acc) });
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.emit(targetFromRef(ref), { kind: "delete", ref: ref.id });
  }

  decodeInteraction(_raw: unknown): InteractionEvent | undefined {
    // TODO(OSS-377): Channel interaction decoding.
    return undefined;
  }

  async lookupUser(_q: UserQuery): Promise<PlatformUser | undefined> {
    return undefined;
  }

  /**
   * The render transport the run renderer streams frames to. Uses the injected
   * realtime {@link RenderEventSink} when present; otherwise translates frames
   * back to `post` operations on the {@link EgressSink} so plain-text replies
   * still flow on the HTTP-fallback path (no Connector Outbox required). The
   * fallback accumulates text per message and posts on `text_end`, and flushes
   * any un-ended text on `finalize` (the interrupt path) with the interrupted
   * marker.
   */
  private renderSinkFor(t: ChannelReplyTarget): RenderEventSink {
    if (this.renderSink) return this.renderSink;
    const emit = (op: EgressOp) => this.emit(t, op);
    const acc = new Map<string, string>();
    const order: string[] = [];
    let interrupted = false;
    return {
      push: async (frame: RenderFrame): Promise<RenderAccepted> => {
        const e = frame.event;
        if (e.kind === "text_delta") {
          if (!acc.has(e.messageId)) order.push(e.messageId);
          acc.set(e.messageId, (acc.get(e.messageId) ?? "") + e.delta);
        } else if (e.kind === "text_end") {
          const txt = acc.get(e.messageId) ?? "";
          acc.delete(e.messageId);
          const i = order.indexOf(e.messageId);
          if (i >= 0) order.splice(i, 1);
          if (txt.length > 0) await emit({ kind: "post", ir: textNode(txt) });
        } else if (e.kind === "interrupt") {
          interrupted = true;
        } else if (e.kind === "post") {
          await emit({ kind: "post", ir: e.content });
        } else if (e.kind === "update") {
          await emit({ kind: "update", ref: e.ref, ir: e.content });
        } else if (e.kind === "finalize") {
          // Flush any message that never received a text_end (interrupt path).
          for (const id of order) {
            const txt = acc.get(id) ?? "";
            if (txt.length > 0) {
              await emit({
                kind: "post",
                ir: textNode(interrupted ? txt + INTERRUPTED_SUFFIX : txt),
              });
            }
          }
          acc.clear();
          order.length = 0;
        }
        // run_started / tool_start / tool_end / run_error: no provider-visible
        // effect in the plain-text fallback (the Outbox renders those live).
        return {
          idempotencyKey: `${frame.turnId}:${frame.slot}:${frame.seq}`,
          acceptance: "accepted",
        };
      },
    };
  }

  createRunRenderer(target: ReplyTarget): RunRenderer {
    const t = target as ChannelReplyTarget;
    const sink = this.renderSinkFor(t);
    const interruptEventNames = new Set<string>(["on_interrupt"]);
    const capturedToolCalls: CapturedToolCall[] = [];
    let pendingInterrupt: CapturedInterrupt | undefined;
    let aborted = false;
    let runStarted = false;

    // ponytail: serial promise chain — AG-UI does not guarantee it awaits
    // subscriber callbacks in order, so `seq` is assigned synchronously at
    // enqueue time (preserving event order) and frames are pushed one at a
    // time, awaiting each durable-acceptance receipt before the next. `finish`/
    // `markInterrupted` await the drained chain. A rejected push is recorded
    // and surfaced at drain (so it nacks the delivery) without wedging the
    // chain. Upgrade path: batch text_delta frames if per-token RTT matters.
    let chain: Promise<void> = Promise.resolve();
    let pushError: unknown;

    const enqueue = (event: ChannelRenderEvent): void => {
      const frame: RenderFrame = {
        deliveryId: t.deliveryId,
        turnId: t.turnId,
        slot: "main",
        seq: this.nextFrameSeq(t.turnId),
        event,
      };
      chain = chain.then(async () => {
        if (pushError !== undefined) return;
        try {
          await sink.push(frame);
        } catch (err) {
          pushError = err;
        }
      });
    };

    const drain = async (): Promise<void> => {
      await chain;
      if (pushError !== undefined) {
        const err = pushError;
        throw err instanceof Error ? err : new Error(String(err));
      }
    };

    const ensureRunStarted = (): void => {
      if (runStarted) return;
      runStarted = true;
      enqueue({ kind: "run_started" });
    };

    const captureToolCall = (
      toolCallId: string,
      toolCallName: string,
      toolCallArgs: Record<string, unknown>,
    ) => {
      const existing = capturedToolCalls.find(
        (c) => c.toolCallId === toolCallId,
      );
      if (existing) {
        existing.toolCallName = toolCallName;
        existing.toolCallArgs = toolCallArgs;
      } else {
        capturedToolCalls.push({ toolCallId, toolCallName, toolCallArgs });
      }
    };

    const subscriber: AgentSubscriber = {
      onTextMessageContentEvent({ event }) {
        if (aborted) return;
        ensureRunStarted();
        // Skip empty deltas (e.g. the leading role-announcement chunk): they
        // carry no content and violate the render contract's min-1 text
        // constraint, which would reject the frame and abort the whole run.
        const delta = event.delta ?? "";
        if (delta.length === 0) return;
        enqueue({
          kind: "text_delta",
          messageId: event.messageId,
          delta,
        });
      },
      onTextMessageEndEvent({ event }) {
        if (aborted) return;
        enqueue({ kind: "text_end", messageId: event.messageId });
      },
      onToolCallStartEvent({ event }) {
        if (aborted) return;
        ensureRunStarted();
        enqueue({
          kind: "tool_start",
          toolCallId: event.toolCallId,
          toolName: event.toolCallName,
        });
      },
      onToolCallArgsEvent({ event, toolCallName, partialToolCallArgs }) {
        if (aborted) return;
        captureToolCall(
          event.toolCallId,
          toolCallName,
          (partialToolCallArgs ?? {}) as Record<string, unknown>,
        );
      },
      onToolCallEndEvent({ event, toolCallName, toolCallArgs }) {
        if (aborted) return;
        captureToolCall(
          event.toolCallId,
          toolCallName,
          (toolCallArgs ?? {}) as Record<string, unknown>,
        );
        enqueue({
          kind: "tool_end",
          toolCallId: event.toolCallId,
          toolName: toolCallName,
        });
      },
      onRunErrorEvent({ event }) {
        if (aborted) return;
        enqueue({
          kind: "run_error",
          message: event.message ?? "unknown error",
        });
      },
      onCustomEvent({ event }) {
        if (aborted) return;
        const e = event as { name?: string; value?: unknown };
        if (!e.name || !interruptEventNames.has(e.name)) return;
        let value = e.value;
        if (typeof value === "string") {
          try {
            value = JSON.parse(value);
          } catch {
            // leave as string; the handler's schema reports a clearer error
          }
        }
        pendingInterrupt = { eventName: e.name, value };
      },
    };

    return {
      subscriber,
      getCapturedToolCalls: () => capturedToolCalls,
      getPendingInterrupt: () => pendingInterrupt,
      clearPendingInterrupt: () => {
        pendingInterrupt = undefined;
      },
      async finish() {
        if (aborted) return;
        enqueue({ kind: "finalize" });
        await drain();
      },
      async markInterrupted() {
        if (aborted) return;
        aborted = true;
        enqueue({ kind: "interrupt" });
        enqueue({ kind: "finalize" });
        await drain();
      },
    };
  }
}

/**
 * @internal Construct the Channel bridge adapter. Production callers (the
 * runtime) inject the Realtime Gateway + Connector Outbox transports; tests and
 * standalone runs inject in-memory ones. Must be the only adapter on a Channel (V1).
 */
export function intelligenceAdapter(
  opts: IntelligenceAdapterOptions = {},
): IntelligenceAdapter {
  return new IntelligenceAdapter(opts);
}
