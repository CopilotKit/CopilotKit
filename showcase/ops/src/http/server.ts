import { Hono } from "hono";
import type { PbClient } from "../storage/pb-client.js";
import type { Logger } from "../types/index.js";
import type { TypedEventBus } from "../events/event-bus.js";
import { registerDeployWebhook } from "./webhooks/deploy.js";
import { registerProbesRoutes, type ProbesRouteDeps } from "./probes.js";
import { renderPrometheus, type MetricsRegistry } from "./metrics.js";

export interface ServerDeps {
  pb: PbClient;
  logger: Logger;
  ruleCount: () => number;
  /**
   * Historically exposed as `loop: ok|stopped` on /health, but the flag
   * only reflected whether `orchestrator.stop()` had been called — it
   * never reflected actual scheduler/probe-loop liveness. Kept as an
   * optional knob for backwards compatibility; when absent the /health
   * response omits the `loop` field rather than lying about it.
   */
  loopAlive?: () => boolean;
  /**
   * Callback returning `true` once the scheduler has been started and is
   * actively running. When supplied, /health's `loop` field reflects
   * `schedulerStarted && loopAlive` instead of the weaker `loopAlive`
   * alone — this prevents the endpoint reporting `loop: ok` during the
   * narrow boot window between server-listen and scheduler-start where a
   * crashed scheduler otherwise stays invisible.
   */
  schedulerStarted?: () => boolean;
  /**
   * Number of entries currently registered with the scheduler. When
   * supplied, /health treats zero as a hard 503 — a running HTTP server
   * with no cron jobs means the rule loader silently crashed (or loaded
   * zero rules) and no probes will tick. Without this callback the
   * endpoint still reports 200 in that pathological state.
   */
  schedulerJobCount?: () => number;
  /**
   * `true` once `scheduler.stop()` has completed. When supplied, /health
   * returns 503 with `loop: "stopped"` rather than relying on the weaker
   * `loopAlive` signal alone, which closes the post-shutdown window
   * where /health can otherwise report healthy for a few seconds after
   * stop() is called.
   */
  schedulerIsStopped?: () => boolean;
  /** Event bus for webhook emissions. Optional so older callers (tests) don't break. */
  bus?: TypedEventBus;
  /** HMAC secrets for signed webhooks. If unset, webhook routes are not registered. */
  webhookSecrets?: string[];
  /** Metrics registry. When provided, `/metrics` returns Prometheus text. */
  metrics?: MetricsRegistry;
  /**
   * Optional `/api/probes` wiring. When supplied, the three probe routes
   * (list / detail / trigger) are mounted; absent, the routes return
   * Hono's default 404 so older test setups that only need `/health`
   * don't have to thread the full scheduler through. The orchestrator
   * always supplies this in production.
   */
  probes?: ProbesRouteDeps;
}

export function buildServer(deps: ServerDeps): Hono {
  const app = new Hono();

  if (deps.bus && deps.webhookSecrets && deps.webhookSecrets.length > 0) {
    registerDeployWebhook(app, {
      bus: deps.bus,
      logger: deps.logger,
      secrets: deps.webhookSecrets,
      metrics: deps.metrics,
    });
  }

  if (deps.probes) {
    registerProbesRoutes(app, deps.probes);
  }

  if (deps.metrics) {
    const registry = deps.metrics;
    // NOTE: `/metrics` is intentionally unauthenticated so in-cluster
    // Prometheus scrapers can reach it without credential plumbing. If
    // this service is ever exposed directly to the public internet, this
    // route leaks internal counters (probe cadence, alert volume, HMAC
    // failure rate) and must be locked down (e.g. private network ACL,
    // reverse-proxy basic auth, or token-based auth). Tracked as a
    // hardening item post-v1 rather than a default; until then, operators
    // must keep this service behind Railway's private network.
    app.get("/metrics", (c) => {
      const body = renderPrometheus(registry);
      return c.body(body, 200, { "Content-Type": "text/plain; version=0.0.4" });
    });
  }

  app.get("/health", async (c) => {
    const pbOk = await deps.pb.health();
    const ruleCount = deps.ruleCount();
    // Loop-alive semantics:
    //   - `schedulerStarted` (optional): true once start() returned.
    //   - `schedulerIsStopped` (optional): true once stop() completed —
    //     takes priority over `loopAlive` so post-shutdown responses are
    //     accurate.
    //   - `schedulerJobCount` (optional): if supplied AND zero, /health
    //     returns 503. An HTTP server up with no cron entries means the
    //     scheduler is ticking nothing — a silent outage we previously
    //     reported as healthy.
    //   - `loopAlive`: legacy flag flipped by orchestrator.stop().
    // Order: stopped > !started > !alive > jobCount==0 > alive.
    const alive = deps.loopAlive?.() ?? true;
    const started = deps.schedulerStarted?.() ?? true;
    const schedulerStopped = deps.schedulerIsStopped?.() ?? false;
    const jobCount = deps.schedulerJobCount?.();
    const jobCountOk = jobCount === undefined ? true : jobCount > 0;
    const loopOk = !schedulerStopped && started && alive && jobCountOk;
    const loopLabel = schedulerStopped
      ? "stopped"
      : !started
        ? "starting"
        : !alive
          ? "stopped"
          : !jobCountOk
            ? "no-jobs"
            : "ok";
    const ok = pbOk && loopOk && ruleCount > 0;
    return c.json(
      {
        status: ok ? "ok" : "degraded",
        pb: pbOk ? "ok" : "down",
        loop: loopLabel,
        rules: ruleCount,
        ...(jobCount !== undefined ? { schedulerJobs: jobCount } : {}),
      },
      ok ? 200 : 503,
    );
  });

  return app;
}
