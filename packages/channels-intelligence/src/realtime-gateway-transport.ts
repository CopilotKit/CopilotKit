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

import type {
  DeliverySource,
  RenderEventSink,
  AgentMessage,
} from "./transports.js";
import type {
  ChannelIngressEnvelope,
  ChannelDeliveryScope,
  EgressRoute,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";
import type { RealtimeGatewaySession } from "./realtime-gateway.js";
import { mapDeliveryToEnvelope } from "./claim-mapping.js";
import type { ClaimedDelivery } from "./claim-mapping.js";
import { IntelligenceFileHistoryClient } from "./intelligence-file-history.js";

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
  /**
   * Intelligence app-api HTTP base URL (e.g. `https://…/`). File bytes and
   * thread history are HTTP-only — the gateway relays the render-event stream
   * but never bytes/history — so the realtime path reaches these app-api REST
   * endpoints directly. Provide it (with {@link apiKey}) to enable
   * fetchFile/getHistory/uploadFile parity with the HTTP transport (OSS-476);
   * omit it and those capabilities stay absent (each turn starts fresh, inbound
   * files aren't fetched, outbound file posts are unavailable) exactly as before.
   */
  appApiBaseUrl?: string;
  /** Project runtime API key (`cpk-…`) for the app-api file/history calls.
   * Required alongside {@link appApiBaseUrl} to enable file/history. */
  apiKey?: string;
  /** ISO timestamp source; injectable for deterministic tests. */
  now?: () => string;
  /**
   * Optional diagnostic sink. The transport is otherwise silent, so dropped
   * deliveries (missing leaseToken, no state on nack) would be invisible —
   * wire this to surface them. Absent → drops stay silent (fail-closed).
   */
  log?: (message: string, meta?: unknown) => void;
  /**
   * Per-turn deadline (ms) for the `onDelivery` handler. A turn that throws or
   * hangs past this is nacked (released for redelivery) and logged, so a wedged
   * handler can't silently pin a delivery forever. Mirrors the HTTP transport's
   * `turnTimeoutMs`. Default {@link DEFAULT_DELIVERY_TIMEOUT_MS}.
   */
  deliveryTimeoutMs?: number;
}

/** Default per-turn deadline before a hung realtime turn is nacked and skipped. */
const DEFAULT_DELIVERY_TIMEOUT_MS = 120_000;

/**
 * Reject after `ms` if `p` hasn't settled, so a hung turn can't wedge a
 * delivery. The underlying promise keeps running in the background (a rejection
 * handler is attached, so it never surfaces as unhandled); the transport nacks
 * and moves on. Mirrors the HTTP transport's per-turn timeout.
 */
function withDeliveryTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    (timer as unknown as { unref?: () => void }).unref?.();
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
  /**
   * OSS-475: the claim's owner generation. Echoed on every render-accept /
   * complete / fail so app-api rejects a superseded owner (a stale, lower
   * generation) — the authoritative active/standby fence.
   */
  generation: number;
  /** Authoritative org/project/channel scope from the delivery (not the transport default). */
  scope: ChannelDeliveryScope;
  /** Highest accepted `seq` per render slot (the completion high-water mark). */
  accepted: Map<string, number>;
}

/**
 * Thrown internally when a delivery has a valid lease + turn identity but its
 * claim cannot be mapped to an ingress envelope (unmodeled reply-target adapter
 * / unknown input kind). Carries the fencing fields so the delivery can be
 * failed NON-retryably (dead-lettered) instead of dropped into an indefinite
 * re-lease loop — the exact poison-payload failure mode the HTTP transport
 * guards against with a non-retryable nack.
 */
class PoisonDeliveryError extends Error {
  constructor(
    readonly deliveryId: string,
    readonly leaseToken: string,
    readonly generation: number,
    readonly turnId: string,
    readonly scope: ChannelDeliveryScope,
    reason: string,
    options?: { cause?: unknown },
  ) {
    super(reason, options);
    this.name = "PoisonDeliveryError";
  }
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
  private readonly deliveryTimeoutMs: number;
  private readonly deliveries = new Map<string, DeliveryState>();
  private onDelivery?: (env: ChannelIngressEnvelope) => Promise<void>;
  /** Tail of the serial delivery-processing chain — see {@link start}. */
  private processing: Promise<void> = Promise.resolve();
  /** Set by {@link stop}; gates {@link handleDeliveryAvailable} so no new
   * delivery is processed after teardown (the session exposes no `off`, so the
   * DELIVERY_AVAILABLE listener cannot be detached). */
  private stopped = false;

  /**
   * File/history capabilities (OSS-476). Assigned only when the transport is
   * configured with an app-api HTTP client (`appApiBaseUrl` + `apiKey`); left
   * `undefined` otherwise so the adapter's optional-chaining degrades exactly
   * as before (no history, no inbound file bytes, no outbound file post). These
   * are HTTP-only — they never touch the gateway session.
   */
  readonly fetchFile?: (
    handle: string,
  ) => Promise<{ bytes: Uint8Array; mimeType?: string }>;
  readonly getHistory?: (
    replyTarget: EgressRoute,
    limit: number,
  ) => Promise<AgentMessage[]>;
  readonly uploadFile?: (
    deliveryId: string,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ) => Promise<{ handle: string }>;

  constructor(config: RealtimeGatewayTransportOptions) {
    assertValidChannelRealtimeScope(config.scope);
    this.scope = config.scope;
    this.runtimeInstanceId = config.runtimeInstanceId;
    this.session = config.session;
    this.now = config.now ?? (() => new Date().toISOString());
    this.log = config.log;
    this.deliveryTimeoutMs =
      config.deliveryTimeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS;
    // File/history parity is HTTP-only; wire the shared client (identical to
    // the HTTP transport's) when app-api coordinates are supplied.
    if (config.appApiBaseUrl && config.apiKey) {
      const fileHistory = new IntelligenceFileHistoryClient({
        baseUrl: config.appApiBaseUrl,
        apiKey: config.apiKey,
        log: config.log,
      });
      this.fetchFile = (handle) => fileHistory.fetchFile(handle);
      this.getHistory = (replyTarget, limit) =>
        fileHistory.getHistory(replyTarget, limit);
      this.uploadFile = (deliveryId, args) =>
        fileHistory.uploadFile(deliveryId, args);
    }
  }

  async start(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.onDelivery = onDelivery;
    this.session.on(DELIVERY_AVAILABLE, (payload) => {
      // Process deliveries SERIALLY (one at a time), matching the HTTP
      // transport's single-delivery runLoop. Concurrent handling would let an
      // at-least-once redelivery of an in-flight turnId reset the shared
      // per-turn `seq` counter mid-run — corrupting egress operation ids /
      // render idempotency keys (`${turnId}:${slot}:${seq}`) — and run two turns
      // of the same conversation against one agent/session simultaneously.
      //
      // Each link is error-boundaried so one failed delivery never poisons the
      // chain (the `.catch` keeps `this.processing` resolved for the next
      // delivery): without it, an onDelivery rejection or a pre-registration
      // parse/setup throw would surface as an unhandled rejection and stall the
      // queue. The per-turn failure/timeout and poison paths inside
      // handleDeliveryAvailable nack; this outer catch is the last-resort net.
      this.processing = this.processing
        .then(() => this.handleDeliveryAvailable(payload))
        .catch((err: unknown) => {
          this.log?.("realtime gateway delivery dispatch failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    });
  }

  private async handleDeliveryAvailable(payload: unknown): Promise<void> {
    // Stop consuming once torn down. The DELIVERY_AVAILABLE listener can't be
    // detached (the session has no `off`), so this guard is how stop() halts
    // intake — otherwise a delivery arriving after stop() (the caller-owned
    // session in `startChannelsWithGatewaySession` stays connected) would spin
    // up a fresh turn on a dead adapter.
    if (this.stopped) return;
    let claimed:
      | {
          env: ChannelIngressEnvelope;
          scope: ChannelDeliveryScope;
          leaseToken: string;
          generation: number;
        }
      | undefined;
    try {
      claimed = this.toIngressEnvelope(payload);
    } catch (err) {
      if (err instanceof PoisonDeliveryError) {
        // Unmappable delivery with a valid lease: register minimal state and
        // fail it NON-retryably so app-api dead-letters it instead of re-leasing
        // the identical poison payload forever (parity with the HTTP path).
        this.deliveries.set(err.deliveryId, {
          turnId: err.turnId,
          leaseToken: err.leaseToken,
          generation: err.generation,
          scope: err.scope,
          accepted: new Map(),
        });
        this.log?.(
          "realtime gateway delivery unmappable; failing non-retryable (dead-letter)",
          { deliveryId: err.deliveryId, error: err.message },
        );
        await this.nack(err.deliveryId, err.message, false).catch(
          (nackErr: unknown) =>
            this.log?.(
              "realtime gateway nack after unmappable delivery failed",
              {
                deliveryId: err.deliveryId,
                error:
                  nackErr instanceof Error ? nackErr.message : String(nackErr),
              },
            ),
        );
        return;
      }
      throw err;
    }
    if (!claimed) return;
    const { env, scope, leaseToken, generation } = claimed;
    this.deliveries.set(env.deliveryId, {
      turnId: env.turnId,
      leaseToken,
      generation,
      scope,
      accepted: new Map(),
    });
    // Bound the turn (parity with the HTTP runLoop): a handler that throws or
    // hangs past deliveryTimeoutMs must not wedge the delivery or leave the
    // render stream half-open. On failure, nack so app-api releases the lease
    // and redelivers rather than the turn silently pinning the delivery.
    try {
      await withDeliveryTimeout(
        Promise.resolve(this.onDelivery?.(env)),
        this.deliveryTimeoutMs,
        `realtime gateway turn ${env.turnId} exceeded ${this.deliveryTimeoutMs}ms`,
      );
    } catch (err) {
      this.log?.("realtime gateway turn failed/timed out; nacking", {
        deliveryId: env.deliveryId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.nack(
        env.deliveryId,
        err instanceof Error ? err.message : String(err),
      ).catch((nackErr: unknown) =>
        this.log?.("realtime gateway nack after turn failure failed", {
          deliveryId: env.deliveryId,
          error: nackErr instanceof Error ? nackErr.message : String(nackErr),
        }),
      );
    }
  }

  /**
   * Map a `delivery.available.v1`'s claimed delivery to the adapter's ingress
   * envelope plus the authoritative `scope` and `leaseToken` the transport
   * stashes for later complete/fail intents. Returns `undefined` (delivery
   * dropped, logged via {@link RealtimeGatewayTransportOptions.log}) when the turn
   * identity is missing/unmodeled or the delivery carries no `leaseToken` (a
   * fenced intent can't be built without it). The envelope itself is built by
   * the shared {@link mapDeliveryToEnvelope} — the SAME mapper the HTTP
   * transport uses — so the realtime path has full parity (OSS-476): it
   * discriminates on `input.kind` (turn/command/reaction/interaction), derives
   * a thread-stable `conversationKey`, and threads the provider `actor` through
   * as `env.user`. A malformed/unmodeled delivery (bad reply-target adapter,
   * unknown input kind) throws in the mapper and is dropped+logged here rather
   * than crashing the delivery handler (fail-closed).
   */
  private toIngressEnvelope(payload: unknown):
    | {
        env: ChannelIngressEnvelope;
        scope: ChannelDeliveryScope;
        leaseToken: string;
        generation: number;
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
    // OSS-475: the owner generation fences accept/complete/fail. Without it a
    // fenced intent can't be built, so drop (re-lease) — the same version-skew
    // failure mode as a missing lease token above.
    const generation = Number(delivery.generation);
    if (!Number.isInteger(generation) || generation < 0) {
      this.log?.(
        "realtime gateway delivery dropped: missing/invalid generation on delivery.available (gateway/SDK version skew?) — will be re-leased",
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
    // Build the ingress envelope via the shared claim mapper (parity with the
    // HTTP transport). The scope's channel name/adapter fallbacks are folded in
    // so the mapper sees a fully-resolved delivery; the mapper throws on an
    // unmodeled reply-target adapter or input kind, so drop+log on failure.
    try {
      const claimed: ClaimedDelivery = {
        id: String(delivery.id),
        organizationId: organizationId ?? "",
        projectId: scope.projectId,
        channel: { id: channelId ?? "", name: scope.channelName },
        adapter: String(delivery.adapter ?? "slack"),
        leaseToken,
        generation,
        turn: delivery.turn as ClaimedDelivery["turn"],
      };
      return {
        scope,
        leaseToken,
        generation,
        env: mapDeliveryToEnvelope(claimed),
      };
    } catch (err) {
      // A valid lease + turn identity but an unmappable claim (unmodeled
      // reply-target adapter / unknown input kind) is a POISON payload: dropping
      // it (return undefined) would leak the lease and re-lease the identical
      // payload forever. Surface it so the caller fails it non-retryably.
      throw new PoisonDeliveryError(
        String(delivery.id),
        leaseToken,
        generation,
        String(turn.id),
        scope,
        `could not map claim to ingress envelope (unmodeled reply-target adapter or input kind?): ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
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
        // Fence the render-accept on the lease token (OSS-446) + owner
        // generation (OSS-475), matching the complete/fail paths. Both come from
        // the tracked delivery state; omitted only when state is absent (a
        // degraded delivery app-api will re-lease).
        ...(state
          ? { leaseToken: state.leaseToken, generation: state.generation }
          : {}),
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
    // Claim the terminal signal BEFORE the wire call, mirroring the HTTP
    // transport's delete-before-POST. A turn that times out (handleDeliveryAvailable
    // nacks) while its dispatch keeps running in the background will call ack()
    // here; deleting first guarantees whichever of ack/nack runs first wins and
    // the loser no-ops on missing state — exactly one of complete_requested XOR
    // fail reaches app-api for a given delivery.
    const acceptedThrough = Array.from(state.accepted.entries()).map(
      ([slot, seq]) => ({ turnId: state.turnId, slot, seq }),
    );
    this.deliveries.delete(deliveryId);
    if (acceptedThrough.length === 0) {
      // Nothing was accepted (e.g. an empty turn). Without an accepted frame
      // there is nothing to complete; let the lease lapse / redeliver instead
      // of sending an invalid (empty acceptedThrough) intent.
      // NOTE (OSS-491): a legitimately empty turn (a reaction/command handler
      // that posts nothing) has no valid completion signal under the frozen
      // contract (acceptedThrough requires >=1), so it redelivers until
      // max_attempts. A terminal "completed-empty" signal needs app-api
      // coordination — tracked in OSS-491, not fixable SDK-side here. Log it so
      // the resulting redelivery pile-up is diagnosable (every other drop path
      // in this transport logs).
      this.log?.(
        "realtime gateway ack: empty turn (no accepted frames) — no completion sent; will redeliver until max_attempts (OSS-491)",
        { deliveryId },
      );
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
        // Fence the completion intent on the lease token (OSS-446) + owner
        // generation (OSS-475); a superseded owner's stale generation is
        // rejected by app-api.
        leaseToken: state.leaseToken,
        generation: state.generation,
        acceptedThrough,
        requestedAt: this.now(),
      },
    });
  }

  /**
   * Send a `fail` intent for a delivery. `retryable` (default `true`) controls
   * whether app-api re-leases: a transient turn failure is retryable; an
   * unmappable/poison delivery is NOT (`retryable: false`) so app-api
   * dead-letters it instead of redelivering the identical payload forever
   * (mirrors {@link http-transports} `HttpDeliverySource.nack`). `error.retryable`
   * is the authoritative signal (the HTTP path drives dead-lettering off it);
   * the realtime-only `deliveryStatus: "retry_wait"` decoration is sent only on
   * the retryable path so it never contradicts a non-retryable fail.
   */
  async nack(
    deliveryId: string,
    reason: string,
    retryable = true,
  ): Promise<void> {
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
    // Claim the terminal signal BEFORE the wire call (XOR with ack) — see ack().
    this.deliveries.delete(deliveryId);
    await this.session.push(DELIVERY_FAIL, {
      type: DELIVERY_FAIL,
      occurredAt: this.now(),
      payload: {
        ...state.scope,
        deliveryId,
        turnId: state.turnId,
        runtimeInstanceId: this.runtimeInstanceId,
        leaseToken: state.leaseToken,
        generation: state.generation,
        ...(retryable ? { deliveryStatus: "retry_wait" } : {}),
        ...(lastAccepted ? { lastAccepted } : {}),
        failedAt: this.now(),
        // Bound the reason (parity with HttpDeliverySource.nack) so a long
        // error/stack isn't sent verbatim over the gateway socket.
        error: {
          code: "runtime_error",
          message: (reason || "runtime error").slice(0, 500),
          retryable,
        },
      },
    });
  }

  async stop(): Promise<void> {
    // Halt new intake (the guard in handleDeliveryAvailable), then DRAIN the
    // in-flight delivery before clearing state. Without the drain, a turn that
    // settles after `deliveries.clear()` finds no DeliveryState and its
    // ack/nack silently no-ops — the terminal signal is lost and the delivery
    // redelivers. Mirrors HttpDeliverySource.stop() (running=false + await loop).
    this.stopped = true;
    await this.processing.catch(() => {});
    this.deliveries.clear();
  }
}
