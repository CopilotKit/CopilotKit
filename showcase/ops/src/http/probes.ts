import type { Hono } from "hono";
import { bearerAuth } from "./auth.js";
import type {
  EntryStatus,
  ProbeRunTracker,
  Scheduler,
} from "../scheduler/scheduler.js";
import { InflightConflictError } from "../scheduler/scheduler.js";
import type {
  ProbeRunSnapshot,
  ProbeServiceProgress,
} from "../probes/run-tracker.js";
import type { ProbeRunWriter } from "../probes/run-history.js";
import type { ProbeConfig } from "../probes/loader/schema.js";

/**
 * Window during which a successful trigger() blocks any further trigger
 * for the same probe id. Held in-memory per process — sufficient for
 * showcase-ops's single-instance deployment; if the service ever scales
 * horizontally this needs to move to PB.
 */
export const TRIGGER_RATE_LIMIT_MS = 5 * 60 * 1000;

/**
 * Dependencies for the /api/probes router. Wired by `buildServer` (and
 * therefore the orchestrator) so the route layer never reaches into a
 * module-scoped scheduler / writer / config table.
 *
 * `getProbeConfig` returns the loaded ProbeConfig for an id, or undefined
 * if not loaded. The route uses it to surface `config.timeout_ms`,
 * `config.max_concurrency`, and `config.discovery` in the response —
 * scheduler entries don't carry that shape, so the orchestrator passes a
 * Map-backed lookup that mirrors the loader output.
 *
 * `triggerToken`, when supplied, is propagated into `bearerAuth` so the
 * trigger endpoint can be locked down without leaking the env-var-name
 * convention into every handler. When absent the route refuses to wire
 * the trigger endpoint at construction time (fail-loud) so a misconfigured
 * boot can't accidentally expose an unauthenticated trigger.
 */
export interface ProbesRouteDeps {
  scheduler: Scheduler;
  writer: ProbeRunWriter;
  getProbeConfig(id: string): ProbeConfig | undefined;
  /**
   * Explicit bearer token to enforce on POST /:id/trigger. When undefined
   * the route falls back to `OPS_TRIGGER_TOKEN` via `bearerAuth()`'s
   * default env lookup. Either path is fail-loud at construction time
   * (no token → MissingAuthTokenError) so a missing config can't silently
   * degrade into "always reject" or "always allow".
   */
  triggerToken?: string;
  /** Override clock for tests. Defaults to Date.now. */
  now?: () => number;
}

/** JSON-serializable shape for a probe schedule entry — matches the spec. */
interface ProbeScheduleEntryDto {
  id: string;
  kind: string;
  schedule: string;
  nextRunAt: string | null;
  lastRun: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    state: "completed";
    summary: { total: number; passed: number; failed: number } | null;
  } | null;
  inflight: {
    startedAt: string;
    elapsedMs: number;
    services: Array<{ slug: string } & ProbeServiceProgress>;
  } | null;
  config: {
    timeout_ms: number | null;
    max_concurrency: number | null;
    discovery: { source: string; key_template: string } | null;
  };
}

function toIsoOrNull(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  return new Date(ms).toISOString();
}

function buildLastRun(status: EntryStatus): ProbeScheduleEntryDto["lastRun"] {
  // Spec calls for lastRun=null until the first finish; render only when
  // both start AND finish timestamps are set so a half-finished tick
  // (process killed mid-run on a previous boot) doesn't produce a partial
  // payload with NaN durationMs.
  if (
    status.lastRunStartedAt === null ||
    status.lastRunFinishedAt === null ||
    status.lastRunDurationMs === null
  ) {
    return null;
  }
  return {
    startedAt: new Date(status.lastRunStartedAt).toISOString(),
    finishedAt: new Date(status.lastRunFinishedAt).toISOString(),
    durationMs: status.lastRunDurationMs,
    // The scheduler-level enum here is narrower than the run-history one:
    // a slot only flips lastRun* once a tick *completed* (finally clause
    // in runHandlerOnce), so 'completed' is the only legal state. Failures
    // are surfaced via run-history's per-row `state: "failed"` which is
    // already returned on the /api/probes/:id detail route.
    state: "completed",
    summary: status.lastRunSummary ?? null,
  };
}

function buildInflight(
  tracker: ProbeRunTracker | null,
): ProbeScheduleEntryDto["inflight"] {
  if (!tracker) return null;
  // The structural ProbeRunTracker type stored on EntrySlot doesn't expose
  // `snapshot` (kept minimal so the scheduler doesn't import the concrete
  // class). The actual writer — the probe-invoker — always stashes a real
  // ProbeRunTracker instance, so duck-type the call here. If a future
  // caller stashes something tracker-shaped without a snapshot method,
  // surface inflight as null rather than crashing the route.
  const trackerWithSnapshot = tracker as unknown as {
    snapshot?: () => ProbeRunSnapshot;
  };
  if (typeof trackerWithSnapshot.snapshot !== "function") return null;
  const snap = trackerWithSnapshot.snapshot();
  return {
    startedAt: new Date(snap.startedAt).toISOString(),
    elapsedMs: snap.elapsedMs,
    services: snap.services,
  };
}

function buildConfig(
  cfg: ProbeConfig | undefined,
): ProbeScheduleEntryDto["config"] {
  if (!cfg) {
    return { timeout_ms: null, max_concurrency: null, discovery: null };
  }
  return {
    timeout_ms: cfg.timeout_ms ?? null,
    // `max_concurrency` is required by the schema (default 4) so it should
    // always be present, but render defensively just in case.
    max_concurrency: cfg.max_concurrency ?? null,
    discovery:
      "discovery" in cfg
        ? {
            source: cfg.discovery.source,
            key_template: cfg.discovery.key_template,
          }
        : null,
  };
}

function buildEntryDto(
  status: EntryStatus,
  cfg: ProbeConfig | undefined,
  nextRunAt: Date | null,
): ProbeScheduleEntryDto {
  return {
    id: status.id,
    // The probe `kind` is not on EntryStatus (the scheduler is dimension-
    // agnostic). Fall back to "unknown" if the orchestrator hasn't supplied
    // a config — keeps the payload shape stable rather than omitting the
    // field.
    kind: cfg?.kind ?? "unknown",
    schedule: status.cron,
    nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
    lastRun: buildLastRun(status),
    inflight: buildInflight(status.tracker),
    config: buildConfig(cfg),
  };
}

/**
 * Mount /api/probes routes onto an existing Hono app.
 *
 * Routes:
 *   - GET    /api/probes
 *   - GET    /api/probes/:id
 *   - POST   /api/probes/:id/trigger     (bearer-auth gated)
 *
 * All responses carry `Cache-Control: no-cache` per spec — the dashboard
 * client (B4b) polls these endpoints and any intermediate proxy caching
 * would mask in-flight transitions.
 */
export function registerProbesRoutes(app: Hono, deps: ProbesRouteDeps): void {
  const { scheduler, writer, getProbeConfig } = deps;
  const now = deps.now ?? (() => Date.now());

  // Per-probe last-trigger timestamp for the rate-limit window. Map keyed
  // by probe id so two distinct probes don't share a single bucket.
  const lastTriggerAt = new Map<string, number>();

  // Construct the auth middleware up-front so a missing token surfaces at
  // boot rather than on the first POST. `bearerAuth` is fail-loud when
  // both `expectedToken` and the env var are unset/empty.
  const auth = bearerAuth({ expectedToken: deps.triggerToken });

  app.get("/api/probes", (c) => {
    const ids = scheduler.list().map((e) => e.id);
    const probes: ProbeScheduleEntryDto[] = [];
    for (const id of ids) {
      const status = scheduler.getEntry(id);
      if (!status) continue;
      probes.push(
        buildEntryDto(status, getProbeConfig(id), scheduler.nextRunAt(id)),
      );
    }
    c.header("Cache-Control", "no-cache");
    return c.json({ probes });
  });

  app.get("/api/probes/:id", async (c) => {
    const id = c.req.param("id");
    const status = scheduler.getEntry(id);
    if (!status) {
      c.header("Cache-Control", "no-cache");
      return c.json({ error: "not_found" }, 404);
    }
    const cfg = getProbeConfig(id);
    const nextRunAt = scheduler.nextRunAt(id);
    const probe = buildEntryDto(status, cfg, nextRunAt);
    // Hard-coded limit per spec ("last 10 runs"). If we surface a query
    // param later, validate it before passing through to PB.
    const runs = await writer.recent(id, 10);
    c.header("Cache-Control", "no-cache");
    return c.json({ probe, runs });
  });

  app.post("/api/probes/:id/trigger", auth, async (c) => {
    const id = c.req.param("id");
    c.header("Cache-Control", "no-cache");
    if (!scheduler.getEntry(id)) {
      return c.json({ error: "not_found" }, 404);
    }

    // Rate-limit BEFORE invoking trigger() so an overzealous caller can't
    // pile up scheduler.trigger calls inside the window. Only stamp the
    // window on a successful trigger — a 409 inflight conflict (or any
    // other failure) shouldn't lock the operator out for 5 minutes.
    const last = lastTriggerAt.get(id);
    const t = now();
    if (last !== undefined && t - last < TRIGGER_RATE_LIMIT_MS) {
      return c.json(
        {
          error: "rate_limited",
          retryAfterMs: TRIGGER_RATE_LIMIT_MS - (t - last),
        },
        429,
      );
    }

    // Body is optional — tolerate empty / non-JSON bodies so a curl with
    // no -d still works. Guard the parse so a malformed JSON body becomes
    // a clean 400 rather than a 500.
    let filterSlugs: string[] = [];
    let opts: { filter?: { slugs?: string[] } } | undefined;
    const raw = await c.req.text();
    if (raw.length > 0) {
      try {
        const parsed = JSON.parse(raw) as {
          filter?: { slugs?: string[] };
        };
        if (parsed && typeof parsed === "object" && parsed.filter) {
          opts = { filter: parsed.filter };
          if (Array.isArray(parsed.filter.slugs)) {
            filterSlugs = parsed.filter.slugs;
          }
        }
      } catch {
        return c.json({ error: "invalid_json" }, 400);
      }
    }

    try {
      const result = await scheduler.trigger(id, opts);
      // Stamp the window only on success — see comment above.
      lastTriggerAt.set(id, t);
      return c.json({
        runId: result.runId,
        status: result.status,
        probe: result.probe,
        scope: filterSlugs,
      });
    } catch (err) {
      if (err instanceof InflightConflictError) {
        return c.json({ error: "inflight" }, 409);
      }
      // Unknown ids should already have been caught above by getEntry,
      // but keep the catch-all as a defensive 500.
      throw err;
    }
  });
}
