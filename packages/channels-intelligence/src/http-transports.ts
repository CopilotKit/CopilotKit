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
  EgressRoute,
  EgressOperation,
  EgressResult,
  RenderFrame,
  RenderAccepted,
} from "./contracts.js";
import { irToText } from "./ir-to-text.js";
import { mapDeliveryToEnvelope } from "./claim-mapping.js";
import type {
  ClaimedChannelIngressEnvelope,
  ClaimedDelivery,
} from "./claim-mapping.js";
import { IntelligenceFileHistoryClient } from "./intelligence-file-history.js";
import {
  channelTransportError,
  deliveryAttemptFromClaim,
  deliveryAttemptKey,
  effectiveDeliveryTimeoutMs,
  isDeliveryAttemptExpired,
  isRetryableDeliveryError,
  isStrictlyNewerDeliveryAttempt,
  runAttemptTerminalIntent,
  scheduleDeliveryAttemptExpiry,
} from "./delivery-attempt.js";
import type {
  AttemptTerminalState,
  DeliveryAttemptInput,
  DeliveryAttemptRef,
} from "./delivery-attempt.js";

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
  /** Transport-instance id (`rti_…`); generated when omitted. */
  runtimeInstanceId: string;
  /** Adapter kind. First slice is `"slack"`. */
  adapter: string;
  /** Injectable fetch for the JSON claim/heartbeat/egress calls (text-only
   * {@link FetchLike}); defaults to global `fetch`. */
  fetch?: FetchLike;
  /**
   * Injectable binary-capable `fetch` for the file/history client's download,
   * history, and upload calls (needs `.body`/`.arrayBuffer()`/`.headers`/
   * `.json()`, which the text-only {@link FetchLike} above cannot satisfy).
   * Forwarded to {@link IntelligenceFileHistoryClient}; defaults to global
   * `fetch`. Separate knob because the JSON and binary paths need different
   * fetch shapes.
   */
  fileFetch?: typeof fetch;
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
    fileFetch: overrides.fileFetch,
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

/** The claim route's response: an idle-backoff, or a leased delivery to run. */
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
      let reason: unknown = raw.slice(0, 300);
      try {
        reason = raw ? (JSON.parse(raw) as unknown) : reason;
      } catch {
        // Preserve the bounded raw response in the fallback error message.
      }
      throw channelTransportError(
        `intelligence ${path} -> ${res.status}`,
        reason,
        res.status,
      );
    }
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  }
}

interface LeaseRecord extends AttemptTerminalState {
  attempt: DeliveryAttemptRef;
  cancelExpiry?: () => void;
  turnId: string;
  leaseToken: string;
  scope: ChannelDeliveryScope;
}

interface DeliveryLeaseIdentity {
  turnId: string;
  runtimeInstanceId: string;
  leaseToken: string;
}

interface DeliveryLeaseIdentitySource {
  leaseIdentityFor(
    attempt: DeliveryAttemptRef,
  ): DeliveryLeaseIdentity | undefined;
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
  /** Attempt-keyed so a late handler can never resolve through newer state. */
  private readonly leases = new Map<string, LeaseRecord>();
  /** Compatibility/current-attempt index for legacy string callers. */
  private readonly activeAttempts = new Map<string, string>();
  private running = false;
  private loop?: Promise<void>;
  /** Standalone recurring heartbeat timer, independent of the claim loop. */
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  /**
   * Bumped on every {@link start}/{@link stop}. The recurring heartbeat closes
   * over the generation it was scheduled under and stops rescheduling once it
   * no longer matches, so a stop→start restart (which can fire while a prior
   * heartbeat POST is still in flight) cannot leave two reschedule chains
   * running.
   */
  private runGeneration = 0;
  /**
   * Resolves when {@link stop} is called, so an in-flight poll-sleep or an
   * in-flight turn-wait can be interrupted immediately rather than blocking
   * shutdown for up to a cadence (idle) or `turnTimeoutMs` (mid-turn).
   */
  private stopWait?: Promise<void>;
  private resolveStop?: () => void;

  constructor(private readonly cfg: IntelligenceTransportConfig) {
    this.http = new IntelligenceHttp(cfg);
    this.fileHistory = new IntelligenceFileHistoryClient({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      log: cfg.log,
      ...(cfg.fileFetch ? { fetch: cfg.fileFetch } : {}),
    });
  }

  private registerLease(record: LeaseRecord): boolean {
    const key = deliveryAttemptKey(record.attempt);
    if (this.leases.has(key)) {
      this.cfg.log?.("intelligence duplicate delivery attempt ignored", {
        deliveryId: record.attempt.deliveryId,
        attemptCount: record.attempt.attemptCount,
      });
      return false;
    }
    const previousKey = this.activeAttempts.get(record.attempt.deliveryId);
    if (previousKey) {
      const previous = this.leases.get(previousKey);
      if (previous) {
        if (!isStrictlyNewerDeliveryAttempt(record.attempt, previous.attempt)) {
          this.cfg.log?.(
            "intelligence stale/conflicting delivery attempt ignored",
            {
              deliveryId: record.attempt.deliveryId,
              incomingAttemptCount: record.attempt.attemptCount,
              activeAttemptCount: previous.attempt.attemptCount,
            },
          );
          return false;
        }
        this.cleanupLease(previous);
        this.cfg.log?.("intelligence delivery attempt superseded", {
          deliveryId: record.attempt.deliveryId,
          previousAttemptKey: previousKey,
          activeAttemptKey: key,
        });
      }
    }
    this.leases.set(key, record);
    this.activeAttempts.set(record.attempt.deliveryId, key);
    record.cancelExpiry = scheduleDeliveryAttemptExpiry(
      record.attempt,
      () => Date.now(),
      () => {
        if (this.leases.get(key) !== record) return;
        this.cleanupLease(record);
        this.cfg.log?.("intelligence delivery attempt expired", {
          deliveryId: record.attempt.deliveryId,
          attemptCount: record.attempt.attemptCount,
        });
      },
    );
    return true;
  }

  private cleanupLease(record: LeaseRecord): void {
    record.cancelExpiry?.();
    delete record.cancelExpiry;
    const key = deliveryAttemptKey(record.attempt);
    const ownsAttempt = this.leases.get(key) === record;
    if (ownsAttempt) this.leases.delete(key);
    if (
      ownsAttempt &&
      this.activeAttempts.get(record.attempt.deliveryId) === key
    ) {
      this.activeAttempts.delete(record.attempt.deliveryId);
    }
  }

  private resolveLease(
    input: DeliveryAttemptInput,
    operation: string,
  ): LeaseRecord | undefined {
    const deliveryId = typeof input === "string" ? input : input.deliveryId;
    const activeKey = this.activeAttempts.get(deliveryId);
    const requestedKey =
      typeof input === "string" ? activeKey : deliveryAttemptKey(input);
    if (!activeKey) {
      this.cfg.log?.(
        `intelligence ${operation}: no lease for delivery ${deliveryId}`,
      );
      return undefined;
    }
    if (requestedKey !== activeKey) {
      this.cfg.log?.(`intelligence ${operation}: stale attempt ignored`, {
        deliveryId,
        requestedAttemptKey: requestedKey,
        activeAttemptKey: activeKey,
      });
      return undefined;
    }
    const lease = this.leases.get(requestedKey);
    if (!lease) {
      this.cfg.log?.(
        `intelligence ${operation}: no lease for delivery ${deliveryId}`,
      );
      return undefined;
    }
    if (isDeliveryAttemptExpired(lease.attempt, Date.now())) {
      this.cleanupLease(lease);
      this.cfg.log?.(`intelligence ${operation}: expired attempt ignored`, {
        deliveryId,
        attemptCount: lease.attempt.attemptCount,
      });
      return undefined;
    }
    return lease;
  }

  private sleep(ms: number): Promise<void> {
    const base = (this.cfg.sleep ?? defaultSleep)(ms);
    // Interruptible: stop() resolves stopWait so an in-flight poll-sleep ends at
    // once instead of holding shutdown for up to a full cadence.
    return this.stopWait ? Promise.race([base, this.stopWait]) : base;
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
  }

  /** Claim a single delivery; returns the mapped envelope, or the idle backoff. */
  async claimOnce(): Promise<
    { env: ClaimedChannelIngressEnvelope } | { pollAfterMs: number }
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
    let attempt: DeliveryAttemptRef;
    try {
      attempt = deliveryAttemptFromClaim(res.delivery);
    } catch (attemptErr) {
      this.cfg.log?.(
        "intelligence claim: invalid attempt identity; failing non-retryable",
        attemptErr,
      );
      await this.failClaimWithoutAttempt(res.delivery, attemptErr).catch(
        (failErr) =>
          this.cfg.log?.(
            "intelligence fail after invalid attempt identity failed",
            failErr,
          ),
      );
      return { pollAfterMs: 1000 };
    }
    const registered = this.registerLease({
      attempt,
      turnId: res.delivery.turn.id,
      leaseToken: res.delivery.leaseToken,
      scope: {
        organizationId: res.delivery.organizationId,
        projectId: res.delivery.projectId,
        channelId: res.delivery.channel.id,
        channelName: res.delivery.channel.name,
      },
    });
    if (!registered) return { pollAfterMs: 1000 };
    try {
      return { env: mapDeliveryToEnvelope(res.delivery) };
    } catch (mapErr) {
      // An unmappable/unknown delivery kind must fail loud, but must not wedge
      // the single-delivery loop: the lease is already recorded, so nack it
      // here (non-retryable — re-mapping the same payload fails identically, so
      // let app-api dead-letter it rather than burn retries) and fall through to
      // an idle poll so the loop keeps draining the queue. Without this the
      // throw escapes to runLoop's catch, which only logs+sleeps, leaking the
      // lease until expiry redelivers the same poison payload forever.
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

  private async failClaimWithoutAttempt(
    delivery: ClaimedDelivery,
    reason: unknown,
  ): Promise<void> {
    await this.http.post(
      `/api/channels/deliveries/${encodeURIComponent(delivery.id)}/fail`,
      {
        turnId: delivery.turn.id,
        runtimeInstanceId: this.cfg.runtimeInstanceId,
        leaseToken: delivery.leaseToken,
        failedAt: new Date().toISOString(),
        error: {
          code: "runtime_error",
          message: (reason instanceof Error
            ? reason.message
            : String(reason)
          ).slice(0, 500),
          retryable: false,
        },
      },
    );
  }

  /** The org/project/channel scope for a leased delivery, for render-frame egress. */
  scopeFor(attempt: DeliveryAttemptInput): ChannelDeliveryScope | undefined {
    return this.resolveLease(attempt, "render")?.scope;
  }

  /** The lease token for a leased delivery, so a render frame can fence its
   * accept against `lease_token_hash` the same way ack/fail already do. */
  leaseTokenFor(attempt: DeliveryAttemptInput): string | undefined {
    return this.resolveLease(attempt, "render")?.leaseToken;
  }

  /** Exact live lease identity for attempt-fenced direct HTTP egress. */
  leaseIdentityFor(
    attempt: DeliveryAttemptRef,
  ): DeliveryLeaseIdentity | undefined {
    const lease = this.resolveLease(attempt, "egress");
    return lease
      ? {
          turnId: lease.turnId,
          runtimeInstanceId: this.cfg.runtimeInstanceId,
          leaseToken: lease.leaseToken,
        }
      : undefined;
  }

  async start(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    this.running = true;
    const generation = ++this.runGeneration;
    this.stopWait = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });
    await this.heartbeat();
    this.scheduleHeartbeat(generation);
    this.loop = this.runLoop(onDelivery);
  }

  /**
   * Keep the activation fresh on a standalone recurring timer, independent of
   * the claim loop. The loop blocks on `onDelivery` for up to `turnTimeoutMs`
   * (120s) during a turn; heartbeating only at the top of the loop meant a turn
   * longer than the cadence sent no heartbeat for its whole duration, so app-api
   * could mark a healthily-working runtime stale mid-turn and withhold new
   * deliveries. This timer heartbeats on cadence regardless of what the loop is
   * doing, rescheduling only after each heartbeat settles (no overlap).
   */
  private scheduleHeartbeat(generation: number): void {
    const cadence = this.cfg.heartbeatIntervalMs ?? 15000;
    const timer = setTimeout(() => {
      // Only this run's chain may fire/reschedule. A stop→start restart bumps
      // runGeneration, so an orphaned chain (or a reschedule queued behind an
      // in-flight heartbeat POST from the previous run) self-terminates instead
      // of doubling the heartbeat rate.
      if (!this.running || generation !== this.runGeneration) return;
      this.heartbeat()
        .catch((err) => this.cfg.log?.("intelligence heartbeat failed", err))
        .finally(() => {
          if (this.running && generation === this.runGeneration) {
            this.scheduleHeartbeat(generation);
          }
        });
    }, cadence);
    // Don't hold the event loop open (parity with the poll-sleep timers).
    (timer as unknown as { unref?: () => void }).unref?.();
    this.heartbeatTimer = timer;
  }

  private async runLoop(
    onDelivery: (env: ChannelIngressEnvelope) => Promise<void>,
  ): Promise<void> {
    const cadence = this.cfg.heartbeatIntervalMs ?? 15000;
    while (this.running) {
      try {
        const r = await this.claimOnce();
        if ("env" in r) {
          // The adapter dispatches the turn and calls back into ack/nack
          // before this resolves — at-least-once, one delivery at a time.
          // Bound it: a turn that throws or hangs must not wedge the loop, so
          // we time it out, `nack` to release the lease immediately (app-api
          // then retries / dead-letters at max_attempts), and keep polling.
          const env = r.env;
          const configuredTimeoutMs =
            this.cfg.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
          const timeoutMs = effectiveDeliveryTimeoutMs(
            configuredTimeoutMs,
            env.deliveryAttempt,
            Date.now(),
          );
          if (timeoutMs <= 0) {
            const reason =
              `turn ${env.turnId} cannot start inside the delivery lease ` +
              "safety margin";
            this.cfg.log?.("intelligence turn skipped near lease expiry", {
              deliveryId: env.deliveryId,
              attemptCount: env.deliveryAttempt.attemptCount,
              leaseExpiresAt: env.deliveryAttempt.leaseExpiresAt,
            });
            await this.nack(env.deliveryAttempt, reason).catch((nackErr) =>
              this.cfg.log?.(
                "intelligence nack after lease-margin skip failed",
                nackErr,
              ),
            );
            continue;
          }
          // Always attach a terminal handler so a turn that rejects AFTER we've
          // stopped (below) never surfaces as an unhandled rejection.
          const settled = withTimeout(
            onDelivery(env),
            timeoutMs,
            `turn ${env.turnId} exceeded ${timeoutMs}ms`,
          ).then(
            () => ({ ok: true }) as const,
            (err: unknown) => ({ ok: false, err }) as const,
          );
          // Race the turn against stop(): shutting down must not block for up to
          // turnTimeoutMs waiting on an in-flight turn.
          const outcome = this.stopWait
            ? await Promise.race([
                settled,
                this.stopWait.then(() => "stopped" as const),
              ])
            : await settled;
          if (outcome === "stopped") {
            // Leave the lease — app-api re-leases after expiry. Do NOT nack: the
            // turn didn't fail, we're stopping.
            break;
          }
          if (!outcome.ok) {
            this.cfg.log?.("intelligence turn failed/timed out", outcome.err);
            await this.nack(
              env.deliveryAttempt,
              outcome.err instanceof Error
                ? outcome.err.message
                : String(outcome.err),
              isRetryableDeliveryError(outcome.err),
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

  async ack(attempt: DeliveryAttemptInput): Promise<void> {
    const lease = this.resolveLease(attempt, "ack");
    if (!lease) return;
    const payload = {
      turnId: lease.turnId,
      runtimeInstanceId: this.cfg.runtimeInstanceId,
      leaseToken: lease.leaseToken,
      acknowledgedAt: new Date().toISOString(),
    };
    await runAttemptTerminalIntent(
      lease,
      "complete",
      () =>
        this.http.post(
          `/api/channels/deliveries/${encodeURIComponent(lease.attempt.deliveryId)}/ack`,
          payload,
        ),
      () => this.cleanupLease(lease),
      this.cfg.log,
    );
  }

  async nack(
    attempt: DeliveryAttemptInput,
    reason: string,
    retryable = true,
  ): Promise<void> {
    const lease = this.resolveLease(attempt, "nack");
    if (!lease) return;
    const payload = {
      turnId: lease.turnId,
      runtimeInstanceId: this.cfg.runtimeInstanceId,
      leaseToken: lease.leaseToken,
      failedAt: new Date().toISOString(),
      error: {
        code: "runtime_error",
        message: (reason || "runtime error").slice(0, 500),
        retryable,
      },
    };
    await runAttemptTerminalIntent(
      lease,
      "fail",
      () =>
        this.http.post(
          `/api/channels/deliveries/${encodeURIComponent(lease.attempt.deliveryId)}/fail`,
          payload,
        ),
      () => this.cleanupLease(lease),
      this.cfg.log,
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
    // Invalidate the current run's heartbeat chain so any reschedule queued
    // behind an in-flight heartbeat POST does not re-arm after we stop.
    this.runGeneration += 1;
    // Interrupt any in-flight poll-sleep or turn-wait so shutdown is prompt.
    this.resolveStop?.();
    if (this.heartbeatTimer !== undefined) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    await this.loop?.catch(() => {});
    for (const lease of this.leases.values()) lease.cancelExpiry?.();
    this.leases.clear();
    this.activeAttempts.clear();
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

  constructor(
    private readonly cfg: IntelligenceTransportConfig,
    private readonly leaseSource?: DeliveryLeaseIdentitySource,
  ) {
    this.http = new IntelligenceHttp(cfg);
  }

  async emit(op: EgressOperation): Promise<EgressResult> {
    // First slice: Intelligence egress is post-only. A delete has no remote
    // message to remove; ack it as a no-op so the run isn't treated as failed.
    if (op.op.kind === "delete") return { ok: true, ref: op.operationId };

    const text = irToText(op.op.ir);
    // Intelligence requires non-empty text. An empty POST is a legitimate no-op
    // (nothing to say). An empty UPDATE is a real intent (e.g. clearing a
    // message body) this post-only fallback egress cannot express — but failing
    // it would throw up the run path and nack+retry the WHOLE turn to
    // dead-letter (re-running valid work) for a condition a retry can't fix. So
    // skip it as a no-op too, but log it loudly so it is surfaced, not silent.
    if (!text) {
      if (op.op.kind === "update") {
        this.cfg.log?.(
          "intelligence egress: skipping empty-text update (post-only fallback cannot clear a message)",
          { operationId: op.operationId, deliveryId: op.deliveryId },
        );
      }
      return { ok: true, ref: op.operationId };
    }

    // Derive the adapter from the delivery's own reply route, not the static
    // config default. One provider-agnostic runtime serves every adapter the
    // bot has attached (Slack, Teams, ...); posting `this.cfg.adapter` (default
    // "slack") on a Teams delivery is contradictory with its Teams replyTarget.
    // app-api routes on `replyTarget.adapter` + `channelName` and ignores this
    // top-level field, but keep it consistent rather than misleading. Fall back
    // to the config adapter when the route carries none.
    const routeAdapter = (op.route as { adapter?: string } | null | undefined)
      ?.adapter;
    let attemptCredentials:
      | {
          turnId: string;
          runtimeInstanceId: string;
          leaseToken: string;
        }
      | undefined;
    if (op.deliveryAttempt) {
      const lease =
        op.deliveryAttempt.deliveryId === op.deliveryId
          ? this.leaseSource?.leaseIdentityFor(op.deliveryAttempt)
          : undefined;
      if (!lease || lease.turnId !== op.turnId) {
        this.cfg.log?.(
          "intelligence egress: exact delivery attempt unavailable",
          {
            deliveryId: op.deliveryId,
            attemptCount: op.deliveryAttempt.attemptCount,
          },
        );
        return { ok: false, code: "delivery_attempt_unavailable" };
      }
      attemptCredentials = {
        turnId: op.turnId,
        runtimeInstanceId: lease.runtimeInstanceId,
        leaseToken: lease.leaseToken,
      };
    }
    try {
      const res = await this.http.post<EgressResponse>(
        "/api/channels/egress/messages",
        {
          channelName: this.cfg.channelName,
          adapter: routeAdapter ?? this.cfg.adapter,
          deliveryId: op.deliveryId,
          idempotencyKey: op.operationId,
          replyTarget: op.route,
          text,
          ...attemptCredentials,
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
      scopeFor(attempt: DeliveryAttemptInput): ChannelDeliveryScope | undefined;
      leaseTokenFor(attempt: DeliveryAttemptInput): string | undefined;
    },
  ) {
    this.http = new IntelligenceHttp(cfg);
  }

  async push(frame: RenderFrame): Promise<RenderAccepted> {
    const attempt = frame.deliveryAttempt ?? frame.deliveryId;
    const scope = this.scopeSource.scopeFor(attempt);
    if (!scope) {
      throw new Error(
        frame.deliveryAttempt
          ? `intelligenceAdapter: stale delivery attempt cannot render for ${frame.deliveryId}`
          : `intelligenceAdapter: no leased scope for delivery ${frame.deliveryId}`,
      );
    }
    // Fence the render-accept on the delivery's lease token (OSS-446), the same
    // way ack/fail already do. Optional: app-api falls back to instance-id +
    // expiry when it's absent, so an older lease record without a token still
    // renders — but supplying it lets app-api reject a stale/rotated lease.
    const leaseToken = this.scopeSource.leaseTokenFor(attempt);
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
