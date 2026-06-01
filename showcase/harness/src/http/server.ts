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
   * Number of entries currently registered with the scheduler. /health
   * treats zero as a hard 503 — a running HTTP server with no cron jobs
   * means the rule loader silently crashed (or loaded zero rules) and no
   * probes will tick. REQUIRED (fail-loud): the previous optional
   * signature defaulted to "OK by default" when callers forgot to wire
   * the callback, masking exactly the misconfiguration this signal exists
   * to surface. Production wires it in `boot()` (orchestrator.ts); test
   * harnesses must supply a stub (e.g. `() => 1`).
   */
  schedulerJobCount: () => number;
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
  // Fail-loud guard: the type signature already requires
  // `schedulerJobCount`, but callers compiled with looser settings (or
  // dynamic call sites built from `unknown`/`any`) can still pass
  // undefined at runtime. Throwing here is preferable to falling back to
  // a default-OK — that's exactly the misconfiguration that previously
  // shipped /health: 200 with zero cron jobs.
  if (typeof deps.schedulerJobCount !== "function") {
    throw new Error(
      "buildServer: schedulerJobCount callback is required. " +
        "Wire it from the scheduler (e.g. () => scheduler.getJobCount()) " +
        "so /health can fail loud when the rule loader produces zero entries.",
    );
  }

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
    //   - `schedulerJobCount` (REQUIRED): if zero, /health returns 503.
    //     An HTTP server up with no cron entries means the scheduler is
    //     ticking nothing — a silent outage we previously reported as
    //     healthy. Fail-loud: callback is required at the type level and
    //     guarded at boot, so jobCount is always defined here.
    //   - `loopAlive`: legacy flag flipped by orchestrator.stop().
    // Order: stopped > !started > !alive > jobCount==0 > alive.
    const alive = deps.loopAlive?.() ?? true;
    const started = deps.schedulerStarted?.() ?? true;
    const schedulerStopped = deps.schedulerIsStopped?.() ?? false;
    const jobCount = deps.schedulerJobCount();
    const jobCountOk = jobCount > 0;
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
        schedulerJobs: jobCount,
      },
      ok ? 200 : 503,
    );
  });

  return app;
}
