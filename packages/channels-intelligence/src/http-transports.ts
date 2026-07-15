import { randomUUID } from "node:crypto";
import type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
  AgentMessage,
} from "./transports.js";
import type {
  ChannelIngressEnvelope,
  ChannelDeliveryScope,
  ChannelFileRef,
  EgressRoute,
  EgressOperation,
  EgressResult,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";
import type { AgentContentPart } from "@copilotkit/channels-ui";
import { irToText } from "./ir-to-text.js";
import { buildContentParts } from "./content-parts.js";
import { mapDeliveryToEnvelope } from "./claim-mapping.js";
import type { ClaimedDelivery } from "./claim-mapping.js";
import { IntelligenceFileHistoryClient } from "./intelligence-file-history.js";

/**
 * @internal Default HTTP transports for {@link intelligenceAdapter}.
 *
 * These are the credentialed wire to a running Intelligence app-api: the
 * {@link HttpDeliverySource} polls the listener `claim` route and lease-fences
 * ack/fail; the {@link HttpEgressSink} posts replies to the egress route.
 * `intelligenceAdapter()` builds them by default (config from env), so a
 * consumer only writes `createChannel({ adapters: [intelligenceAdapter()] })`.
 * Exported as undocumented fallbacks — the whole package is `@internal`.
 */

/** Minimal fetch shape (avoids DOM/Node lib coupling). Defaults to global `fetch`. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface IntelligenceTransportConfig {
  /** Intelligence app-api base URL, e.g. `http://localhost:7050`. */
  baseUrl: string;
  /** Project runtime API key (`cpk-…`), sent as `Authorization: Bearer`. */
  apiKey: string;
  /** Project-unique channel name; defaults from `createChannel({ name })`. */
  channelName: string;
  /** Stable runtime instance id (`rti_…`); generated when omitted. */
  runtimeInstanceId: string;
  /** Adapter kind. First slice is `"slack"`. */
  adapter: string;
  /** Injectable fetch (tests); defaults to global `fetch`. */
  fetch?: FetchLike;
  /** Heartbeat cadence / poll-sleep ceiling in ms (default 15000). */
  heartbeatIntervalMs?: number;
  /** Injectable sleep (tests); defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional logger for loop/transport diagnostics. */
  log?: (msg: string, meta?: unknown) => void;
  /**
   * Max wall-clock a single turn may take before the listener gives up on it,
   * `nack`s the delivery, and moves on (default 120000). Prevents a hung turn
   * (e.g. a HITL approval that never arrives, or a half-open stream) from
   * wedging the single-delivery-at-a-time loop indefinitely.
   */
  turnTimeoutMs?: number;
}

/**
 * Resolve transport config from explicit overrides then environment, failing
 * loudly if a required field is missing. Env: `COPILOTKIT_INTELLIGENCE_URL`,
 * `COPILOTKIT_API_KEY`, `COPILOTKIT_CHANNEL_NAME`,
 * `COPILOTKIT_RUNTIME_INSTANCE_ID`.
 */
export function resolveTransportConfig(
  overrides: Partial<IntelligenceTransportConfig> = {},
): IntelligenceTransportConfig {
  const env =
    typeof process !== "undefined"
      ? process.env
      : ({} as Record<string, string | undefined>);
  const baseUrl = (
    overrides.baseUrl ?? env["COPILOTKIT_INTELLIGENCE_URL"]
  )?.replace(/\/+$/, "");
  const apiKey = overrides.apiKey ?? env["COPILOTKIT_API_KEY"];
  const channelName = overrides.channelName ?? env["COPILOTKIT_CHANNEL_NAME"];
  const runtimeInstanceId =
    overrides.runtimeInstanceId ??
    env["COPILOTKIT_RUNTIME_INSTANCE_ID"] ??
    `rti_${randomUUID().replace(/-/g, "")}`;
  const adapter = overrides.adapter ?? "slack";

  const missing: string[] = [];
  if (!baseUrl) missing.push("baseUrl (COPILOTKIT_INTELLIGENCE_URL)");
  if (!apiKey) missing.push("apiKey (COPILOTKIT_API_KEY)");
  if (!channelName)
    missing.push(
      "channelName (createChannel({ name }) / COPILOTKIT_CHANNEL_NAME)",
    );
  if (missing.length > 0) {
    throw new Error(
      `intelligenceAdapter: missing required transport config: ${missing.join(", ")}`,
    );
  }

  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    channelName: channelName!,
    runtimeInstanceId,
    adapter,
    fetch: overrides.fetch,
    heartbeatIntervalMs: overrides.heartbeatIntervalMs,
    sleep: overrides.sleep,
    log: overrides.log,
    turnTimeoutMs: overrides.turnTimeoutMs,
  };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Don't let a pending poll-sleep hold the event loop open (parity with the
    // realtime transport's timers) so the process can exit after stop().
    (timer as unknown as { unref?: () => void }).unref?.();
  });

/** Default per-turn deadline before a hung turn is nacked and skipped. */
const DEFAULT_TURN_TIMEOUT_MS = 120_000;

/**
 * Reject after `ms` if `p` hasn't settled, so a hung turn can't wedge the
 * single-delivery loop. The underlying promise keeps running in the background
 * (harmless — a rejection handler is attached), but the loop moves on.
 */
function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    // Don't let a pending per-turn deadline hold the event loop open (parity
    // with the realtime transport's withDeliveryTimeout).
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

/** Slack reply target Intelligence mints at ingress and the sink echoes back. */
/** Per-delivery org/project/channel scope, echoed onto render frames. */
type ClaimResponse =
  | { claimed: false; pollAfterMs: number }
  | { claimed: true; delivery: ClaimedDelivery };

interface EgressResponse {
  operationId: string;
  status: "accepted" | "duplicate" | "sent" | "failed";
  error?: { code: string; message: string; retryable: boolean };
}

/** A `cpk-`-authenticated JSON POST helper against Intelligence app-api. */
class IntelligenceHttp {
  constructor(private readonly cfg: IntelligenceTransportConfig) {}

  private fetchImpl(): FetchLike {
    const f =
      this.cfg.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!f) {
      throw new Error(
        "intelligenceAdapter: no fetch available — provide config.fetch or run on Node 18+",
      );
    }
    return f;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl()(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(
        `intelligence ${path} -> ${res.status}: ${raw.slice(0, 300)}`,
      );
    }
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  }
}

interface LeaseRecord {
  turnId: string;
  leaseToken: string;
  scope: ChannelDeliveryScope;
}

/**
 * @internal {@link DeliverySource} that polls Intelligence's runtime listener
 * routes (heartbeat + claim) and lease-fences ack/fail. One delivery is
 * processed at a time: the claim loop awaits `onDelivery` (which the adapter
 * resolves only after it has called back into `ack`/`nack`).
 */
export class HttpDeliverySource implements DeliverySource {
  private readonly http: IntelligenceHttp;
  private readonly fileHistory: IntelligenceFileHistoryClient;
  private readonly leases = new Map<string, LeaseRecord>();
  private running = false;
  private loop?: Promise<void>;
  private lastHeartbeatAt = 0;

  constructor(private readonly cfg: IntelligenceTransportConfig) {
    this.http = new IntelligenceHttp(cfg);
    this.fileHistory = new IntelligenceFileHistoryClient({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      log: cfg.log,
    });
  }

  private sleep(ms: number): Promise<void> {
    return (this.cfg.sleep ?? defaultSleep)(ms);
  }

  /** Declare this runtime + channel to Intelligence and keep the activation fresh. */
  async heartbeat(): Promise<void> {
    await this.http.post("/api/channels/listener/heartbeat", {
      runtimeInstanceId: this.cfg.runtimeInstanceId,
      declaredChannels: [
        { channelName: this.cfg.channelName, adapter: this.cfg.adapter },
      ],
      observedAt: new Date().toISOString(),
    });
    this.lastHeartbeatAt = Date.now();
  }

  /** Claim a single delivery; returns the mapped envelope, or the idle backoff. */
  async claimOnce(): Promise<
    { env: ChannelIngressEnvelope } | { pollAfterMs: number }
  > {
    const res = await this.http.post<ClaimResponse>(
      "/api/channels/listener/claim",
      {
        // Claim provider-agnostically: the Channel runtime emits abstract render
        // frames and Intelligence renders per the delivery's own reply target, so
        // a single runtime serves every channel its bot has attached (Slack,
        // Teams, ...). Declaring a single adapter here made Intelligence withhold
        // deliveries for the bot's other channels (e.g. a Slack-declared runtime
        // never received the same bot's Teams messages).
        runtimeInstanceId: this.cfg.runtimeInstanceId,
      },
    );
    if (!res.claimed) return { pollAfterMs: res.pollAfterMs ?? 1000 };
    this.leases.set(res.delivery.id, {
      turnId: res.delivery.turn.id,
      leaseToken: res.delivery.leaseToken,
      scope: {
        organizationId: res.delivery.organizationId,
        projectId: res.delivery.projectId,
        channelId: res.delivery.channel.id,
        channelName: res.delivery.channel.name,
      },
    });
    try {
      return { env: mapDeliveryToEnvelope(res.delivery) };
    } catch (mapErr) {
      // An unmappable/unknown delivery kind must fail loud, but must not wedge
      // the single-delivery loop: the lease is already recorded, so nack it
      // here (non-retryable — re-mapping the same payload fails identically, so
      // let app-api dead-letter it rather than burn retries) and fall through to
      // an idle poll so the loop keeps draining the queue. Without this the
      // throw escapes to runLoop's catch, which only logs+sleeps, leaking the
      // lease until the 120s expiry redelivers the same poison payload forever.
      this.cfg.log?.("intelligence claim: unmappable delivery", mapErr);
      await this.nack(
        res.delivery.id,
        mapErr instanceof Error ? mapErr.message : String(mapErr),
        false,
      ).catch((nackErr) =>
        this.cfg.log?.(
          "intelligence nack after unmappable delivery failed",
          nackErr,
        ),
      );
      return { pollAfterMs: 1000 };
    }
  }

  /** The org/project/channel scope for a leased delivery, for render-frame egress. */
  scopeFor(deliveryId: string): ChannelDeliveryScope | undefined {
    return this.leases.get(deliveryId)?.scope;
  }

  /** The lease token for a leased delivery, so a render frame can fence its
   * accept against `lease_token_hash` the same way ack/fail already do. */
  leaseTokenFor(deliveryId: string): string | undefined {
    return this.leases.get(deliveryId)?.leaseToken;
  }

  async start(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.running = true;
    await this.heartbeat();
    this.loop = this.runLoop(onDelivery);
  }

  private async runLoop(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    const cadence = this.cfg.heartbeatIntervalMs ?? 15000;
    while (this.running) {
      try {
        if (Date.now() - this.lastHeartbeatAt >= cadence)
          await this.heartbeat();
        const r = await this.claimOnce();
        if ("env" in r) {
          // The adapter dispatches the turn and calls back into ack/nack
          // before this resolves — at-least-once, one delivery at a time.
          // Bound it: a turn that throws or hangs must not wedge the loop, so
          // we time it out, `nack` to release the lease immediately (app-api
          // then retries / dead-letters at max_attempts), and keep polling.
          const env = r.env;
          const timeoutMs = this.cfg.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
          try {
            await withTimeout(
              onDelivery(env),
              timeoutMs,
              `turn ${env.turnId} exceeded ${timeoutMs}ms`,
            );
          } catch (turnErr) {
            this.cfg.log?.("intelligence turn failed/timed out", turnErr);
            await this.nack(
              env.deliveryId,
              turnErr instanceof Error ? turnErr.message : String(turnErr),
            ).catch((nackErr) =>
              this.cfg.log?.(
                "intelligence nack after turn failure failed",
                nackErr,
              ),
            );
          }
        } else {
          await this.sleep(Math.min(r.pollAfterMs || 1000, cadence));
        }
      } catch (err) {
        this.cfg.log?.("intelligence listener loop error", err);
        await this.sleep(2000);
      }
    }
  }

  async ack(deliveryId: string): Promise<void> {
    const lease = this.leases.get(deliveryId);
    if (!lease) {
      this.cfg.log?.(`intelligence ack: no lease for delivery ${deliveryId}`);
      return;
    }
    // Claim the terminal signal BEFORE the wire call. A turn that completes in
    // the background after a timeout-`nack` (both close over this lease) must
    // not also ack: whichever of ack/nack runs first deletes the lease, so the
    // other sees none and no-ops — exactly one of ack XOR fail reaches app-api.
    this.leases.delete(deliveryId);
    await this.http.post(
      `/api/channels/deliveries/${encodeURIComponent(deliveryId)}/ack`,
      {
        turnId: lease.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        leaseToken: lease.leaseToken,
        acknowledgedAt: new Date().toISOString(),
      },
    );
  }

  async nack(
    deliveryId: string,
    reason: string,
    retryable = true,
  ): Promise<void> {
    const lease = this.leases.get(deliveryId);
    if (!lease) {
      this.cfg.log?.(`intelligence nack: no lease for delivery ${deliveryId}`);
      return;
    }
    // Delete-before-POST for the same reason as `ack`: single terminal signal.
    this.leases.delete(deliveryId);
    await this.http.post(
      `/api/channels/deliveries/${encodeURIComponent(deliveryId)}/fail`,
      {
        turnId: lease.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        leaseToken: lease.leaseToken,
        failedAt: new Date().toISOString(),
        error: {
          code: "runtime_error",
          message: (reason || "runtime error").slice(0, 500),
          retryable,
        },
      },
    );
  }

  // fetchFile / getHistory / uploadFile delegate to the shared
  // IntelligenceFileHistoryClient so the HTTP and realtime transports stay in
  // lockstep (OSS-476). See {@link IntelligenceFileHistoryClient}.
  fetchFile(handle: string): Promise<{ bytes: Uint8Array; mimeType?: string }> {
    return this.fileHistory.fetchFile(handle);
  }

  getHistory(replyTarget: EgressRoute, limit: number): Promise<AgentMessage[]> {
    return this.fileHistory.getHistory(replyTarget, limit);
  }

  uploadFile(
    deliveryId: string,
    args: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ handle: string }> {
    return this.fileHistory.uploadFile(deliveryId, args);
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop?.catch(() => {});
  }
}

/**
 * @internal {@link EgressSink} that posts replies to Intelligence's egress
 * route. IR is flattened to plain text (first slice — Intelligence renders
 * natively later); the egress operation id is the idempotency key so SDK
 * redeliveries dedupe at Intelligence.
 */
export class HttpEgressSink implements EgressSink {
  private readonly http: IntelligenceHttp;

  constructor(private readonly cfg: IntelligenceTransportConfig) {
    this.http = new IntelligenceHttp(cfg);
  }

  async emit(op: EgressOperation): Promise<EgressResult> {
    // First slice: Intelligence egress is post-only. A delete has no remote
    // message to remove; ack it as a no-op so the run isn't treated as failed.
    if (op.op.kind === "delete") return { ok: true, ref: op.operationId };

    const text = irToText(op.op.ir);
    // Intelligence requires non-empty text; skip empties without a 400.
    if (!text) return { ok: true, ref: op.operationId };

    try {
      const res = await this.http.post<EgressResponse>(
        "/api/channels/egress/messages",
        {
          channelName: this.cfg.channelName,
          adapter: this.cfg.adapter,
          deliveryId: op.deliveryId,
          idempotencyKey: op.operationId,
          replyTarget: op.route,
          text,
        },
      );
      if (res.status === "failed") {
        return { ok: false, code: res.error?.code ?? "failed" };
      }
      return { ok: true, ref: res.operationId };
    } catch (err) {
      return {
        ok: false,
        code: err instanceof Error ? err.message : "egress_error",
      };
    }
  }
}

/** Durable render-acceptance receipt (subset the sink reads). */
interface RenderAcceptedResponse {
  idempotencyKey?: string;
  acceptance?: RenderAccepted["acceptance"];
  egressOperationId?: string;
}

/**
 * @internal {@link RenderEventSink} that streams semantic render frames to
 * Intelligence's durable render-acceptance route
 * (`/api/channels/deliveries/:id/render-events/accept`). This is the HTTP-path
 * equivalent of the realtime {@link RealtimeGatewayTransport}: each frame is
 * POSTed and the durable acceptance receipt is awaited before the next. The
 * gateway-side Connector Outbox then renders the accepted frames to Slack, so
 * this path reaches full reply-UX parity without a running realtime gateway.
 *
 * Per-delivery org/project/channel scope is read from the {@link HttpDeliverySource}
 * that leased the delivery (populated at claim). The `deliveryId` travels in the
 * URL only — the accept route rejects a body that also carries it.
 */
export class HttpRenderEventSink implements RenderEventSink {
  private readonly http: IntelligenceHttp;

  constructor(
    private readonly cfg: IntelligenceTransportConfig,
    private readonly scopeSource: {
      scopeFor(deliveryId: string): ChannelDeliveryScope | undefined;
      leaseTokenFor(deliveryId: string): string | undefined;
    },
  ) {
    this.http = new IntelligenceHttp(cfg);
  }

  async push(frame: RenderFrame): Promise<RenderAccepted> {
    const scope = this.scopeSource.scopeFor(frame.deliveryId);
    if (!scope) {
      throw new Error(
        `intelligenceAdapter: no leased scope for delivery ${frame.deliveryId}`,
      );
    }
    // Fence the render-accept on the delivery's lease token (OSS-446), the same
    // way ack/fail already do. Optional: app-api falls back to instance-id +
    // expiry when it's absent, so an older lease record without a token still
    // renders — but supplying it lets app-api reject a stale/rotated lease.
    const leaseToken = this.scopeSource.leaseTokenFor(frame.deliveryId);
    const idempotencyKey = `${frame.turnId}:${frame.slot}:${frame.seq}`;
    const res = await this.http.post<RenderAcceptedResponse>(
      `/api/channels/deliveries/${encodeURIComponent(frame.deliveryId)}/render-events/accept`,
      {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        channelId: scope.channelId,
        channelName: scope.channelName,
        turnId: frame.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        slot: frame.slot,
        seq: frame.seq,
        idempotencyKey,
        event: frame.event,
        ...(leaseToken ? { leaseToken } : {}),
        sentAt: new Date().toISOString(),
      },
    );
    return {
      idempotencyKey: res.idempotencyKey ?? idempotencyKey,
      acceptance: res.acceptance ?? "accepted",
      ...(res.egressOperationId
        ? { egressOperationId: res.egressOperationId }
        : {}),
    };
  }
}
