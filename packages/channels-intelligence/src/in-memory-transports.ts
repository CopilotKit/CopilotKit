import type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
  AgentMessage,
} from "./transports.js";
import type {
  ChannelIngressEnvelope,
  EgressRoute,
  EgressOperation,
  EgressResult,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";

/**
 * In-memory {@link EgressSink} that records every emitted operation and acks it
 * with its own (deterministic) operation id as the message ref. Used for
 * headless runs and tests — the production sink is the Connector Outbox.
 */
export class InMemoryEgressSink implements EgressSink {
  readonly ops: EgressOperation[] = [];
  async emit(op: EgressOperation): Promise<EgressResult> {
    this.ops.push(op);
    return { ok: true, ref: op.operationId };
  }
}

/**
 * In-memory {@link RenderEventSink} that records every pushed frame in order and
 * returns an `accepted` receipt (with a deterministic `egressOperationId` on
 * `finalize`). Used to assert render-frame ordering / idempotency keys in tests;
 * the production sink is the Realtime Gateway client.
 */
export class InMemoryRenderEventSink implements RenderEventSink {
  readonly frames: RenderFrame[] = [];
  async push(frame: RenderFrame): Promise<RenderAccepted> {
    this.frames.push(frame);
    const idempotencyKey = `${frame.turnId}:${frame.slot}:${frame.seq}`;
    return {
      idempotencyKey,
      acceptance: "accepted",
      ...(frame.event.kind === "finalize"
        ? { egressOperationId: `eop_${frame.turnId}_${frame.seq}` }
        : {}),
    };
  }
}

/**
 * In-memory {@link DeliverySource} driven by the test/caller via {@link deliver}.
 * Records ack/nack so tests can assert at-least-once semantics. The production
 * source is the Realtime Gateway client.
 */
export class InMemoryDeliverySource implements DeliverySource {
  readonly acked: string[] = [];
  readonly nacked: { deliveryId: string; reason: string }[] = [];
  /** Seed by handle so a turn's file refs hydrate into content parts. */
  readonly files = new Map<string, { bytes: Uint8Array; mimeType?: string }>();
  /**
   * Prior-turn history `getHistory` returns, regardless of `replyTarget` —
   * seed it in a test to assert `conversationStore.getOrCreate` seeds
   * `agent.messages` from it. Mirrors {@link HttpDeliverySource.getHistory}'s
   * contract (oldest→newest, truncated to the requested `limit`).
   */
  history: AgentMessage[] = [];
  /** Every `getHistory` call, in order — asserts the adapter unwraps the
   * `ChannelReplyTarget` to the raw route and threads `historyLimit` through. */
  readonly historyRequests: Array<{ replyTarget: EgressRoute; limit: number }> =
    [];
  private onDelivery?: (env: ChannelIngressEnvelope) => Promise<void>;

  async start(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.onDelivery = onDelivery;
  }

  /**
   * Push an envelope through the bound adapter. Resolves after the full
   * dispatch (handler + ack/nack) completes, so tests can assert synchronously.
   */
  async deliver(env: ChannelIngressEnvelope): Promise<void> {
    if (!this.onDelivery) {
      throw new Error(
        "InMemoryDeliverySource: not started — call channel.start() first",
      );
    }
    await this.onDelivery(env);
  }

  async ack(deliveryId: string): Promise<void> {
    this.acked.push(deliveryId);
  }
  async nack(deliveryId: string, reason: string): Promise<void> {
    this.nacked.push({ deliveryId, reason });
  }
  async fetchFile(
    handle: string,
  ): Promise<{ bytes: Uint8Array; mimeType?: string }> {
    const f = this.files.get(handle);
    if (!f) throw new Error(`InMemoryDeliverySource: no file for ${handle}`);
    return f;
  }
  async getHistory(
    replyTarget: EgressRoute,
    limit: number,
  ): Promise<AgentMessage[]> {
    this.historyRequests.push({ replyTarget, limit });
    // `limit <= 0` → no history (a raw `slice(-0)` returns the WHOLE array);
    // mirrors IntelligenceFileHistoryClient.getHistory's guard.
    return limit <= 0 ? [] : this.history.slice(-limit);
  }
  async stop(): Promise<void> {}
}
