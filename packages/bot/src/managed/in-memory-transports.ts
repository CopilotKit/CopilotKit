import type { DeliverySource, EgressSink } from "./transports.js";
import type {
  ManagedIngressEnvelope,
  EgressOperation,
  EgressResult,
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
 * In-memory {@link DeliverySource} driven by the test/caller via {@link deliver}.
 * Records ack/nack so tests can assert at-least-once semantics. The production
 * source is the Realtime Gateway client.
 */
export class InMemoryDeliverySource implements DeliverySource {
  readonly acked: string[] = [];
  readonly nacked: { deliveryId: string; reason: string }[] = [];
  private onDelivery?: (env: ManagedIngressEnvelope) => Promise<void>;

  async start(
    onDelivery: (env: ManagedIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.onDelivery = onDelivery;
  }

  /**
   * Push an envelope through the bound adapter. Resolves after the full
   * dispatch (handler + ack/nack) completes, so tests can assert synchronously.
   */
  async deliver(env: ManagedIngressEnvelope): Promise<void> {
    if (!this.onDelivery) {
      throw new Error(
        "InMemoryDeliverySource: not started — call bot.start() first",
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
  async stop(): Promise<void> {}
}
