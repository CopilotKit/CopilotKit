/**
 * Family-silence monitor (spec §9) — the CP-side Slack alerting hook for the
 * one incident class the status-row alert engine is structurally blind to:
 * a worker family going silent produces NO row transitions, so no
 * transition-keyed rule can ever fire.
 *
 * Scheduled off the existing fleet-health interval (`control-plane.ts` calls
 * `tick(nowMs)` every ~15 s) but deliberately NOT evaluated at that cadence:
 * the tick is a cheap in-memory gate, and each family's actual evaluation
 * runs at most once per its resolved period. When an evaluation does run it
 * reads THE shared memoized family-summary instance (`run-view.ts` —
 * `runControlPlane` constructs one and injects it into both the fleet-runs
 * routes and this monitor), so with the dashboard open the read is usually a
 * memo hit; the zero-viewer worst case is ~4 fan-outs per shortest period.
 *
 * Two alert classes, both per-family, both 6 h rate-limited via the existing
 * alert-state store, both with a recovered one-shot, both suppressed for one
 * resolved period after CP boot (boot grace — a fresh env / deploy-ordering
 * PB flap must not page):
 *
 *   1. FAMILY SILENCE — `now − lastSuccessAt > 3 × period` (N=3 mirrors the
 *      "two misses + margin" reasoning behind STARTER_STALE_AFTER_MS). Null
 *      `lastSuccessAt` falls back to the oldest known batch's `enqueuedAt`
 *      ("has never completed a run since…"); zero batches → silent. The
 *      "last attempt" is INFLIGHT-AWARE: an inflight batch IS the last
 *      attempt (`stalled` when `inflight.stalled`, else `running`) — only
 *      with no inflight does `lastRun`'s §5.2.1 precedence-derived outcome
 *      apply, and it is rendered VERBATIM (never re-classified).
 *   2. EVALUATION FAILURE (meta-alert) — evaluation counts as failed under
 *      EITHER presentation: `summary.get()` throws, OR the §5.2.1
 *      degraded-200 shape carries `error: "history_unavailable"` for the
 *      family (PB-down-while-CP-up deliberately does NOT throw, so the
 *      second arm is load-bearing). After >1 resolved period of consecutive
 *      failure the meta-alert posts; the failing-since clock starts no
 *      earlier than boot-grace end.
 *
 * `lastEvaluatedAt()` stamps `/health` (`fleetRuns.lastEvaluatedAt`) so an
 * external poll can detect a wedged monitor — the §9 compensating control
 * for "the monitor cannot report its own host's death".
 *
 * Alert text is composed from closed-vocabulary parts only (§5.2.1 redaction
 * rule): registry labels, ISO timestamps, cycle counts, the three-valued
 * outcome, and `isPoolCommErrorKind`-validated kinds already sanitized by
 * run-view. Raw error messages never reach the webhook.
 */

import { createHash } from "node:crypto";
import type { Logger } from "../../types/index.js";
import type { AlertStateStore } from "../../storage/alert-state-store.js";
import type { ProducerSchedule } from "./control-plane.js";
import { FLEET_FAMILIES, periodMsFromCron } from "./run-view.js";
import type {
  FamilySummaryEntry,
  FleetFamily,
  MemoizedFamilySummary,
} from "./run-view.js";

/** Alert-state keying (§9): silence alerts — `rule_id` + `dedupe_key: family`. */
export const FAMILY_SILENCE_RULE_ID = "family-silence";
/** Alert-state keying (§9): evaluation-failure meta-alerts, same dedupe shape. */
export const FAMILY_SILENCE_EVAL_RULE_ID = "family-silence-eval";
/** §9: one alert per family per 6 h, per alert class. */
export const SILENCE_ALERT_RATE_LIMIT_MS = 6 * 3_600_000;
/** §9: silence threshold N — alert when now − lastSuccessAt > N × period. */
export const SILENCE_PERIOD_MULTIPLIER = 3;

/**
 * Minimum number of consecutive failed evaluation cycles before a silence
 * alert posts. Layered ON TOP of the existing 3×period threshold (an AND,
 * not OR): the alert only fires once BOTH the elapsed-time gate
 * (`now - lastSuccessAt > 3 × period`) and the consecutive-cycle gate are
 * satisfied. Without this, a single bad cron tick on a family whose
 * `lastSuccessAt` was already stale (e.g. after a long quiet window or a
 * deploy gap) could trip the alert immediately — the staging incident on
 * 2026-06-17 where one ~25 min Cloudflare WAF burst on backboard-railway
 * GraphQL caused every family to alert from a single tick.
 *
 * Three was chosen to match the elapsed-time multiplier — the alert posts
 * when the family has missed roughly three of its own evaluation windows
 * in a row, which is the same "this is no longer a single flap" threshold
 * applied along the orthogonal axis. Exported so tests pin the SSOT.
 */
export const SILENCE_CONSECUTIVE_TICK_THRESHOLD = 3;

export interface FamilySilenceMonitorDeps {
  /** The SHARED memoized §5.2.1 projection instance (§5.2 — same one the routes get). */
  summary: Pick<MemoizedFamilySummary, "get">;
  /** The `buildProducerSchedules` output — the resolved-cron period source (§5.1). */
  schedules: readonly ProducerSchedule[];
  /** Existing alert-state store — 6 h rate-limit keying (§9). */
  alertStore: AlertStateStore;
  /** The oss_alerts Slack target send (wired by `runControlPlane`). */
  postAlert: (text: string) => Promise<void>;
  /** CP boot instant — anchors the per-family 1×period boot grace. */
  bootAtMs: number;
  logger: Logger;
}

export interface FamilySilenceMonitor {
  /**
   * Cheap in-memory gate (rides the ~15 s fleet-health interval); per-family
   * evaluation at most once per 1×resolved period. Never rejects.
   */
  tick(nowMs: number): Promise<void>;
  /** Most recent evaluation-cycle instant — the `/health` stamp (§9). */
  lastEvaluatedAt(): number | null;
}

/** A family joined to its resolved period + boot-grace end. */
interface MonitoredFamily {
  fam: FleetFamily;
  periodMs: number;
  graceEndMs: number;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseIso(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

/**
 * §9 last-attempt rendering, inflight-aware: a live inflight batch IS the
 * last attempt; only without one does `lastRun`'s precedence-derived outcome
 * apply — verbatim, with the (already-validated) comm-error kinds appended.
 */
function lastAttemptText(entry: FamilySummaryEntry): string {
  if (entry.inflight) return entry.inflight.stalled ? "stalled" : "running";
  const lastRun = entry.lastRun;
  if (!lastRun) return "none";
  const kinds =
    lastRun.commErrorKinds.length > 0
      ? ` (${lastRun.commErrorKinds.join(", ")})`
      : "";
  return `${lastRun.outcome}${kinds}`;
}

/**
 * §5.2.1 null-semantics staleness reference: `lastSuccessAt` when present,
 * else the oldest known batch's `enqueuedAt` (never-succeeded variant), else
 * null (zero batches — stay silent).
 */
function silenceReference(
  entry: FamilySummaryEntry,
): { refMs: number; neverSucceeded: boolean } | null {
  const successMs = parseIso(entry.lastSuccessAt);
  if (!Number.isNaN(successMs))
    return { refMs: successMs, neverSucceeded: false };
  const candidates = [
    parseIso(entry.lastRun?.enqueuedAt),
    parseIso(entry.inflight?.enqueuedAt),
  ].filter((ms) => !Number.isNaN(ms));
  if (candidates.length === 0) return null;
  return { refMs: Math.min(...candidates), neverSucceeded: true };
}

export function createFamilySilenceMonitor(
  deps: FamilySilenceMonitorDeps,
): FamilySilenceMonitor {
  const { logger } = deps;

  // Join the registry to its resolved periods ONCE — schedules are fixed at
  // construction. A family whose schedule id resolves to no injected
  // schedule is excluded loudly (unreachable while the §5.1 drift-lock
  // holds) rather than monitored with a fabricated period.
  const families: MonitoredFamily[] = [];
  for (const fam of FLEET_FAMILIES) {
    const schedule = deps.schedules.find(
      (s) => s.scheduleId === fam.scheduleId,
    );
    if (!schedule) {
      logger.warn("fleet.family-silence.schedule-unresolved", {
        family: fam.family,
        scheduleId: fam.scheduleId,
      });
      continue;
    }
    const periodMs = periodMsFromCron(schedule.cron);
    families.push({
      fam,
      periodMs,
      graceEndMs: deps.bootAtMs + periodMs,
    });
  }

  // ── In-memory state (lost on restart — boot grace covers the gap) ──────
  /** Per-family gate: last evaluation instant. */
  const lastEvalMs = new Map<string, number>();
  /**
   * Per-family count of consecutive evaluation cycles for which the family
   * was observed silent (both the elapsed-time gate AND the per-family
   * evaluation actually ran). Reset to zero on any cycle where the family
   * evaluated and was NOT silent (i.e. a fresh `lastSuccessAt` returned the
   * family to healthy). Layered with `SILENCE_CONSECUTIVE_TICK_THRESHOLD`
   * (an AND with the existing 3×period elapsed-time gate) to require three
   * consecutive silent ticks before a silence alert posts — the lever for
   * the 2026-06-17 Cloudflare-WAF-burst incident where one bad tick
   * tripped the alert on a stale lastSuccessAt.
   *
   * Lives in memory (lost on restart, like every other counter in this
   * module — boot grace + restart-recovery via the durable alert-state
   * store cover the gap).
   *
   * NOT incremented during boot grace: a family observed silent inside the
   * grace window doesn't count toward the consecutive-tick total, so a
   * cold-start tick can never alone push the counter to threshold. The
   * meta-alert path keeps its own clock (failingSinceMs) and is unaffected.
   */
  const consecutiveSilentTicks = new Map<string, number>();
  /** Meta-alert clock: first consecutive evaluation-failure instant (grace-clamped). */
  const failingSinceMs = new Map<string, number>();
  /** Outstanding alerts awaiting their recovered one-shot. */
  const silenceAlertActive = new Set<string>();
  const metaAlertActive = new Set<string>();
  /**
   * In-memory rate-limit backstop keyed `rule:family`. The durable store is
   * authoritative across restarts, but the meta-alert path exists precisely
   * because PB may be down — when the store read fails we fail OPEN (the
   * §5.2.1 degradation posture: an outage must surface loudly) and this map
   * bounds the spam to one post per window within the process lifetime.
   */
  const lastPostedMs = new Map<string, number>();
  let lastEvaluatedAtMs: number | null = null;
  /** Re-entrancy guard — a slow Slack post must not stack evaluations. */
  let ticking = false;

  async function isRateLimited(
    ruleId: string,
    family: string,
    nowMs: number,
  ): Promise<boolean> {
    const memKey = `${ruleId}:${family}`;
    const mem = lastPostedMs.get(memKey);
    if (mem !== undefined && nowMs - mem < SILENCE_ALERT_RATE_LIMIT_MS) {
      return true;
    }
    try {
      const last = await deps.alertStore.get(ruleId, family);
      const at = parseIso(last?.last_alert_at);
      if (!Number.isNaN(at) && nowMs - at < SILENCE_ALERT_RATE_LIMIT_MS) {
        return true;
      }
    } catch (err) {
      // Fail open: PB-down is exactly when the meta-alert must still fire;
      // the in-memory backstop above bounds repeat posts.
      logger.warn("fleet.family-silence.alert-state-read-failed", {
        ruleId,
        family,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return false;
  }

  /** Post a rate-limited alert; returns true when the post went out. */
  async function postLimited(
    ruleId: string,
    family: string,
    text: string,
    nowMs: number,
  ): Promise<boolean> {
    if (await isRateLimited(ruleId, family, nowMs)) return false;
    try {
      await deps.postAlert(text);
    } catch (err) {
      // Don't record state on a failed send — the next due evaluation retries.
      logger.warn("fleet.family-silence.post-failed", {
        ruleId,
        family,
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    lastPostedMs.set(`${ruleId}:${family}`, nowMs);
    try {
      await deps.alertStore.record(ruleId, family, {
        at: iso(nowMs),
        hash: hashText(text),
        preview: text,
      });
    } catch (err) {
      logger.warn("fleet.family-silence.alert-state-write-failed", {
        ruleId,
        family,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return true;
  }

  /**
   * Recovered one-shots fire on a state TRANSITION (alert-active → healthy),
   * not on a window — so they bypass the rate limit AND must not write the
   * alert-state row (recording one would suppress the NEXT real alert for
   * 6 h). The active flag clears only on a successful send so a failed send
   * retries next cycle.
   */
  async function postRecovered(
    active: Set<string>,
    family: string,
    text: string,
  ): Promise<void> {
    if (!active.has(family)) return;
    try {
      await deps.postAlert(text);
      active.delete(family);
    } catch (err) {
      logger.warn("fleet.family-silence.post-failed", {
        family,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Advance one family's evaluation-failure clock; return its meta-alert trip
   * candidate (clock past >1 period, post-grace) for the cycle-level
   * coalesced post — a globally-thrown projection fails EVERY due family at
   * once, and four identical Slack messages would be pure spam, so the tick
   * posts ONE meta-alert per cycle while keeping per-family clocks and
   * per-family rate-limit keying (the degraded-200 arm can be per-family).
   */
  function evaluateFailure(
    entry: MonitoredFamily,
    nowMs: number,
  ): { family: string; sinceMs: number } | null {
    const { fam, periodMs, graceEndMs } = entry;
    // The failing-since clock starts no earlier than grace end (§9: a PB
    // briefly down while the CP boots is a routine deploy-ordering flap).
    if (!failingSinceMs.has(fam.family)) {
      failingSinceMs.set(fam.family, Math.max(nowMs, graceEndMs));
    }
    if (nowMs < graceEndMs) return null; // grace covers the meta-alert too
    const since = failingSinceMs.get(fam.family) as number;
    if (nowMs - since <= periodMs) return null; // strictly MORE than 1 period (§9)
    return { family: fam.family, sinceMs: since };
  }

  /** Post ONE coalesced meta-alert for every tripped-and-unsuppressed family. */
  async function postMetaAlert(
    trips: Array<{ family: string; sinceMs: number }>,
    nowMs: number,
  ): Promise<void> {
    const eligible: Array<{ family: string; sinceMs: number }> = [];
    for (const trip of trips) {
      if (
        !(await isRateLimited(FAMILY_SILENCE_EVAL_RULE_ID, trip.family, nowMs))
      ) {
        eligible.push(trip);
      }
    }
    if (eligible.length === 0) return;
    const sinceMs = Math.min(...eligible.map((trip) => trip.sinceMs));
    const text = `worker-run telemetry evaluation failing since ${iso(sinceMs)} — family silence cannot be assessed`;
    try {
      await deps.postAlert(text);
    } catch (err) {
      logger.warn("fleet.family-silence.post-failed", {
        ruleId: FAMILY_SILENCE_EVAL_RULE_ID,
        err: err instanceof Error ? err.message : String(err),
      });
      return; // nothing recorded — the next due evaluation retries
    }
    for (const trip of eligible) {
      lastPostedMs.set(`${FAMILY_SILENCE_EVAL_RULE_ID}:${trip.family}`, nowMs);
      metaAlertActive.add(trip.family);
      try {
        await deps.alertStore.record(FAMILY_SILENCE_EVAL_RULE_ID, trip.family, {
          at: iso(nowMs),
          hash: hashText(text),
          preview: text,
        });
      } catch (err) {
        logger.warn("fleet.family-silence.alert-state-write-failed", {
          ruleId: FAMILY_SILENCE_EVAL_RULE_ID,
          family: trip.family,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.warn("fleet.family-silence.eval-alert-posted", {
      families: eligible.map((trip) => trip.family),
      failingSince: iso(sinceMs),
    });
  }

  /**
   * Post ONE coalesced meta recovered one-shot for every family whose
   * evaluation just succeeded while its meta-alert was outstanding. Flags
   * clear only on a successful send so a failed send retries next cycle.
   */
  async function postMetaRecovered(recovered: string[]): Promise<void> {
    if (recovered.length === 0) return;
    try {
      await deps.postAlert(
        "worker-run telemetry evaluation recovered — family silence assessment resumed",
      );
      for (const family of recovered) metaAlertActive.delete(family);
    } catch (err) {
      logger.warn("fleet.family-silence.post-failed", {
        ruleId: FAMILY_SILENCE_EVAL_RULE_ID,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function evaluateFamily(
    monitored: MonitoredFamily,
    entry: FamilySummaryEntry,
    nowMs: number,
  ): Promise<void> {
    const { fam, periodMs, graceEndMs } = monitored;

    const ref = silenceReference(entry);
    if (!ref) return; // zero batches (fresh env) — never alerts (§5.2.1)

    const silent = nowMs - ref.refMs > SILENCE_PERIOD_MULTIPLIER * periodMs;
    if (!silent) {
      // Family is healthy this cycle — reset the consecutive-silent counter
      // so the threshold gate only ever fires on UNINTERRUPTED runs of
      // silent observations.
      consecutiveSilentTicks.delete(fam.family);
      // §9 recovered one-shot: the next successful batch after an alert.
      if (entry.lastSuccessAt) {
        await postRecovered(
          silenceAlertActive,
          fam.family,
          `worker family ${fam.label} recovered — successful run completed at ${entry.lastSuccessAt}`,
        );
      }
      return;
    }

    if (nowMs < graceEndMs) return; // boot grace (1×period, §9)

    // Consecutive-silent-tick gate (Change 3 — 2026-06-17 Cloudflare-WAF
    // incident remediation). The elapsed-time gate above (3×period) shows
    // the family LOOKS silent right now; the consecutive-tick gate shows
    // it has STAYED that way across multiple evaluation cycles, so a
    // single bad tick with a stale `lastSuccessAt` can no longer trip the
    // alert. Both gates must be satisfied to post.
    const ticks = (consecutiveSilentTicks.get(fam.family) ?? 0) + 1;
    consecutiveSilentTicks.set(fam.family, ticks);
    if (ticks < SILENCE_CONSECUTIVE_TICK_THRESHOLD) {
      logger.debug("fleet.family-silence.silence-tick-incremented", {
        family: fam.family,
        consecutiveSilentTicks: ticks,
        threshold: SILENCE_CONSECUTIVE_TICK_THRESHOLD,
      });
      return;
    }

    const cycles = Math.floor((nowMs - ref.refMs) / periodMs);
    const attempt = lastAttemptText(entry);
    const text = ref.neverSucceeded
      ? `worker family ${fam.label} silent — has never completed a run since ${iso(ref.refMs)} (${cycles} cycles); last attempt: ${attempt}`
      : `worker family ${fam.label} silent — no successful run since ${iso(ref.refMs)} (${cycles} cycles); last attempt: ${attempt}`;
    const posted = await postLimited(
      FAMILY_SILENCE_RULE_ID,
      fam.family,
      text,
      nowMs,
    );
    // An alert is outstanding even when the 6 h window suppressed THIS post
    // (e.g. the durable row survived a CP restart) — the recovered one-shot
    // must still fire when the family next succeeds.
    silenceAlertActive.add(fam.family);
    if (posted) {
      logger.warn("fleet.family-silence.silence-alert-posted", {
        family: fam.family,
        cycles,
        consecutiveSilentTicks: ticks,
        lastAttempt: attempt,
      });
    }
  }

  return {
    async tick(nowMs: number): Promise<void> {
      if (ticking) return;
      ticking = true;
      try {
        // Cheap in-memory gate: which families are due (≥1×period since
        // their last evaluation)? First tick: everything is due.
        const due = families.filter((entry) => {
          const last = lastEvalMs.get(entry.fam.family);
          return last === undefined || nowMs - last >= entry.periodMs;
        });
        if (due.length === 0) return;

        // One shared projection read serves every due family this cycle —
        // the §9 cost bound (and usually a memo hit with the dashboard open).
        lastEvaluatedAtMs = nowMs;
        for (const entry of due) lastEvalMs.set(entry.fam.family, nowMs);

        let body: Awaited<ReturnType<typeof deps.summary.get>> | null = null;
        try {
          body = await deps.summary.get();
        } catch (err) {
          // Presentation 1 of evaluation failure (§9): the projection threw.
          logger.warn("fleet.family-silence.summary-read-failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        }

        const metaTrips: Array<{ family: string; sinceMs: number }> = [];
        const metaRecoveries: string[] = [];
        for (const entry of due) {
          const familyEntry = body?.families.find(
            (f) => f.family === entry.fam.family,
          );
          // Presentation 2 (§9): degraded-200 with history_unavailable — the
          // §5.2.1 contract is to NOT throw on PB-down, so a throw-only
          // trigger would never start the clock on that incident.
          if (
            body === null ||
            familyEntry === undefined ||
            familyEntry.error === "history_unavailable"
          ) {
            const trip = evaluateFailure(entry, nowMs);
            if (trip) metaTrips.push(trip);
          } else {
            // Evaluation succeeded — clear the family's meta clock and queue
            // its share of the coalesced recovered one-shot.
            failingSinceMs.delete(entry.fam.family);
            if (metaAlertActive.has(entry.fam.family)) {
              metaRecoveries.push(entry.fam.family);
            }
            await evaluateFamily(entry, familyEntry, nowMs);
          }
        }
        await postMetaAlert(metaTrips, nowMs);
        await postMetaRecovered(metaRecoveries);
      } catch (err) {
        // tick() never rejects — the control-plane interval must never wedge.
        logger.error("fleet.family-silence.tick-failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        ticking = false;
      }
    },

    lastEvaluatedAt(): number | null {
      return lastEvaluatedAtMs;
    },
  };
}
