import crypto from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { verifyHmac } from "../hmac.js";
import type { MetricsRegistry } from "../metrics.js";
import type {
  TypedEventBus,
  DeployResultEvent,
} from "../../events/event-bus.js";
import type { Logger } from "../../types/index.js";

export interface DeployWebhookDeps {
  bus: TypedEventBus;
  logger: Logger;
  /** Ordered list of HMAC secrets; first is primary, rest enable rotation. */
  secrets: string[];
  /** Allowed clock skew in seconds (default 300). */
  maxSkewSec?: number;
  /** Override for tests. */
  nowSec?: () => number;
  /** Optional metrics registry — when provided, webhook_rejections is incremented for every rejection. */
  metrics?: MetricsRegistry;
  /**
   * Canonical path used when verifying HMAC signatures. Defaults to the
   * literal route path (`/webhooks/deploy`). Override when the service is
   * mounted behind a prefix (e.g. Railway proxy) and the sender signs the
   * externally-visible path rather than whatever Hono sees internally.
   * Must match what the workflow signer uses.
   */
  webhookPath?: string;
  /**
   * Max number of recently-processed runIds remembered for idempotency.
   * Defaults to 500 (raised from 100 to absorb 17-service × 2-retry ×
   * burst-day traffic without LRU churn). Set to 0 to disable dedupe
   * entirely.
   */
  dedupeSize?: number;
}

const deployPayloadSchema = z
  .object({
    runId: z.string().min(1),
    runUrl: z
      .string()
      .url()
      // Reject `javascript:`, `data:`, `file:`, etc. The field ends up
      // rendered as a link in Slack / dashboard UIs; a signed sender
      // with a typo (or compromised secret) should not be able to
      // trick downstream consumers into clicking a script URL.
      .refine((u) => /^https?:\/\//i.test(u), {
        message: "runUrl must be http(s)",
      })
      .optional(),
    services: z.array(z.string()),
    failed: z.array(z.string()),
    succeeded: z.array(z.string()),
    cancelled: z.boolean(),
    // `gateSkipped: true` means the workflow reached the report job but
    // the build matrix never ran (e.g. lockfile gate failed). Treated as a
    // distinct signal downstream from an all-services failure.
    gateSkipped: z.boolean().optional(),
    // Optional free-form discriminator co-emitted with `gateSkipped: true`
    // (`lockfile-failed`, `lockfile-cancelled`, `verify-image-refs-failed`,
    // `verify-image-refs-cancelled`, `detect-changes-<result>`). The
    // alert template uses this to render a reason-specific message instead
    // of a generic "gate skipped" line. Empty string accepted so the
    // workflow can always pass the jq `--arg gateReason` shape without
    // branching on presence.
    gateReason: z.string().optional(),
  })
  .strict();

/**
 * Bounded LRU of processed deploy-webhook requests for at-least-once →
 * exactly-once idempotency. GitHub Actions retries the deploy-result POST
 * on transient failures (curl retry loop); we must 200 the duplicate
 * rather than re-emit the event.
 *
 * Dedupe key is `runId + ":" + sha256(body)` (composite). runId is the
 * primary identity — each workflow run has a unique id and a retried
 * POST carries an identical body, so the natural retry path still
 * collapses to a single event. The bodySha suffix is defense-in-depth
 * against two edge cases:
 *   1. Fork/re-run races that reuse a runId: GitHub Actions re-runs
 *      preserve runId, and a malicious or accidental signer could replay
 *      a runId with a different payload; we want that to re-emit, not
 *      silently dedupe.
 *   2. Collisions on short numeric runIds if a sender is ever replaced
 *      by a different workflow/infra (future-proofing).
 *
 * Bounded to 500 entries by default so the process footprint stays flat
 * under sustained traffic while comfortably absorbing a day of bursts:
 * 17 services × 2 retries × daily deploys leaves ample headroom. On
 * overflow we evict the oldest-seen entry (insertion-order) and log at
 * warn — if evictions start appearing, raise the cap or back with PB.
 *
 * `record` also touches on re-insert so repeatedly-seen ids stay warm
 * (keeps the LRU semantics described in the class name honest — the
 * previous implementation only ever inserted on first-seen).
 */
function createRunIdDedupe(
  capacity: number,
  logger: Logger,
): {
  seen: (key: string) => boolean;
  record: (key: string) => void;
  size: () => number;
} {
  // Use a Map for insertion-order iteration; re-seeing a runId re-inserts
  // it to the tail so frequently-seen ids stay warm.
  const set = new Map<string, true>();
  let evictionsReported = 0;
  return {
    seen(key) {
      if (capacity <= 0) return false;
      // Touch on read: promote to tail so frequently-seen keys survive
      // eviction pressure. The prior comment claimed this behavior but
      // the implementation only touched on `record()` (first-seen), so
      // the LRU guarantee was false.
      if (set.has(key)) {
        set.delete(key);
        set.set(key, true);
        return true;
      }
      return false;
    },
    record(key) {
      if (capacity <= 0) return;
      if (set.has(key)) {
        set.delete(key);
        set.set(key, true);
        return;
      }
      set.set(key, true);
      while (set.size > capacity) {
        const oldest = set.keys().next().value;
        if (oldest === undefined) break;
        set.delete(oldest);
        evictionsReported += 1;
        // Log every eviction at warn — these should be rare. If they
        // aren't, operators raise the cap or swap to PB-backed storage
        // (indexed by runId with a TTL) so evictions can't create
        // duplicate status.changed emissions across retry windows.
        logger.warn("webhook.deploy.dedupe-eviction", {
          evicted: oldest,
          totalEvictions: evictionsReported,
          capacity,
        });
      }
    },
    size() {
      return set.size;
    },
  };
}

export function registerDeployWebhook(
  app: Hono,
  deps: DeployWebhookDeps,
): void {
  const route = "/webhooks/deploy";
  const signedPath = deps.webhookPath ?? route;
  const dedupe = createRunIdDedupe(deps.dedupeSize ?? 500, deps.logger);

  app.post(route, async (c) => {
    const timestamp = c.req.header("x-ops-timestamp") ?? "";
    const signatureHeader = c.req.header("x-ops-signature") ?? "";
    const raw = await c.req.text();

    const verify = verifyHmac({
      method: "POST",
      // Use the configured canonical path. Defaults to the route constant,
      // but callers can override when this service is mounted behind a
      // proxy prefix and the sender signs a different path. The matching
      // signer in .github/workflows/showcase_deploy.yml must stay in
      // lockstep — if the route is renamed there, update the default here.
      path: signedPath,
      timestamp,
      body: raw,
      signatureHeader,
      secrets: deps.secrets,
      maxSkewSec: deps.maxSkewSec,
      nowSec: deps.nowSec,
      logger: deps.logger,
    });

    if (!verify.ok) {
      deps.logger.warn("webhook.deploy.reject", { reason: verify.reason });
      deps.metrics?.inc("webhook_rejections", {
        reason: verify.reason ?? "unknown",
      });
      return c.json({ ok: false, reason: verify.reason }, 401);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      // Surface a short body preview so an operator can correlate a
      // misbehaving sender without exposing a full payload (which may
      // contain signed-but-malformed content).
      const preview = raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
      deps.logger.warn("webhook.deploy.invalid-json", {
        err: String(err),
        bytes: raw.length,
        preview,
      });
      deps.metrics?.inc("webhook_rejections", { reason: "invalid-json" });
      return c.json({ ok: false, reason: "invalid-json" }, 400);
    }

    const result = deployPayloadSchema.safeParse(parsed);
    if (!result.success) {
      const flattened = result.error.flatten();
      // Server-to-server call: include the zod flatten so operators
      // grepping the workflow run can see exactly which field failed
      // validation without reading the ops service log.
      deps.logger.error("webhook.deploy.invalid-payload", {
        issues: result.error.issues.map(
          (i) => i.path.join(".") + ": " + i.message,
        ),
        flattened,
      });
      deps.metrics?.inc("webhook_rejections", { reason: "invalid-payload" });
      return c.json(
        { ok: false, reason: "invalid-payload", errors: flattened },
        400,
      );
    }

    // Idempotency: if we've already accepted this composite key, return
    // 200 OK without re-emitting. Key = `runId + ":" + sha256(body)` —
    // the natural retry path (same runId + same body) still collapses to
    // one event, while a runId replayed with a different payload (fork /
    // re-run races, manual re-post with tweaked services) correctly
    // falls through as a fresh event rather than being silently dropped.
    // The workflow curl-retry loop will replay the same payload on
    // transient upstream failures; re-emitting would double-count alerts
    // (especially rate-limited ones). We check AND record inside the
    // same synchronous block BEFORE emitting so two concurrent POSTs for
    // the same key can't both slip past `seen()` and produce duplicate
    // `deploy.result` events — GitHub Actions retries are serial today
    // but the handler is racy in principle and an infra change could
    // expose it.
    const bodySha = crypto.createHash("sha256").update(raw).digest("hex");
    const dedupeKey = `${result.data.runId}:${bodySha}`;
    if (dedupe.seen(dedupeKey)) {
      deps.logger.info("webhook.deploy.duplicate", {
        runId: result.data.runId,
        bodySha,
      });
      return c.json({ ok: true, duplicate: true }, 200);
    }
    // Record BEFORE emit so a concurrent request for the same key lands
    // on the "seen" branch rather than racing through emit.
    dedupe.record(dedupeKey);

    // Workflow emits `--arg gateReason "$GATE_REASON"` unconditionally, so
    // a gate-inactive run sends the empty string. Normalise to undefined
    // here so downstream probe + template code only has to guard
    // `gateReason !== undefined`, not `gateReason && gateReason !== ""`.
    const gateReason =
      typeof result.data.gateReason === "string" &&
      result.data.gateReason.length > 0
        ? result.data.gateReason
        : undefined;
    const event: DeployResultEvent = {
      runId: result.data.runId,
      runUrl: result.data.runUrl,
      services: result.data.services,
      failed: result.data.failed,
      succeeded: result.data.succeeded,
      cancelled: result.data.cancelled,
      gateSkipped: result.data.gateSkipped,
      gateReason,
    };
    deps.bus.emit("deploy.result", event);
    deps.logger.info("webhook.deploy.accepted", {
      runId: event.runId,
      services: event.services.length,
      failed: event.failed.length,
      cancelled: event.cancelled,
      gateSkipped: event.gateSkipped ?? false,
    });
    return c.json({ ok: true }, 202);
  });
}
