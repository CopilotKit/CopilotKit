// Realtime-gateway (Phoenix) transport for the managed-bot SDK (OSS-402).
//
// This is the production render/delivery path: the SDK joins the gateway's
// per-project bot-IO channel, receives leased deliveries, streams semantic
// `hosted_bot.render_event.v1` frames, waits for durable
// `hosted_bot.render_accepted.v1` receipts, and — only after frames are
// accepted — sends a `hosted_bot.delivery.complete_requested.v1` COMPLETION
// INTENT (never a committed `hosted_bot.delivery.ack.v1`; app-api owns ack).
// On failure it sends `hosted_bot.delivery.fail.v1`. The SDK never receives
// Slack/provider credentials — rendering to the provider happens on the
// gateway-side Connector Outbox.
//
// The Phoenix `Socket`/`Channel` boilerplate is intentionally NOT imported
// here: the protocol (the risky part) is expressed against a minimal injected
// {@link HostedBotChannel}, so it is fully unit-testable with a fake channel.
// A deployment adapts its live Phoenix channel to this interface in a few
// lines (`push` wraps `channel.push(...).receive("ok"/"error")`; `on` wraps
// `channel.on(...)`).
//
// Scope (out of this checkpoint): discrete `EgressSink` posts from
// command/interaction handlers are not yet streamed as `post`/`update` render
// frames here — that needs a per-`(turn, slot)` seq shared with the run
// renderer and is a follow-up. This transport covers the agent-run render
// stream + delivery lifecycle.

import type { DeliverySource, RenderEventSink } from "./transports.js";
import type {
  ManagedIngressEnvelope,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";

/** The org/project/bot scope every realtime envelope carries. */
export interface HostedBotRealtimeScope {
  organizationId: string;
  projectId: number;
  botId: string;
  botName: string;
}

/**
 * Minimal Phoenix channel surface this transport needs. A deployment adapts a
 * live `phoenix` `Channel` to this: `push` resolves with the server's "ok"
 * reply payload (and rejects on "error"/"timeout"); `on` subscribes to a
 * server-pushed event.
 */
export interface HostedBotChannel {
  push(event: string, payload: unknown): Promise<unknown>;
  on(event: string, handler: (payload: unknown) => void): void;
}

export interface PhoenixTransportConfig {
  scope: HostedBotRealtimeScope;
  /** Unique per runtime instance (rti_…), echoed on every SDK->gateway event. */
  runtimeInstanceId: string;
  /** The joined bot-IO channel (topic `hosted_bots:project:{projectId}`). */
  channel: HostedBotChannel;
  /** ISO timestamp source; injectable for deterministic tests. */
  now?: () => string;
  /**
   * Optional diagnostic sink. The transport is otherwise silent, so dropped
   * deliveries (missing leaseToken, no state on nack) would be invisible —
   * wire this to surface them. Absent → drops stay silent (fail-closed).
   */
  log?: (message: string, meta?: unknown) => void;
}

const RENDER_EVENT = "hosted_bot.render_event.v1";
const RENDER_ACCEPTED = "hosted_bot.render_accepted.v1";
const DELIVERY_AVAILABLE = "hosted_bot.delivery.available.v1";
const COMPLETE_REQUESTED = "hosted_bot.delivery.complete_requested.v1";
const DELIVERY_FAIL = "hosted_bot.delivery.fail.v1";

/** Per-delivery state the transport needs to build completion/fail intents. */
interface DeliveryState {
  turnId: string;
  /** app-api's per-delivery lease token, fences the complete/fail intent. */
  leaseToken: string;
  /** Authoritative org/project/bot scope from the delivery (not the transport default). */
  scope: HostedBotRealtimeScope;
  /** Highest accepted `seq` per render slot (the completion high-water mark). */
  accepted: Map<string, number>;
}

/**
 * Realtime-gateway transport implementing both the inbound {@link DeliverySource}
 * and the streaming {@link RenderEventSink}. `ack` maps to the completion
 * INTENT (`complete_requested`) and `nack` to `fail` — the SDK is never the
 * committed-ack authority.
 */
export class PhoenixRealtimeTransport
  implements DeliverySource, RenderEventSink
{
  private readonly scope: HostedBotRealtimeScope;
  private readonly runtimeInstanceId: string;
  private readonly channel: HostedBotChannel;
  private readonly now: () => string;
  private readonly log?: (message: string, meta?: unknown) => void;
  private readonly deliveries = new Map<string, DeliveryState>();
  private onDelivery?: (env: ManagedIngressEnvelope) => Promise<void>;

  constructor(config: PhoenixTransportConfig) {
    this.scope = config.scope;
    this.runtimeInstanceId = config.runtimeInstanceId;
    this.channel = config.channel;
    this.now = config.now ?? (() => new Date().toISOString());
    this.log = config.log;
  }

  async start(
    onDelivery: (env: ManagedIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.onDelivery = onDelivery;
    this.channel.on(DELIVERY_AVAILABLE, (payload) => {
      void this.handleDeliveryAvailable(payload);
    });
  }

  private async handleDeliveryAvailable(payload: unknown): Promise<void> {
    const claimed = this.toIngressEnvelope(payload);
    if (!claimed) return;
    const { env, scope, leaseToken } = claimed;
    this.deliveries.set(env.deliveryId, {
      turnId: env.turnId,
      leaseToken,
      scope,
      accepted: new Map(),
    });
    await this.onDelivery?.(env);
  }

  /**
   * Map a `delivery.available.v1`'s claimed delivery to the adapter's ingress
   * envelope plus the authoritative `scope` and `leaseToken` the transport
   * stashes for later complete/fail intents. Returns `undefined` (delivery
   * dropped, logged via {@link PhoenixTransportConfig.log}) when the turn
   * identity is missing/unmodeled or the delivery carries no `leaseToken` (a
   * fenced intent can't be built without it). Only the text-turn shape is
   * handled in V1; other input kinds are ignored until modeled.
   */
  private toIngressEnvelope(payload: unknown):
    | {
        env: ManagedIngressEnvelope;
        scope: HostedBotRealtimeScope;
        leaseToken: string;
      }
    | undefined {
    const p = payload as
      | { payload?: { delivery?: Record<string, unknown> } }
      | { delivery?: Record<string, unknown> }
      | undefined;
    const delivery =
      (p as { payload?: { delivery?: Record<string, unknown> } })?.payload
        ?.delivery ?? (p as { delivery?: Record<string, unknown> })?.delivery;
    if (!delivery) return undefined;
    const turn = delivery.turn as
      | {
          id?: string;
          eventId?: string;
          replyTarget?: unknown;
          input?: { kind?: string; text?: string };
        }
      | undefined;
    if (!turn?.id || !turn.eventId) {
      // Malformed / unmodeled delivery shape — no turn identity to route on.
      this.log?.("phoenix delivery dropped: missing turn id/eventId", {
        deliveryId: delivery.id,
      });
      return undefined;
    }
    const leaseToken = String(delivery.leaseToken ?? "");
    if (!leaseToken) {
      // No lease token → we can't build a fenced complete/fail intent, so drop
      // it (app-api re-leases after the lease lapses). This is the gateway/SDK
      // version-skew failure mode (gateway not yet emitting leaseToken); log it
      // loudly so it isn't an invisible, indefinitely re-looping outage.
      this.log?.(
        "phoenix delivery dropped: no leaseToken on delivery.available (gateway/SDK version skew?) — will be re-leased",
        { deliveryId: delivery.id },
      );
      return undefined;
    }
    const bot = delivery.bot as { id?: string; name?: string } | undefined;
    const scope = {
      organizationId: String(
        delivery.organizationId ?? this.scope.organizationId,
      ),
      projectId:
        typeof delivery.projectId === "number"
          ? delivery.projectId
          : this.scope.projectId,
      botId: String(bot?.id ?? this.scope.botId),
      botName: String(bot?.name ?? this.scope.botName),
    };
    return {
      scope,
      leaseToken,
      env: {
        kind: "turn",
        deliveryId: String(delivery.id),
        eventId: String(turn.eventId),
        turnId: String(turn.id),
        botName: scope.botName,
        platform: String(delivery.adapter ?? "slack"),
        conversationKey: String(turn.id),
        route: turn.replyTarget,
        text: turn.input?.text ?? "",
      },
    };
  }

  async push(frame: RenderFrame): Promise<RenderAccepted> {
    const state = this.deliveries.get(frame.deliveryId);
    const idempotencyKey = `${frame.turnId}:${frame.slot}:${frame.seq}`;
    const envelope = {
      type: RENDER_EVENT,
      occurredAt: this.now(),
      payload: {
        ...(state?.scope ?? this.scope),
        deliveryId: frame.deliveryId,
        turnId: frame.turnId,
        runtimeInstanceId: this.runtimeInstanceId,
        slot: frame.slot,
        seq: frame.seq,
        idempotencyKey,
        event: frame.event,
        sentAt: this.now(),
      },
    };
    const reply = await this.channel.push(RENDER_EVENT, envelope);
    const receipt = this.parseAccepted(reply, idempotencyKey);
    // Record the completion high-water mark for this delivery/slot.
    if (state) {
      const prev = state.accepted.get(frame.slot);
      if (prev === undefined || frame.seq > prev) {
        state.accepted.set(frame.slot, frame.seq);
      }
    }
    return receipt;
  }

  private parseAccepted(
    reply: unknown,
    idempotencyKey: string,
  ): RenderAccepted {
    const r = reply as
      | {
          type?: string;
          payload?: {
            acceptance?: RenderAccepted["acceptance"];
            egressOperationId?: string;
            idempotencyKey?: string;
          };
        }
      | undefined;
    const payload = r?.payload;
    if (r?.type !== RENDER_ACCEPTED || !payload?.acceptance) {
      throw new Error(
        `PhoenixRealtimeTransport: expected ${RENDER_ACCEPTED} for ${idempotencyKey}, got ${r?.type ?? "no reply"}`,
      );
    }
    return {
      idempotencyKey: payload.idempotencyKey ?? idempotencyKey,
      acceptance: payload.acceptance,
      ...(payload.egressOperationId
        ? { egressOperationId: payload.egressOperationId }
        : {}),
    };
  }

  /**
   * Send the SDK completion INTENT (`complete_requested`) — never a committed
   * delivery ack. `acceptedThrough` carries the completion high-water pointer
   * per slot (the frozen contract requires at least one).
   */
  async ack(deliveryId: string): Promise<void> {
    const state = this.deliveries.get(deliveryId);
    if (!state) return;
    const acceptedThrough = Array.from(state.accepted.entries()).map(
      ([slot, seq]) => ({ turnId: state.turnId, slot, seq }),
    );
    if (acceptedThrough.length === 0) {
      // Nothing was accepted (e.g. an empty turn). Without an accepted frame
      // there is nothing to complete; let the lease lapse / redeliver instead
      // of sending an invalid (empty acceptedThrough) intent.
      this.deliveries.delete(deliveryId);
      return;
    }
    await this.channel.push(COMPLETE_REQUESTED, {
      type: COMPLETE_REQUESTED,
      occurredAt: this.now(),
      payload: {
        ...state.scope,
        deliveryId,
        turnId: state.turnId,
        runtimeInstanceId: this.runtimeInstanceId,
        acceptedThrough,
        requestedAt: this.now(),
      },
    });
    this.deliveries.delete(deliveryId);
  }

  async nack(deliveryId: string, reason: string): Promise<void> {
    const state = this.deliveries.get(deliveryId);
    if (!state) {
      // No state → no leaseToken to build a fenced fail intent, so nothing can
      // be sent; app-api releases the delivery on lease lapse. Reachable only
      // for an already-terminal/evicted delivery today; log rather than drop
      // silently so an unexpected hit is diagnosable.
      this.log?.("phoenix nack: no delivery state; dropping fail", {
        deliveryId,
        reason,
      });
      return;
    }
    const accepted = Array.from(state.accepted.entries()).map(
      ([slot, seq]) => ({
        turnId: state.turnId,
        slot,
        seq,
      }),
    );
    const lastAccepted = accepted[accepted.length - 1];
    await this.channel.push(DELIVERY_FAIL, {
      type: DELIVERY_FAIL,
      occurredAt: this.now(),
      payload: {
        ...state.scope,
        deliveryId,
        turnId: state.turnId,
        runtimeInstanceId: this.runtimeInstanceId,
        leaseToken: state.leaseToken,
        deliveryStatus: "retry_wait",
        ...(lastAccepted ? { lastAccepted } : {}),
        failedAt: this.now(),
        error: { code: "runtime_error", message: reason, retryable: true },
      },
    });
    this.deliveries.delete(deliveryId);
  }

  async stop(): Promise<void> {
    this.deliveries.clear();
  }
}
