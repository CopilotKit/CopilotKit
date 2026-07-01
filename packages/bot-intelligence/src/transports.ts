import type {
  ManagedIngressEnvelope,
  EgressOperation,
  EgressResult,
  RenderFrame,
  RenderAccepted,
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

/**
 * Streaming egress transport for the realtime path (OSS-402). The run renderer
 * pushes semantic {@link RenderFrame}s as the agent runs and awaits a durable
 * {@link RenderAccepted} receipt for each before proceeding — the SDK never
 * assumes acceptance and never commits the delivery ack (app-api owns that;
 * the {@link DeliverySource} completion signal is the SDK's only terminal
 * intent). Implemented by the Realtime Gateway (Phoenix) client in production;
 * headless/HTTP-fallback runs translate frames back to {@link EgressSink}
 * `post` operations so a Connector Outbox isn't required to see plain-text
 * replies.
 */
export interface RenderEventSink {
  push(frame: RenderFrame): Promise<RenderAccepted>;
}
