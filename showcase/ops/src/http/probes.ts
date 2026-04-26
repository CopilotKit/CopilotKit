import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
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
 * R2-A.8: hard ceiling on the trigger POST body. Operators sending a
 * filter list never need more than a few KB; cap at 16 KiB so a hostile
 * caller can't push `c.req.text()` into unbounded memory consumption.
 * 413 is returned when Content-Length exceeds this OR when the actual
 * read overshoots (Hono's body lengths can be lied about by clients).
 */
export const TRIGGER_BODY_LIMIT_BYTES = 16 * 1024;

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

  // CR-A1.7: scope filter — `scheduler.list()` includes scheduler entries
  // that aren't probes (e.g. `internal:s3-backup`, rule-cron entries
  // `<ruleId>:cron:<idx>`). Without this guard a trigger token holder
  // could fire `internal:s3-backup` via /api/probes/.../trigger. We
  // restrict ALL /api/probes routes (list + detail + trigger) to ids
  // that have a registered ProbeConfig — i.e. ids the loader actually
  // recognizes as probes.
  function isProbeId(id: string): boolean {
    return getProbeConfig(id) !== undefined;
  }

  app.get("/api/probes", (c) => {
    const ids = scheduler.list().map((e) => e.id);
    const probes: ProbeScheduleEntryDto[] = [];
    for (const id of ids) {
      if (!isProbeId(id)) continue;
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
    // CR-A1.7: 404 when the id isn't a probe — same UX as "unknown id."
    // Defends the detail route alongside the listing.
    if (!isProbeId(id)) {
      c.header("Cache-Control", "no-cache");
      return c.json({ error: "not_found" }, 404);
    }
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
    //
    // R2-A.9: graceful degradation. A transient PB outage on writer.recent
    // must not 500 the probe-detail page — operators still need to see
    // schedule + inflight + config + lastRun even when run history is
    // unavailable. Surface an empty `runs` plus a `runsError` indicator
    // so the dashboard can render a small "history offline" banner
    // alongside the rest of the probe metadata.
    let runs: Awaited<ReturnType<typeof writer.recent>> = [];
    let runsError: string | undefined;
    try {
      runs = await writer.recent(id, 10);
    } catch (err) {
      runsError = "history_unavailable";
      // Best-effort logging — without a route-level logger, fall back to
      // console.warn so CI logs surface the underlying PB outage.
      // eslint-disable-next-line no-console
      console.warn("probes.recent-failed", {
        probeId: id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    c.header("Cache-Control", "no-cache");
    return c.json(runsError ? { probe, runs, runsError } : { probe, runs });
  });

  // R4-A.5: use Hono's bodyLimit middleware for early-bail streaming
  // enforcement of the body cap. This catches chunked uploads that omit
  // (or lie about) Content-Length, aborting the read at limit+small
  // rather than buffering the full body before checking. The middleware
  // also short-circuits oversize Content-Length declarations.
  const triggerBodyLimit = bodyLimit({
    maxSize: TRIGGER_BODY_LIMIT_BYTES,
    onError: (c) =>
      c.json({ error: "payload_too_large" } as const, 413) as unknown as
        | Response
        | Promise<Response>,
  });

  app.post("/api/probes/:id/trigger", auth, triggerBodyLimit, async (c) => {
    const id = c.req.param("id");
    c.header("Cache-Control", "no-cache");
    // CR-A1.7: 404 if id is not a registered probe. `internal:s3-backup`,
    // rule-cron entries, and any other non-probe scheduler ids are off-
    // limits to this endpoint — those have their own admin paths.
    if (!isProbeId(id)) {
      return c.json({ error: "not_found" }, 404);
    }
    if (!scheduler.getEntry(id)) {
      return c.json({ error: "not_found" }, 404);
    }

    // R2-A.5: read + parse the body BEFORE stamping the rate-limit
    // window. A malformed body must NOT consume the operator's 5-minute
    // hold — that punished users for our own validation rejecting their
    // request. Sequence: auth → bodyLimit → 404 → body read → JSON parse
    // → filter shape → rate-limit check → STAMP → scheduler.trigger.
    let raw: string;
    try {
      raw = await c.req.text();
    } catch (err) {
      // R4-A.5: the bodyLimit middleware errors the request stream with
      // a BodyLimitError when an oversize chunk arrives without a
      // truthful Content-Length. Surface that as 413 (matching the CL
      // fast-path) rather than masking it as a generic 400 invalid_body.
      if (err instanceof Error && err.name === "BodyLimitError") {
        return c.json({ error: "payload_too_large" }, 413);
      }
      return c.json({ error: "invalid_body" }, 400);
    }
    // R4-A.4: post-read defense uses BYTE length (UTF-8) not char length.
    // The bodyLimit middleware above is the primary guard, but a payload
    // that slips a (lying) Content-Length past the middleware's CL fast-
    // path could still arrive here — and a multibyte payload (emoji =
    // 4 UTF-8 bytes per code point) can have a char length under the cap
    // while exceeding the byte limit. Compare byte counts to stay aligned
    // with the spec's BYTE-denominated TRIGGER_BODY_LIMIT_BYTES.
    if (Buffer.byteLength(raw, "utf8") > TRIGGER_BODY_LIMIT_BYTES) {
      return c.json({ error: "payload_too_large" }, 413);
    }

    // R2-A.4: validate filter.slugs is a string array before forwarding
    // to the scheduler. Without this, the invoker constructs
    // `new Set(filterSlugs)` on a string → per-character set membership
    // (`new Set("foo")` === `Set{"f","o"}`), silently broken.
    //
    // R4-A.1: track whether a filter was provided at all so the response
    // envelope can return `scope: null` (no filter sent) vs `scope: []`
    // (filter sent but empty). Operators rely on this distinction when
    // reading audit logs.
    let filterSlugs: string[] = [];
    let filterProvided = false;
    let opts: { filter?: { slugs?: string[] } } | undefined;
    if (raw.length > 0) {
      let parsed: { filter?: { slugs?: unknown } };
      try {
        parsed = JSON.parse(raw) as { filter?: { slugs?: unknown } };
      } catch {
        return c.json({ error: "invalid_json" }, 400);
      }
      if (parsed && typeof parsed === "object" && parsed.filter) {
        const slugs = (parsed.filter as { slugs?: unknown }).slugs;
        if (slugs !== undefined) {
          // Must be string[]. Reject string-where-array (R2-A.4) and
          // mixed-type arrays.
          if (
            !Array.isArray(slugs) ||
            !slugs.every((s): s is string => typeof s === "string")
          ) {
            return c.json({ error: "invalid_filter" }, 400);
          }
          filterSlugs = slugs;
          filterProvided = true;
          opts = { filter: { slugs } };
        }
      }
    }

    // CR-A1.4: stamp the window IMMEDIATELY after the check passes so two
    // near-simultaneous requests can't both clear the check before either
    // records a timestamp (TOCTOU). R2-A.5: this stamp now happens AFTER
    // body parse + filter validation, so a 400 path doesn't burn the
    // operator's window.
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
    lastTriggerAt.set(id, t);
    // R2-A.6: rollback uses a compare-and-swap on `t`. Without this, two
    // concurrent triggers (A stamps t=100, B stamps t=101) could have A
    // throw and roll back to `last` — which would DELETE B's stamp.
    // Only roll back when the current stored value is still our own t.
    const rollbackRateLimit = (): void => {
      if (lastTriggerAt.get(id) !== t) return; // someone else stamped after us
      if (last === undefined) lastTriggerAt.delete(id);
      else lastTriggerAt.set(id, last);
    };

    try {
      const result = await scheduler.trigger(id, opts);
      // Stamp already in place — leave it.
      // R4-A.1: scope is null when no filter was provided in the body;
      // the actual array (possibly empty) when filter.slugs was sent.
      // This lets operators distinguish "no filter" from "filter:[]".
      return c.json({
        runId: result.runId,
        status: result.status,
        probe: result.probe,
        scope: filterProvided ? filterSlugs : null,
      });
    } catch (err) {
      // R4-A.6: roll back the rate-limit stamp on ALL non-success paths,
      // not just InflightConflictError. A transient scheduler/network
      // error that surfaces as a 5xx must not lock the operator out of
      // the 5-min window — the trigger never actually consumed a run.
      // Rollback fires FIRST so even a malicious throw inside the type-
      // check below can't escape with the window stamped. The R2-A.6
      // compare-and-swap inside `rollbackRateLimit` keeps concurrent
      // triggers' stamps safe.
      rollbackRateLimit();
      if (err instanceof InflightConflictError) {
        // CR-A1.4: 409 inflight didn't actually start a new run; rate-
        // limit already rolled back above so a follow-up trigger after
        // the conflict clears isn't locked out.
        return c.json({ error: "inflight" }, 409);
      }
      // Bonus (bucket b): structured trace for unexpected throws so 500s
      // are diagnosable from logs alone. Mirrors the `console.warn` style
      // used by `probes.recent-failed` above — the route layer doesn't
      // (yet) take a logger dep, so use console.error to surface in CI.
      // eslint-disable-next-line no-console
      console.error("probes.trigger-unexpected", {
        probeId: id,
        err: err instanceof Error ? err.message : String(err),
      });
      // Unknown ids should already have been caught above by getEntry,
      // but keep the catch-all as a defensive 500.
      throw err;
    }
  });
}
