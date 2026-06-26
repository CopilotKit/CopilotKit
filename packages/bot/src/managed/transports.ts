import type {
  ManagedIngressEnvelope,
  EgressOperation,
  EgressResult,
} from "./contracts.js";

/**
 * Inbound transport for managed delivery. Implemented by the Intelligence
 * Realtime Gateway client in production, and by {@link InMemoryDeliverySource}
 * for headless/standalone runs and tests. The bridge adapter is the only
 * consumer — it never knows which implementation is wired.
 */
export interface DeliverySource {
  /** Begin delivering. `onDelivery` is invoked once per leased envelope. */
  start(
    onDelivery: (env: ManagedIngressEnvelope) => Promise<void>,
  ): Promise<void>;
  /** Acknowledge successful processing of a delivery (lease release). */
  ack(deliveryId: string): Promise<void>;
  /** Negatively acknowledge — the work will be redelivered (at-least-once). */
  nack(deliveryId: string, reason: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Outbound transport for managed replies. Implemented by the Intelligence
 * Connector Outbox client in production, and by {@link InMemoryEgressSink} for
 * tests. Receives generic egress operations with deterministic ids; the real
 * platform render + credentialed send happen on the Intelligence side.
 */
export interface EgressSink {
  emit(op: EgressOperation): Promise<EgressResult>;
}
