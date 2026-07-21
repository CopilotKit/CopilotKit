import { Hono } from "hono";
import type { PbClient } from "../storage/pb-client.js";
import type { Logger } from "../types/index.js";
import type { TypedEventBus } from "../events/event-bus.js";
import type { HarnessRole } from "../fleet/role-config.js";
import { registerDeployWebhook } from "./webhooks/deploy.js";
import { registerProbesRoutes } from "./probes.js";
import type { ProbesRouteDeps } from "./probes.js";
import { registerFleetRunsRoutes } from "./fleet-runs.js";
import type { FleetRunsRouteDeps } from "./fleet-runs.js";
import { registerMatrixRoute } from "./matrix.js";
import { renderPrometheus } from "./metrics.js";
import type { MetricsRegistry } from "./metrics.js";

export interface ServerDeps {
  pb: PbClient;
  logger: Logger;
  /**
   * Service role this /health surface represents. Defaults to "worker"
   * (the legacy in-process harness), for which probe rules are the unit of
   * work — so /health requires `ruleCount > 0` (a running server with zero
   * rules means the rule loader silently failed). The "control-plane" role
   * is a scheduler/queue/aggregator that legitimately owns NO probe rules
   * (only the single fleet-job-producer scheduler entry), so for it the
   * `rules > 0` gate is dropped — liveness is governed by pb + the scheduler
   * signals (`schedulerJobCount`, `schedulerStarted`, `loopAlive`) instead.
   * Without this, the control-plane container reports degraded/503 forever
   * (rules is always 0) and Railway restart-loops it.
   *
   * Typed via the `HarnessRole` SSOT (fleet/role-config.ts) so a future role
   * addition flows here automatically rather than drifting from an inline
   * literal union.
   */
  role?: HarnessRole;
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
  /**
   * Optional `/api/runs*` wiring (§5.2). Optional at the TYPE level only
   * because worker-role/boot callers omit it — the CP role ALWAYS supplies
   * it, and unlike `probes` there is deliberately NO token coupling: the
   * fleet-runs router has no mutating route, so the §5.2 unconditional-mount
   * guarantee is enforced at the orchestrator's CP call site.
   */
  fleetRuns?: FleetRunsRouteDeps;
  /**
   * §9 compensating control: when supplied, /health gains
   * `fleetRuns.lastEvaluatedAt` — the family-silence monitor's evaluation
   * stamp (ISO, or null before the first evaluation) — so an external poll
   * of the already-exposed health surface can detect a wedged monitor.
   */
  fleetRunsLastEvaluatedAt?: () => number | null;
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

  if (deps.fleetRuns) {
    registerFleetRunsRoutes(app, deps.fleetRuns);
  }

  // §11 read-model: GET /api/matrix returns the true per-cell chip state as
  // JSON off the SAME buildCellModel engine the dashboard renders. Registered
  // unconditionally — it is a pure read over `pb` (always on ServerDeps) with
  // no mutating route, matching /api/runs' exposure posture (§11.7).
  registerMatrixRoute(app, { pb: deps.pb, logger: deps.logger });

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
    // Guard the PB probe: `pb.health()` REJECTING (vs resolving `false`) must
    // still fold into the `pb: "down"` / 503 degraded JSON contract below —
    // an unguarded throw would surface as a bare 500 with no body, defeating
    // the structured-degradation contract a consumer polls for.
    let pbOk: boolean;
    try {
      pbOk = await deps.pb.health();
    } catch (err) {
      deps.logger.error("health.pb-check-failed", { error: String(err) });
      pbOk = false;
    }
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
    // Role-aware rules gate: the worker (default) role treats probe rules as
    // its unit of work, so zero rules is a hard 503 (rule-loader crashed).
    // The control-plane owns no probe rules — its liveness is the scheduler
    // signals already folded into `loopOk` (schedulerJobCount>0 covers the
    // fleet-job-producer entry) — so it must not require rules>0, or it would
    // report degraded forever and Railway would restart-loop it.
    const rulesOk = deps.role === "control-plane" ? true : ruleCount > 0;
    const ok = pbOk && loopOk && rulesOk;
    // §9 compensating control: surface the family-silence monitor's
    // evaluation stamp so "CP alive but monitor wedged" is externally
    // detectable. Informational only — never folds into the status gate.
    let fleetRuns: { lastEvaluatedAt: string | null } | undefined;
    if (deps.fleetRunsLastEvaluatedAt) {
      const evaluatedAtMs = deps.fleetRunsLastEvaluatedAt();
      fleetRuns = {
        lastEvaluatedAt:
          evaluatedAtMs === null ? null : new Date(evaluatedAtMs).toISOString(),
      };
    }
    return c.json(
      {
        status: ok ? "ok" : "degraded",
        pb: pbOk ? "ok" : "down",
        loop: loopLabel,
        rules: ruleCount,
        schedulerJobs: jobCount,
        ...(fleetRuns ? { fleetRuns } : {}),
      },
      ok ? 200 : 503,
    );
  });

  return app;
}
