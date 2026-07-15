// Realtime Gateway transport for the Channels SDK (OSS-402).
//
// This is the production render/delivery path: the SDK joins the gateway's
// per-project session, receives leased deliveries, streams semantic
// `channel.render_event.v1` frames, waits for durable
// `channel.render_accepted.v1` receipts, and — only after frames are
// accepted — sends a `channel.delivery.complete_requested.v1` COMPLETION
// INTENT (never a committed `channel.delivery.ack.v1`; app-api owns ack).
// On failure it sends `channel.delivery.fail.v1`. The SDK never receives
// Slack/provider credentials — rendering to the provider happens on the
// gateway-side Connector Outbox.
//
// The connector implementation is intentionally not imported here: the
// protocol is expressed against an injected {@link RealtimeGatewaySession}, so
// it is fully unit-testable with a fake gateway session.
//
// Scope (out of this checkpoint): discrete `EgressSink` posts from
// command/interaction handlers are not yet streamed as `post`/`update` render
// frames here — that needs a per-`(turn, slot)` seq shared with the run
// renderer and is a follow-up. This transport covers the agent-run render
// stream + delivery lifecycle.

import type { DeliverySource, RenderEventSink } from "./transports.js";
import type {
  ChannelIngressEnvelope,
  ChannelDeliveryScope,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";
import type { RealtimeGatewaySession } from "./realtime-gateway.js";

/** The org/project/channel scope every realtime envelope carries. */
export interface ChannelRealtimeScope extends ChannelDeliveryScope {}

const CHANNEL_ID_RE = /^channel_[A-Za-z0-9_-]+$/;
const ORGANIZATION_ID_RE = /^org_[A-Za-z0-9_-]+$/;
const CHANNEL_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * @internal Validate the product scope before a realtime connection is
 * opened. The live gateway join contract keys only on `projectId` +
 * `channelName` (OSS-473) — `organizationId`/`channelId` are optional and
 * are format-checked only when present.
 */
export function assertValidChannelRealtimeScope(
  scope: ChannelRealtimeScope,
): void {
  if (!Number.isInteger(scope.projectId) || scope.projectId <= 0) {
    throw new Error(
      "Realtime Gateway Channel scope requires a positive projectId",
    );
  }
  if (
    scope.organizationId !== undefined &&
    !ORGANIZATION_ID_RE.test(scope.organizationId)
  ) {
    throw new Error(
      `Realtime Gateway Channel scope requires an org_* organizationId, got ${JSON.stringify(scope.organizationId)}`,
    );
  }
  if (scope.channelId !== undefined && !CHANNEL_ID_RE.test(scope.channelId)) {
    throw new Error(
      `Realtime Gateway Channel scope requires a channel_* channelId, got ${JSON.stringify(scope.channelId)}`,
    );
  }
  if (
    scope.channelName.length < 3 ||
    scope.channelName.length > 64 ||
    !CHANNEL_NAME_RE.test(scope.channelName)
  ) {
    throw new Error(
      `Realtime Gateway Channel scope requires a lowercase kebab-case channelName, got ${JSON.stringify(scope.channelName)}`,
    );
  }
}

export interface RealtimeGatewayTransportOptions {
  scope: ChannelRealtimeScope;
  /** Unique per runtime instance (rti_…), echoed on every SDK->gateway event. */
  runtimeInstanceId: string;
  /** The joined Realtime Gateway session. */
  session: RealtimeGatewaySession;
  /** ISO timestamp source; injectable for deterministic tests. */
  now?: () => string;
  /**
   * Optional diagnostic sink. The transport is otherwise silent, so dropped
   * deliveries (missing leaseToken, no state on nack) would be invisible —
   * wire this to surface them. Absent → drops stay silent (fail-closed).
   */
  log?: (message: string, meta?: unknown) => void;
}

const RENDER_EVENT = "channel.render_event.v1";
const RENDER_ACCEPTED = "channel.render_accepted.v1";
const DELIVERY_AVAILABLE = "channel.delivery.available.v1";
const COMPLETE_REQUESTED = "channel.delivery.complete_requested.v1";
const DELIVERY_FAIL = "channel.delivery.fail.v1";

/** Per-delivery state the transport needs to build completion/fail intents. */
interface DeliveryState {
  turnId: string;
  /** app-api's per-delivery lease token, fences the complete/fail intent. */
  leaseToken: string;
  /** Authoritative org/project/channel scope from the delivery (not the transport default). */
  scope: ChannelDeliveryScope;
  /** Highest accepted `seq` per render slot (the completion high-water mark). */
  accepted: Map<string, number>;
}

/**
 * Realtime Gateway transport implementing both the inbound {@link DeliverySource}
 * and the streaming {@link RenderEventSink}. `ack` maps to the completion
 * INTENT (`complete_requested`) and `nack` to `fail` — the SDK is never the
 * committed-ack authority.
 */
export class RealtimeGatewayTransport
  implements DeliverySource, RenderEventSink
{
  private readonly scope: ChannelRealtimeScope;
  private readonly runtimeInstanceId: string;
  private readonly session: RealtimeGatewaySession;
  private readonly now: () => string;
  private readonly log?: (message: string, meta?: unknown) => void;
  private readonly deliveries = new Map<string, DeliveryState>();
  private onDelivery?: (env: ChannelIngressEnvelope) => Promise<void>;

  constructor(config: RealtimeGatewayTransportOptions) {
    assertValidChannelRealtimeScope(config.scope);
    this.scope = config.scope;
    this.runtimeInstanceId = config.runtimeInstanceId;
    this.session = config.session;
    this.now = config.now ?? (() => new Date().toISOString());
    this.log = config.log;
  }

  async start(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.onDelivery = onDelivery;
    this.session.on(DELIVERY_AVAILABLE, (payload) => {
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
   * dropped, logged via {@link RealtimeGatewayTransportOptions.log}) when the turn
   * identity is missing/unmodeled or the delivery carries no `leaseToken` (a
   * fenced intent can't be built without it). V1 assumes every leased delivery
   * is a text turn and does not discriminate on `input.kind` — non-text kinds
   * (command/interaction/reaction) are not yet modeled on the realtime path
   * and will be mis-handled (coerced into a text turn) until they are
   * (tracked for the event-parity follow-up).
   */
  private toIngressEnvelope(payload: unknown):
    | {
        env: ChannelIngressEnvelope;
        scope: ChannelDeliveryScope;
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
      this.log?.("realtime gateway delivery dropped: missing turn id/eventId", {
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
        "realtime gateway delivery dropped: no leaseToken on delivery.available (gateway/SDK version skew?) — will be re-leased",
        { deliveryId: delivery.id },
      );
      return undefined;
    }
    const channel = delivery.channel as
      | { id?: string; name?: string }
      | undefined;
    // organizationId/channelId are optional on the scope (OSS-473): fall back
    // to the transport default only when present, rather than coercing an
    // absent value to the literal string "undefined".
    const organizationId =
      delivery.organizationId !== undefined
        ? String(delivery.organizationId)
        : this.scope.organizationId;
    const channelId =
      channel?.id !== undefined ? String(channel.id) : this.scope.channelId;
    const scope: ChannelDeliveryScope = {
      ...(organizationId !== undefined ? { organizationId } : {}),
      projectId:
        typeof delivery.projectId === "number"
          ? delivery.projectId
          : this.scope.projectId,
      ...(channelId !== undefined ? { channelId } : {}),
      channelName: String(channel?.name ?? this.scope.channelName),
    };
    return {
      scope,
      leaseToken,
      env: {
        kind: "turn",
        deliveryId: String(delivery.id),
        eventId: String(turn.eventId),
        turnId: String(turn.id),
        // This product-level field names the Channel; bot core attaches the
        // adapter directly to the framework Channel named by `createChannel({ name })`.
        channelName: scope.channelName,
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
        // Fence the render-accept on the lease token (OSS-446), matching the
        // fail path. Optional — omitted when no state (app-api falls back to
        // instance-id + expiry), present for a normally-leased delivery.
        ...(state ? { leaseToken: state.leaseToken } : {}),
        sentAt: this.now(),
      },
    };
    const reply = await this.session.push(RENDER_EVENT, envelope);
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
        `RealtimeGatewayTransport: expected ${RENDER_ACCEPTED} for ${idempotencyKey}, got ${r?.type ?? "no reply"}`,
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
    await this.session.push(COMPLETE_REQUESTED, {
      type: COMPLETE_REQUESTED,
      occurredAt: this.now(),
      payload: {
        ...state.scope,
        deliveryId,
        turnId: state.turnId,
        runtimeInstanceId: this.runtimeInstanceId,
        // Fence the completion intent on the lease token (OSS-446), matching
        // the fail path; app-api fences when present, falls back otherwise.
        leaseToken: state.leaseToken,
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
      this.log?.("realtime gateway nack: no delivery state; dropping fail", {
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
    await this.session.push(DELIVERY_FAIL, {
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
