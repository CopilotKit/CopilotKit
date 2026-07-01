import { randomUUID } from "node:crypto";
import type {
  DeliverySource,
  EgressSink,
  RenderEventSink,
} from "./transports.js";
import type {
  ManagedIngressEnvelope,
  EgressOperation,
  EgressResult,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";
import { irToText } from "./ir-to-text.js";

/**
 * @internal Default HTTP transports for {@link intelligenceAdapter}.
 *
 * These are the credentialed wire to a running Intelligence app-api: the
 * {@link HttpDeliverySource} polls the listener `claim` route and lease-fences
 * ack/fail; the {@link HttpEgressSink} posts replies to the egress route.
 * `intelligenceAdapter()` builds them by default (config from env), so a
 * consumer only writes `createBot({ adapters: [intelligenceAdapter()] })`.
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
  /** Project-unique bot name; matches `createBot({ name })`. */
  botName: string;
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
 * `COPILOTKIT_API_KEY`, `COPILOTKIT_BOT_NAME`, `COPILOTKIT_RUNTIME_INSTANCE_ID`.
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
  const botName = overrides.botName ?? env["COPILOTKIT_BOT_NAME"];
  const runtimeInstanceId =
    overrides.runtimeInstanceId ??
    env["COPILOTKIT_RUNTIME_INSTANCE_ID"] ??
    `rti_${randomUUID().replace(/-/g, "")}`;
  const adapter = overrides.adapter ?? "slack";

  const missing: string[] = [];
  if (!baseUrl) missing.push("baseUrl (COPILOTKIT_INTELLIGENCE_URL)");
  if (!apiKey) missing.push("apiKey (COPILOTKIT_API_KEY)");
  if (!botName)
    missing.push("botName (createBot({ name }) / COPILOTKIT_BOT_NAME)");
  if (missing.length > 0) {
    throw new Error(
      `intelligenceAdapter: missing required transport config: ${missing.join(", ")}`,
    );
  }

  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    botName: botName!,
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
  new Promise((resolve) => setTimeout(resolve, ms));

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
interface SlackReplyTarget {
  adapter: string;
  teamId: string;
  channel: string;
  threadTs?: string;
}

/** Successful `claim` delivery envelope (subset the bridge reads). */
interface ClaimedDelivery {
  id: string;
  organizationId: string;
  projectId: number;
  bot: { id: string; name: string };
  adapter: string;
  leaseToken: string;
  turn: {
    id: string;
    eventId: string;
    replyTarget: SlackReplyTarget;
    input?: { kind: string; text: string };
  };
}

/** Per-delivery org/project/bot scope, echoed onto render frames. */
export interface DeliveryScope {
  organizationId: string;
  projectId: number;
  botId: string;
  botName: string;
}

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

/** `slack:teamId:channel:thread:threadTs` — stable per Slack thread. */
function conversationKeyFromReplyTarget(rt: SlackReplyTarget): string {
  return `${rt.adapter}:${rt.teamId}:${rt.channel}:thread:${rt.threadTs ?? "root"}`;
}

function mapDeliveryToEnvelope(d: ClaimedDelivery): ManagedIngressEnvelope {
  return {
    kind: "turn",
    deliveryId: d.id,
    eventId: d.turn.eventId,
    turnId: d.turn.id,
    botName: d.bot.name,
    platform: d.adapter,
    conversationKey: conversationKeyFromReplyTarget(d.turn.replyTarget),
    route: d.turn.replyTarget,
    text: d.turn.input?.text ?? "",
  };
}

interface LeaseRecord {
  turnId: string;
  leaseToken: string;
  scope: DeliveryScope;
}

/**
 * @internal {@link DeliverySource} that polls Intelligence's runtime listener
 * routes (heartbeat + claim) and lease-fences ack/fail. One delivery is
 * processed at a time: the claim loop awaits `onDelivery` (which the adapter
 * resolves only after it has called back into `ack`/`nack`).
 */
export class HttpDeliverySource implements DeliverySource {
  private readonly http: IntelligenceHttp;
  private readonly leases = new Map<string, LeaseRecord>();
  private running = false;
  private loop?: Promise<void>;
  private lastHeartbeatAt = 0;

  constructor(private readonly cfg: IntelligenceTransportConfig) {
    this.http = new IntelligenceHttp(cfg);
  }

  private sleep(ms: number): Promise<void> {
    return (this.cfg.sleep ?? defaultSleep)(ms);
  }

  /** Declare this runtime + bot to Intelligence and keep the activation fresh. */
  async heartbeat(): Promise<void> {
    await this.http.post("/api/bots/listener/heartbeat", {
      runtimeInstanceId: this.cfg.runtimeInstanceId,
      declaredBots: [{ botName: this.cfg.botName, adapter: this.cfg.adapter }],
      observedAt: new Date().toISOString(),
    });
    this.lastHeartbeatAt = Date.now();
  }

  /** Claim a single delivery; returns the mapped envelope, or the idle backoff. */
  async claimOnce(): Promise<
    { env: ManagedIngressEnvelope } | { pollAfterMs: number }
  > {
    const res = await this.http.post<ClaimResponse>(
      "/api/bots/listener/claim",
      {
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        adapters: [this.cfg.adapter],
      },
    );
    if (!res.claimed) return { pollAfterMs: res.pollAfterMs ?? 1000 };
    this.leases.set(res.delivery.id, {
      turnId: res.delivery.turn.id,
      leaseToken: res.delivery.leaseToken,
      scope: {
        organizationId: res.delivery.organizationId,
        projectId: res.delivery.projectId,
        botId: res.delivery.bot.id,
        botName: res.delivery.bot.name,
      },
    });
    return { env: mapDeliveryToEnvelope(res.delivery) };
  }

  /** The org/project/bot scope for a leased delivery, for render-frame egress. */
  scopeFor(deliveryId: string): DeliveryScope | undefined {
    return this.leases.get(deliveryId)?.scope;
  }

  async start(
    onDelivery: (env: ManagedIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.running = true;
    await this.heartbeat();
    this.loop = this.runLoop(onDelivery);
  }

  private async runLoop(
    onDelivery: (env: ManagedIngressEnvelope) => Promise<void>,
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
    await this.http.post(
      `/api/bots/deliveries/${encodeURIComponent(deliveryId)}/ack`,
      {
        turnId: lease.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        leaseToken: lease.leaseToken,
        acknowledgedAt: new Date().toISOString(),
      },
    );
    this.leases.delete(deliveryId);
  }

  async nack(deliveryId: string, reason: string): Promise<void> {
    const lease = this.leases.get(deliveryId);
    if (!lease) {
      this.cfg.log?.(`intelligence nack: no lease for delivery ${deliveryId}`);
      return;
    }
    await this.http.post(
      `/api/bots/deliveries/${encodeURIComponent(deliveryId)}/fail`,
      {
        turnId: lease.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        leaseToken: lease.leaseToken,
        failedAt: new Date().toISOString(),
        error: {
          code: "runtime_error",
          message: (reason || "runtime error").slice(0, 500),
          retryable: true,
        },
      },
    );
    this.leases.delete(deliveryId);
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
        "/api/bots/egress/messages",
        {
          botName: this.cfg.botName,
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
 * (`/api/bots/deliveries/:id/render-events/accept`). This is the HTTP-path
 * equivalent of the realtime {@link PhoenixRealtimeTransport}: each frame is
 * POSTed and the durable acceptance receipt is awaited before the next. The
 * gateway-side Connector Outbox then renders the accepted frames to Slack, so
 * this path reaches full reply-UX parity without a running realtime gateway.
 *
 * Per-delivery org/project/bot scope is read from the {@link HttpDeliverySource}
 * that leased the delivery (populated at claim). The `deliveryId` travels in the
 * URL only — the accept route rejects a body that also carries it.
 */
export class HttpRenderEventSink implements RenderEventSink {
  private readonly http: IntelligenceHttp;

  constructor(
    private readonly cfg: IntelligenceTransportConfig,
    private readonly scopeSource: {
      scopeFor(deliveryId: string): DeliveryScope | undefined;
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
    const idempotencyKey = `${frame.turnId}:${frame.slot}:${frame.seq}`;
    const res = await this.http.post<RenderAcceptedResponse>(
      `/api/bots/deliveries/${encodeURIComponent(frame.deliveryId)}/render-events/accept`,
      {
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        botId: scope.botId,
        botName: scope.botName,
        turnId: frame.turnId,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        slot: frame.slot,
        seq: frame.seq,
        idempotencyKey,
        event: frame.event,
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
