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
   * Defaults to 100. Set to 0 to disable dedupe entirely.
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
  })
  .strict();

/**
 * Bounded LRU of processed runIds for at-least-once → exactly-once
 * idempotency. GitHub Actions retries the deploy-result POST on transient
 * failures (curl retry loop); we must 200 the duplicate rather than
 * re-emit the event. We key on `runId` because each workflow run has a
 * unique id; this naturally tolerates the common "signer retry" path
 * without any coordination with the sender.
 *
 * Bounded to 100 entries by default so the process footprint stays
 * flat under sustained traffic. On overflow we evict the oldest-seen
 * entry (insertion-order) — acceptable since retries always follow the
 * first accepted POST within seconds.
 */
function createRunIdDedupe(capacity: number): {
  seen: (runId: string) => boolean;
  record: (runId: string) => void;
  size: () => number;
} {
  // Use a Map for insertion-order iteration; re-seeing a runId re-inserts
  // it to the tail so frequently-seen ids stay warm.
  const set = new Map<string, true>();
  return {
    seen(runId) {
      if (capacity <= 0) return false;
      return set.has(runId);
    },
    record(runId) {
      if (capacity <= 0) return;
      if (set.has(runId)) {
        set.delete(runId);
        set.set(runId, true);
        return;
      }
      set.set(runId, true);
      while (set.size > capacity) {
        const oldest = set.keys().next().value;
        if (oldest === undefined) break;
        set.delete(oldest);
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
  const dedupe = createRunIdDedupe(deps.dedupeSize ?? 100);

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
      deps.logger.warn("webhook.deploy.invalid-payload", {
        issues: result.error.issues.map(
          (i) => i.path.join(".") + ": " + i.message,
        ),
      });
      deps.metrics?.inc("webhook_rejections", { reason: "invalid-payload" });
      return c.json({ ok: false, reason: "invalid-payload" }, 400);
    }

    // Idempotency: if we've already accepted this runId, return 200 OK
    // without re-emitting. The workflow curl-retry loop will replay the
    // same payload on transient upstream failures; re-emitting would
    // double-count alerts (especially rate-limited ones).
    if (dedupe.seen(result.data.runId)) {
      deps.logger.info("webhook.deploy.duplicate", {
        runId: result.data.runId,
      });
      return c.json({ ok: true, duplicate: true }, 200);
    }

    const event: DeployResultEvent = {
      runId: result.data.runId,
      runUrl: result.data.runUrl,
      services: result.data.services,
      failed: result.data.failed,
      succeeded: result.data.succeeded,
      cancelled: result.data.cancelled,
      gateSkipped: result.data.gateSkipped,
    };
    dedupe.record(result.data.runId);
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
