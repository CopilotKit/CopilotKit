import type { AgentContentPart } from "@copilotkit/channels-ui";
import type {
  ChannelIngressEnvelope,
  EgressRoute,
  EgressOperation,
  EgressResult,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";

/**
 * A conversation-history message the adapter seeds onto a fresh agent's
 * `messages` before a turn runs, giving the Channel runtime visibility into prior
 * thread turns (parity with bot-slack/bot-discord/bot-whatsapp's
 * reconstructed-history conversation stores). Structurally compatible with —
 * but intentionally looser than — the AG-UI `Message` union (which types an
 * assistant's `content` as string-only): callers assign it onto `agent.messages`
 * via a cast, same as the other adapters' conversation stores.
 */
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  /** String for plain turns; multimodal parts when the turn had files. */
  content: string | AgentContentPart[];
}

/**
 * Inbound transport for Intelligence Channel delivery. Implemented by the Intelligence
 * Realtime Gateway client in production, and by {@link InMemoryDeliverySource}
 * for headless/standalone runs and tests. The bridge adapter is the only
 * consumer — it never knows which implementation is wired.
 */
export interface DeliverySource {
  /** Begin delivering. `onDelivery` is invoked once per leased envelope. */
  start(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void>;
  /** Acknowledge successful processing of a delivery (lease release). */
  ack(deliveryId: string): Promise<void>;
  /** Negatively acknowledge — the work will be redelivered (at-least-once). */
  nack(deliveryId: string, reason: string): Promise<void>;
  /**
   * Fetch an inbound file's bytes by handle (Channel multimodal content).
   * Optional: sources without a file-serve backing omit it and the adapter
   * skips content-part hydration (text-only turn).
   */
  fetchFile?(handle: string): Promise<{ bytes: Uint8Array; mimeType?: string }>;
  /**
   * Upload an outbound file's bytes to app-api ahead of a `file` render frame
   * (`thread.postFile`). Returns the storage handle the frame carries. Optional:
   * sources without an upload backing omit it and `postFile` reports failure.
   */
  uploadFile?(
    deliveryId: string,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ handle: string }>;
  /**
   * Fetch prior turns for the thread `replyTarget` addresses (oldest→newest,
   * excluding the turn currently being dispatched), so the adapter can seed a
   * fresh agent's `messages` — parity with bot-slack/bot-discord/bot-whatsapp,
   * whose conversation stores rebuild `agent.messages` from platform history
   * every turn. Optional: sources without a history-serving backing omit it and
   * the adapter falls back to today's behavior (each turn starts fresh).
   * Implementations must be best-effort — a failure must resolve to `[]`
   * rather than reject, since missing history should never fail the turn.
   */
  getHistory?(replyTarget: EgressRoute, limit: number): Promise<AgentMessage[]>;
  stop(): Promise<void>;
}

/**
 * Outbound transport for Channel replies. Implemented by the Intelligence
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
 * intent). Implemented by the Realtime Gateway client in production;
 * headless/HTTP-fallback runs translate frames back to {@link EgressSink}
 * `post` operations so a Connector Outbox isn't required to see plain-text
 * replies.
 */
export interface RenderEventSink {
  push(frame: RenderFrame): Promise<RenderAccepted>;
}
