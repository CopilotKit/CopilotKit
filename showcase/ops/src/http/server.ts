import { Hono } from "hono";
import type { PbClient } from "../storage/pb-client.js";
import type { Logger } from "../types/index.js";
import type { TypedEventBus } from "../events/event-bus.js";
import { registerDeployWebhook } from "./webhooks/deploy.js";
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
  /** Event bus for webhook emissions. Optional so older callers (tests) don't break. */
  bus?: TypedEventBus;
  /** HMAC secrets for signed webhooks. If unset, webhook routes are not registered. */
  webhookSecrets?: string[];
  /** Metrics registry. When provided, `/metrics` returns Prometheus text. */
  metrics?: MetricsRegistry;
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

  if (deps.metrics) {
    const registry = deps.metrics;
    // NOTE: `/metrics` is intentionally unauthenticated so in-cluster
    // Prometheus scrapers can reach it without credential plumbing. If
    // this service is ever exposed directly to the public internet, this
    // route leaks internal counters (probe cadence, alert volume, HMAC
    // failure rate) and must be locked down (e.g. private network ACL,
    // reverse-proxy basic auth, or token-based auth). Out of scope for
    // v1 which runs behind Railway's private network.
    app.get("/metrics", (c) => {
      const body = renderPrometheus(registry);
      return c.body(body, 200, { "Content-Type": "text/plain; version=0.0.4" });
    });
  }

  app.get("/health", async (c) => {
    const pbOk = await deps.pb.health();
    const ruleCount = deps.ruleCount();
    // Loop-alive semantics:
    //   - If schedulerStarted is supplied, `loop` only reads ok when the
    //     scheduler has actually started AND is not explicitly stopped.
    //     This closes the boot-window honesty gap where the HTTP server
    //     comes up before (or in parallel with) scheduler start.
    //   - If schedulerStarted is not supplied, we fall back to
    //     loopAlive alone (legacy behavior, preserved for tests and
    //     old callers that haven't plumbed the new callback through).
    const alive = deps.loopAlive?.() ?? true;
    const started = deps.schedulerStarted?.() ?? true;
    const loopOk = alive && started;
    const ok = pbOk && loopOk && ruleCount > 0;
    return c.json(
      {
        status: ok ? "ok" : "degraded",
        pb: pbOk ? "ok" : "down",
        loop: loopOk ? "ok" : !started ? "starting" : "stopped",
        rules: ruleCount,
      },
      ok ? 200 : 503,
    );
  });

  return app;
}
