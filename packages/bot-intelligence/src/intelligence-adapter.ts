import type { AgentSubscriber } from "@ag-ui/client";
import type { BotNode, MessageRef, PlatformUser } from "@copilotkit/bot-ui";
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
} from "@copilotkit/bot";
import type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
} from "./transports.js";
import type {
  ManagedIngressEnvelope,
  EgressOp,
  EgressOperation,
  HostedBotRenderEvent,
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

/** Reply target the adapter mints during ingress and threads back to egress. */
interface ManagedReplyTarget {
  route: unknown;
  turnId: string;
  deliveryId: string;
}

/** Recover the routing a minted {@link MessageRef} carries (for update/delete). */
function targetFromRef(ref: MessageRef): ManagedReplyTarget {
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
   * Overrides for the default-transport config (baseUrl/apiKey/botName/…).
   * Anything omitted is resolved from env. Ignored when both `source` and
   * `egress` are injected.
   */
  config?: Partial<IntelligenceTransportConfig>;
}

/**
 * @internal Not a publicly documented API.
 *
 * Bridges Intelligence-delivered managed ingress to bot core and emits generic
 * egress operations — pure plumbing over the injected {@link DeliverySource} /
 * {@link EgressSink}, with no Slack/Intelligence credentials. Production wires
 * the Realtime Gateway + Connector Outbox transports; tests/headless runs wire
 * in-memory ones. Must be the only adapter on a bot (V1).
 */
export class IntelligenceAdapter implements PlatformAdapter {
  readonly platform = "intelligence";
  /** Marks this as the managed adapter (exclusivity guard + dedup opt-out). */
  readonly __managed = true;
  /**
   * Managed delivery is at-least-once and idempotency is enforced at egress
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
  };

  readonly conversationStore: ConversationStore = {
    async getOrCreate(conversationKey, _replyTarget, makeAgent) {
      return { agent: makeAgent(conversationKey) };
    },
  };

  /** Persistence supplied by the managed transport (Intelligence-backed); picked
   * up by createBot's `resolveBackend` when no explicit `store.adapter` is set. */
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
    this.stateStore = opts.store;
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

  async start(sink: IngressSink, ctx?: { botName?: string }): Promise<void> {
    this.sink = sink;
    // Config-free default: build the HTTP transports from env (+ the bot's
    // name from createBot, passed by bot core) when none were injected.
    if (!this.source || !this.egress) {
      const cfg = resolveTransportConfig({
        ...this.opts.config,
        botName: this.opts.config?.botName ?? ctx?.botName,
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

  private async dispatch(env: ManagedIngressEnvelope): Promise<void> {
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
    }
  }

  private async dispatchTo(env: ManagedIngressEnvelope): Promise<void> {
    const sink = this.sink;
    if (!sink) throw new Error("IntelligenceAdapter: not started");
    const replyTarget: ManagedReplyTarget = {
      route: env.route,
      turnId: env.turnId,
      deliveryId: env.deliveryId,
    };
    const user = env.user ? { id: env.user.id } : undefined;

    switch (env.kind) {
      case "turn":
        await sink.onTurn({
          conversationKey: env.conversationKey,
          replyTarget,
          userText: env.text ?? "",
          user,
          eventId: env.eventId,
          turnId: env.turnId,
          deliveryId: env.deliveryId,
          platform: env.platform,
        });
        return;
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
      case "interaction":
        await sink.onInteraction({
          id: env.actionId,
          conversationKey: env.conversationKey,
          replyTarget,
          value: env.value,
          user,
          eventId: env.eventId,
          turnId: env.turnId,
          deliveryId: env.deliveryId,
          messageRef: env.messageRef,
          triggerId: env.triggerId,
        });
        return;
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
          threadId: env.threadId,
          raw: env,
        });
        return;
    }
  }

  private mintOp(target: ManagedReplyTarget, op: EgressOp): EgressOperation {
    const seq = this.seq.get(target.turnId) ?? 0;
    this.seq.set(target.turnId, seq + 1);
    return {
      operationId: `${target.turnId}:${seq}`,
      turnId: target.turnId,
      deliveryId: target.deliveryId,
      route: target.route,
      op,
    };
  }

  private async emit(
    target: ManagedReplyTarget,
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
    return this.emit(target as ManagedReplyTarget, { kind: "post", ir });
  }

  async update(ref: MessageRef, ir: BotNode[]): Promise<void> {
    await this.emit(targetFromRef(ref), { kind: "update", ref: ref.id, ir });
  }

  async stream(
    _target: ReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    // Non-streaming surface: accumulate the full reply and emit one post op.
    let acc = "";
    for await (const c of chunks) acc += c;
    return this.emit(_target as ManagedReplyTarget, {
      kind: "post",
      ir: textNode(acc),
    });
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.emit(targetFromRef(ref), { kind: "delete", ref: ref.id });
  }

  decodeInteraction(_raw: unknown): InteractionEvent | undefined {
    // TODO(OSS-377): managed interaction decoding.
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
  private renderSinkFor(t: ManagedReplyTarget): RenderEventSink {
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
    const t = target as ManagedReplyTarget;
    const sink = this.renderSinkFor(t);
    const interruptEventNames = new Set<string>(["on_interrupt"]);
    const capturedToolCalls: CapturedToolCall[] = [];
    let pendingInterrupt: CapturedInterrupt | undefined;
    let aborted = false;
    let runStarted = false;
    let seq = 0;

    // ponytail: serial promise chain — AG-UI does not guarantee it awaits
    // subscriber callbacks in order, so `seq` is assigned synchronously at
    // enqueue time (preserving event order) and frames are pushed one at a
    // time, awaiting each durable-acceptance receipt before the next. `finish`/
    // `markInterrupted` await the drained chain. A rejected push is recorded
    // and surfaced at drain (so it nacks the delivery) without wedging the
    // chain. Upgrade path: batch text_delta frames if per-token RTT matters.
    let chain: Promise<void> = Promise.resolve();
    let pushError: unknown;

    const enqueue = (event: HostedBotRenderEvent): void => {
      const frame: RenderFrame = {
        deliveryId: t.deliveryId,
        turnId: t.turnId,
        slot: "main",
        seq: seq++,
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
        enqueue({
          kind: "text_delta",
          messageId: event.messageId,
          delta: event.delta ?? "",
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
 * @internal Construct the managed bridge adapter. Production callers (the
 * runtime) inject the Realtime Gateway + Connector Outbox transports; tests and
 * standalone runs inject in-memory ones. Must be the only adapter on a bot (V1).
 */
export function intelligenceAdapter(
  opts: IntelligenceAdapterOptions = {},
): IntelligenceAdapter {
  return new IntelligenceAdapter(opts);
}
