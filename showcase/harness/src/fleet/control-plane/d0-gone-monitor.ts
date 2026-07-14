/**
 * Production D0-gone monitor (spec `2026-07-13-prod-d0-gone-monitor.md`).
 *
 * The one incident class the per-cell alert rules are blind to: a whole
 * integration column collapsing to red-D0 ("completely gone" — backend
 * unreachable), which is NOT a single failing cell but the entire column down.
 * On 2026-07-13 LGT went fully gone in prod and nothing paged.
 *
 * DESIGN — single verdict, no re-derivation (§2.3). The monitor does NOT
 * compute its own "gone" from raw PocketBase rows. It runs the dashboard's OWN
 * `buildCellModel` fold (the shared `showcase/harness/src/shared/cell-model/`
 * module both the dashboard and this monitor import) over the same `status`
 * rows and applies the §2.4 column-gone predicate over the resulting
 * `CellModel` fields. Because it is literally the same pure fold over the same
 * rows, the monitor's per-cell verdict == the DepthChip the dashboard renders,
 * BY CONSTRUCTION.
 *
 * Every 15m (prod only, control-plane only — gated at registration in
 * `orchestrator.ts`) the `tick()`:
 *   1. PRODUCER-LIVENESS GATE (§2.5, F1). If the fleet producer is idle/paused
 *      (the LGT mitigation state), the tick is SUSPENDED: hold all state, no
 *      OPEN/CLOSE/re-post. This is mandatory — the comm-error signals go stale
 *      when the producer pauses, so a live gone-scan would go blind AND could
 *      fire a false recovery. Liveness reuses the family-silence monitor's
 *      inflight-aware `/api/runs` reasoning.
 *   2. FIRST SCAN (§3). Read `status`, run `buildCellModel` per wired cell,
 *      fold `columnGone` → candidate gone set S1.
 *   3. CONFIRM SCAN (§3). If S1 non-empty, wait ~60s and re-READ (NOT re-probe
 *      — re-probing a sick pool deepens the incident). Confirmed set C = S1 ∩ S2.
 *   4. STATE MACHINE (§5). Per slug: OPEN (post + set lastAlertAt), hourly
 *      re-post (1h gate), CLOSE on positive fresh-healthy evidence, HOLD when
 *      inconclusive. State is one JSON map persisted in `alert_state`.
 *   5. ALERT (§4). ONE aggregated #oss-alerts message listing all gone
 *      integrations + since-when; a consolidated recovery notice on clear.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger } from "../../types/index.js";
import type { AlertStateStore } from "../../storage/alert-state-store.js";
import type { PbClient } from "../../storage/pb-client.js";
import { buildCellModel } from "../../shared/cell-model/cell-model.js";
import type { StatusRow } from "../../shared/cell-model/live-status.js";
import { mergeRowsToMap } from "../../shared/cell-model/live-status.js";
import type { ProducerSchedule } from "./control-plane.js";
import { periodMsFromCron } from "./run-view.js";
import type {
  FamilySummaryEntry,
  FamilySummaryResponse,
  MemoizedFamilySummary,
  WorkerView,
} from "./run-view.js";
import {
  columnGone,
  columnFreshHealthy,
  wiredSupportedCells,
} from "./d0-gone-predicate.js";
import type {
  CellGoneInput,
  RegistryDoc,
  WiredCell,
} from "./d0-gone-predicate.js";

/** §5.1 stable synthetic rule id (the monitor is a bespoke cron, not a YAML rule). */
export const PROD_D0_GONE_RULE_ID = "prod-d0-gone-monitor";

/** §2.5 idle-window multiplier — 3× the longest resolved producer period, matching
 *  the family-silence monitor's `SILENCE_PERIOD_MULTIPLIER = 3` ("no longer a
 *  single missed window"). Bound to the same cadence math so the two monitors
 *  cannot disagree about whether the fleet is producing. */
export const PRODUCER_IDLE_PERIOD_MULTIPLIER = 3;

/** A3 fallback idle window when no producer schedule resolves a period —
 *  3× the standard 15m fleet cadence (45m). Keeps the liveness gate meaningful
 *  (fails toward alerting) instead of trapping the monitor SUSPENDED forever. */
export const DEFAULT_IDLE_WINDOW_MS =
  PRODUCER_IDLE_PERIOD_MULTIPLIER * 15 * 60_000;

/** §8 defaults (all overridable via `PROD_D0_MONITOR_*`). */
export const DEFAULT_CONFIRM_DELAY_MS = 60_000;
export const DEFAULT_REPOST_MINUTES = 60;
export const DEFAULT_MAX_SLUGS_IN_MESSAGE = 25;

/** A4 hard pagination ceiling — a defensive cap so a misbehaving PocketBase
 *  (missing/NaN `totalPages` while always returning a full page) cannot spin
 *  `readStatusRows` into an unbounded loop. 200 × 500 = 100k rows, far above the
 *  real `status` collection; hitting it means PB is misbehaving (logged). */
export const MAX_STATUS_PAGES = 200;

/** Per-slug outage record persisted in the serialized JSON map (§5.1). */
interface OutageEntry {
  /** Persisted outage-open onset — never recomputed while gone (F8). */
  sinceAt: string;
  /** Last successful alert send instant (drives the 1h re-post gate). */
  lastAlertAt: string;
}

type OutageMap = Record<string, OutageEntry>;

export interface D0GoneMonitorConfig {
  confirmDelayMs: number;
  repostMinutes: number;
  maxSlugsInMessage: number;
}

/** §8 config resolution from env (namespaced `PROD_D0_MONITOR_*`). */
export function resolveConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): D0GoneMonitorConfig {
  // `min` is the smallest accepted value: 0 for `confirmDelayMs` (a 0ms confirm
  // delay is degenerate but harmless — it just collapses the confirm re-read to
  // the same instant), but 1 for both `repostMinutes` and `maxSlugsInMessage`:
  //   - `repostMinutes: 0` → `repostMs = 0` → `ageMs >= 0` is ALWAYS true → every
  //     open slug is "due" on every 15m tick → the outage re-posts every tick,
  //     defeating the hourly dedup. Floor it at 1 minute.
  //   - `maxSlugsInMessage: 0` → an outage message naming ZERO gone slugs (all
  //     folded into "+N more"), a useless page. Floor it at 1.
  // Below `min` (or NaN / non-finite / empty) falls back to the default.
  const num = (raw: string | undefined, fallback: number, min = 0): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  return {
    confirmDelayMs: num(
      env.PROD_D0_MONITOR_CONFIRM_DELAY_MS,
      DEFAULT_CONFIRM_DELAY_MS,
    ),
    repostMinutes: num(
      env.PROD_D0_MONITOR_REPOST_MINUTES,
      DEFAULT_REPOST_MINUTES,
      1,
    ),
    maxSlugsInMessage: num(
      env.PROD_D0_MONITOR_MAX_SLUGS_IN_MESSAGE,
      DEFAULT_MAX_SLUGS_IN_MESSAGE,
      1,
    ),
  };
}

/** §8 kill-switch: `PROD_D0_MONITOR_ENABLED=false` disables without a deploy. */
export function isEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.PROD_D0_MONITOR_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * B-env: resolve the deploy environment for the prod gate. The raw
 * `SHOWCASE_ENV ?? RAILWAY_ENVIRONMENT_NAME` had two silent-disable bugs:
 *   1. `SHOWCASE_ENV=""` (empty but SET) SHADOWS Railway via `??` (nullish
 *      only, not falsy), so an empty explicit override left the monitor
 *      disabled even on a prod Railway service. Treat an empty/whitespace
 *      value as UNSET so it falls through to `RAILWAY_ENVIRONMENT_NAME`.
 *   2. A mis-cased / space-padded value (`"Production"`, `" production "`)
 *      failed the exact `=== "production"` compare and silently disabled the
 *      monitor in prod. Normalize (trim + lowercase) before comparing.
 * Mirrors the kill-switch's own `?.trim().toLowerCase()` parse. Returns the
 * normalized env string, or `undefined` when neither var resolves a non-empty
 * value.
 */
export function resolveMonitorEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const norm = (raw: string | undefined): string | undefined => {
    const v = raw?.trim().toLowerCase();
    return v ? v : undefined; // empty/whitespace → unset (falls through)
  };
  return norm(env.SHOWCASE_ENV) ?? norm(env.RAILWAY_ENVIRONMENT_NAME);
}

/**
 * The prod-only + kill-switch registration predicate — the SINGLE source of
 * truth `orchestrator.ts` calls AND the gate test exercises (B-gatetest), so an
 * env-precedence / kill-switch / normalization regression fails a test instead
 * of shipping the monitor to the wrong environment (or silently disabling it in
 * prod). Registers iff the resolved env normalizes to `"production"` AND the
 * kill-switch is not `false`.
 */
export function shouldRegister(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return resolveMonitorEnv(env) === "production" && isEnabled(env);
}

/**
 * Load the generated `registry.json` the monitor enumerates wired cells from.
 * Mirrors the established probe-driver resolver (`d4-chat-roundtrip.ts`):
 * `REGISTRY_JSON_PATH` env override, fallback `/app/data/registry.json` (copied
 * in by the harness Dockerfile). Returns an empty doc on missing/parse error —
 * a misconfigured image must not crash the control-plane.
 *
 * A5: a load failure is logged at ERROR with a stable `errorId` (not a
 * warn-once), because an empty registry silently disables the monitor for the
 * whole process (zero wired cells → never pages). The loud error surfaces the
 * gap in log-based alerting, and the monitor re-invokes this loader on every
 * tick while the cell set is empty (see `resolveCells`) so a transiently
 * missing file (slow volume mount, race at boot) self-heals without a redeploy.
 */
export function loadRegistryDoc(
  logger: Logger,
  env: Readonly<Record<string, string | undefined>> = process.env,
): RegistryDoc {
  const registryPath =
    env.REGISTRY_JSON_PATH ?? resolve("/app/data/registry.json");
  try {
    const raw = readFileSync(registryPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as RegistryDoc;
    logger.error("d0-monitor.registry-load-failed", {
      errorId: "d0-monitor-registry-load",
      registryPath,
      reason: "parsed-non-object",
    });
  } catch (err) {
    logger.error("d0-monitor.registry-load-failed", {
      errorId: "d0-monitor-registry-load",
      registryPath,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return {};
}

export interface D0GoneMonitorDeps {
  /** Reads the `status` collection (full rows WITH `signal`, for comm-errors). */
  pb: Pick<PbClient, "list">;
  /** Durable per-slug outage map, one `getSet`/`putSet` slot (§5.1). */
  alertState: Pick<AlertStateStore, "getSet" | "putSet">;
  /** Post ONE aggregated #oss-alerts message; throws on send failure (§7). */
  postAlert: (text: string) => Promise<void>;
  /** SHARED memoized family-summary — the §2.5 producer-liveness source. */
  summary: Pick<MemoizedFamilySummary, "get">;
  /** Resolved producer schedules — the idle-window period source (§2.5). */
  schedules: readonly ProducerSchedule[];
  /**
   * The wired+supported cell universe source (§2.4 / page-stats). Either a
   * fixed `RegistryDoc`, or a loader thunk. A5: a thunk lets the monitor
   * re-load on subsequent ticks while the resolved cell set is empty, so a
   * transiently-missing `registry.json` self-heals without a redeploy.
   */
  registry: RegistryDoc | (() => RegistryDoc);
  /** Resolved dashboard URL for the alert footer (may be undefined). */
  dashboardUrl?: string;
  logger: Logger;
  /** Injected clock (ms). */
  now: () => number;
  /** Injected confirm-scan delay (test seam; defaults to a real setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  config?: Partial<D0GoneMonitorConfig>;
}

export interface D0GoneMonitor {
  tick(): Promise<void>;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseIso(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

/**
 * C6: render a persisted `sinceAt` for Slack, VALIDATING it is a parseable ISO
 * instant first. A corrupt-but-shaped state blob can carry a garbage `sinceAt`
 * string (valid JSON, wrong value); the old `since ?? "unknown"` only null-
 * checked, so `gone since <garbage>` leaked into the page. A value that does not
 * parse (or is absent) renders "unknown" — never the raw garbage.
 */
function renderSince(sinceAt: string | null | undefined): string {
  return Number.isNaN(parseIso(sinceAt)) ? "unknown" : (sinceAt as string);
}

/** Humanize a millisecond duration as e.g. "1h 03m" / "18m" / "45s". */
function humanizeDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(ms / 1000)}s`;
}

/** §2.5 latest-activity instant across a family entry (inflight ∨ lastRun ∨ lastSuccess). */
function latestActivityMs(entry: FamilySummaryEntry): number {
  const candidates = [
    parseIso(entry.inflight?.enqueuedAt),
    parseIso(entry.lastRun?.enqueuedAt),
    parseIso(entry.lastSuccessAt),
  ].filter((n) => !Number.isNaN(n));
  return candidates.length === 0 ? Number.NaN : Math.max(...candidates);
}

function anyWorkerOnline(workers: readonly WorkerView[]): boolean {
  return workers.some((w) => w.health === "online");
}

/**
 * §2.5 producer state — three-way, so the monitor can distinguish a genuinely
 * PAUSED producer (the LGT mitigation state) from a freshly-deployed one that
 * simply has NO run history YET (C5):
 *   - `"live"`    — ≥1 worker is online AND either a batch is inflight OR the
 *                   freshest activity is within the idle window. A worker must
 *                   be online in every live case, so a stale/orphaned inflight
 *                   from a dead worker cannot force a blind live scan. SCANS.
 *   - `"no-data"` — NO parseable activity across any family (no inflight, no
 *                   lastRun, no lastSuccessAt). This is a fresh deploy / not-yet
 *                   state: there is simply nothing to conclude — we have no run
 *                   timestamps to judge liveness OR to trust a gone verdict. We
 *                   HOLD (never page without data), but this is NOT a permanent
 *                   producer-idle SUSPEND: as soon as the fleet produces its
 *                   first run the state advances to live/idle on its own.
 *   - `"idle"`    — there IS activity history, but it is stale past the idle
 *                   window (or no worker is online). The producer is paused/
 *                   stalled; the comm-error signals have gone stale, so a live
 *                   gone-scan would go blind and a scan could fire a false
 *                   recovery. HOLD all state.
 * Derived ONLY from `/api/runs` + the worker heartbeat strip — never from
 * comm-error freshness (which would be circular).
 */
export type ProducerState = "live" | "no-data" | "idle";
export function classifyProducer(
  body: FamilySummaryResponse,
  idleWindowMs: number,
  nowMs: number,
): ProducerState {
  // A stale/orphaned inflight from a dead worker must NOT force a blind live
  // scan — require ≥1 worker online alongside the inflight short-circuit.
  if (
    body.families.some((f) => f.inflight != null) &&
    anyWorkerOnline(body.workers)
  )
    return "live";
  let freshest = Number.NaN;
  for (const f of body.families) {
    const a = latestActivityMs(f);
    if (!Number.isNaN(a) && (Number.isNaN(freshest) || a > freshest)) {
      freshest = a;
    }
  }
  // No parseable activity ANYWHERE → fresh deploy / not-yet (C5). Distinct from
  // a paused producer that HAS a (stale) history: here we cannot conclude
  // anything, so we HOLD without treating it as a permanent idle SUSPEND.
  if (Number.isNaN(freshest)) return "no-data";
  return nowMs - freshest <= idleWindowMs && anyWorkerOnline(body.workers)
    ? "live"
    : "idle";
}

/**
 * §2.5 producer-liveness predicate — a thin wrapper over {@link classifyProducer}
 * kept for the acceptance tests and callers that only need the LIVE/not-LIVE
 * decision. Only `"live"` scans; both `"no-data"` and `"idle"` HOLD.
 */
export function isProducerLive(
  body: FamilySummaryResponse,
  idleWindowMs: number,
  nowMs: number,
): boolean {
  return classifyProducer(body, idleWindowMs, nowMs) === "live";
}

export function createD0GoneMonitor(deps: D0GoneMonitorDeps): D0GoneMonitor {
  const { logger } = deps;
  const config: D0GoneMonitorConfig = { ...resolveConfig(), ...deps.config };
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // The idle window is 3× the LONGEST resolved producer period (§2.5), resolved
  // from the injected schedules — never a hand-picked constant. Computed once
  // at construction (schedules are fixed).
  const longestPeriodMs = deps.schedules.reduce((max, s) => {
    const p = periodMsFromCron(s.cron);
    return Number.isFinite(p) && p > max ? p : max;
  }, 0);
  // A3 guard: an empty/degenerate schedule set (or all-unparseable crons) yields
  // longestPeriodMs === 0 → idleWindowMs 0 → EVERY fresh read is "outside the
  // window" → isProducerLive is permanently false → the monitor SUSPENDS forever
  // and NEVER pages (a silent trap that fails toward SILENCE). Fall back to a
  // sane default window (3× the 15m fleet cadence = 45m) so the liveness gate
  // stays meaningful and the monitor fails toward ALERTING, and log loudly.
  const idleWindowMs =
    longestPeriodMs > 0
      ? PRODUCER_IDLE_PERIOD_MULTIPLIER * longestPeriodMs
      : DEFAULT_IDLE_WINDOW_MS;
  if (longestPeriodMs <= 0) {
    logger.error("d0-monitor.no-producer-schedule", {
      errorId: "d0-monitor-no-schedule",
      scheduleCount: deps.schedules.length,
      fallbackIdleWindowMs: idleWindowMs,
    });
  }

  // The wired+supported cell universe (§2.4) — same enumeration the dashboard's
  // page-stats iterates. Resolved once at construction from a fixed registry, or
  // re-loaded per-tick from a loader thunk while empty (A5 self-heal).
  const registryIsLoader = typeof deps.registry === "function";
  const loadRegistry = (): RegistryDoc =>
    registryIsLoader
      ? (deps.registry as () => RegistryDoc)()
      : (deps.registry as RegistryDoc);
  let cellsBySlug = wiredSupportedCells(loadRegistry());

  /**
   * B-A5gap: "no wired cell anywhere". `wiredSupportedCells` keys EVERY
   * integration slug even when that slug has ZERO wired cells (present with an
   * empty array — see its doc), so `map.size` is > 0 for any registry that
   * lists integrations, even one with no wired cells at all. Guarding self-heal
   * / the loud log on `size === 0` therefore MISSES the real silent-disable
   * case: a registry that parsed fine and has integrations but not a single
   * wired cell → the monitor enumerates only empty arrays and can never page,
   * yet never self-heals or logs. The correct emptiness test is "no slug has
   * ANY wired cell" — every value array is empty (which also covers the
   * genuinely-empty `size === 0` map).
   */
  function hasNoWiredCell(map: Map<string, WiredCell[]>): boolean {
    for (const cells of map.values()) {
      if (cells.length > 0) return false;
    }
    return true;
  }

  /**
   * A5: the wired-cell set for this tick. An empty set (no slug has any wired
   * cell) means the monitor enumerates nothing and can never page — a silent
   * self-disable. If the registry is a loader thunk, re-load and re-enumerate
   * while empty so a transiently-missing `registry.json` self-heals without a
   * redeploy. This function is PURE-of-logging (no side effects beyond the
   * re-load) — `scan()` calls it up to TWICE per tick (first + confirm), so the
   * loud no-wired-cells log lives in `logEmptyCellsOnce` (once per tick), not
   * here, to avoid a double-log per tick.
   */
  function resolveCells(): Map<string, WiredCell[]> {
    if (hasNoWiredCell(cellsBySlug) && registryIsLoader) {
      cellsBySlug = wiredSupportedCells(loadRegistry());
    }
    return cellsBySlug;
  }

  /**
   * Emit the loud no-wired-cells error at most ONCE per tick (called from
   * `runTick`, not from the twice-per-tick `scan`/`resolveCells` path). Runs a
   * re-load first (via `resolveCells`) so it reflects the freshest registry.
   */
  function logEmptyCellsOnce(): void {
    if (hasNoWiredCell(resolveCells())) {
      logger.error("d0-monitor.no-wired-cells", {
        errorId: "d0-monitor-no-wired-cells",
        reloadable: registryIsLoader,
        slugCount: cellsBySlug.size,
      });
    }
  }

  // Re-entrancy guard — the 60s confirm delay means a slow tick could otherwise
  // stack with the next 15m tick (belt-and-braces atop the scheduler's guard).
  let ticking = false;
  // Log SUSPENDED once per contiguous suspension, not every tick (§2.5).
  let suspendedLogged = false;

  // ── State (durable) ────────────────────────────────────────────────
  async function loadMap(): Promise<OutageMap> {
    const { hash } = await deps.alertState.getSet(PROD_D0_GONE_RULE_ID);
    if (!hash) return {};
    try {
      const parsed = JSON.parse(hash);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as OutageMap;
      }
    } catch {
      // Corrupt blob → fail safe to "nothing gone" (§5.1).
      logger.warn("d0-monitor.state-parse-failed", {});
    }
    return {};
  }

  async function saveMap(map: OutageMap, nowMs: number): Promise<void> {
    await deps.alertState.putSet(
      PROD_D0_GONE_RULE_ID,
      JSON.stringify(map),
      iso(nowMs),
    );
  }

  // ── Detection ──────────────────────────────────────────────────────
  /**
   * Read ALL `status` rows (WITH `signal` — the comm-error decode inside
   * `buildCellModel` reads `row.signal` per cell), paginating fully. Throws on
   * PB failure so the caller treats it as INCONCLUSIVE (§9 — never a fake
   * all-gone alert from a DB outage).
   */
  async function readStatusRows(): Promise<StatusRow[]> {
    const rows: StatusRow[] = [];
    const perPage = 500;
    let page = 1;
    // Full rows (default fields incl. signal); large perPage to bound round-trips.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await deps.pb.list<StatusRow>("status", {
        page,
        perPage,
        skipTotal: false,
      });
      rows.push(...res.items);
      if (res.items.length === 0) break;
      // A4: guard a NaN/undefined `totalPages` — a `page >= NaN` comparison is
      // always false, so a full page + bad totalPages would loop forever
      // accumulating duplicate rows (OOM). Treat a non-finite totalPages as
      // "unknown" and rely on the empty-page break + hard cap below.
      const totalPages = Number(res.totalPages);
      if (Number.isFinite(totalPages) && page >= totalPages) {
        // C3: A4 only guarded the loop-FOREVER direction (NaN totalPages). The
        // OPPOSITE hazard is a SHORT read: PB reports a finite `totalPages` that
        // says "no more pages" while STILL returning a FULL page (== perPage).
        // A full final page strongly implies more rows exist beyond what
        // `totalPages` admits, so honoring the break here SILENTLY TRUNCATES the
        // status set — and a truncated read can flip a gone verdict (a slug's
        // missing rows read as no-data, or a partial column folds to gone). We
        // still stop (honoring PB's own page count avoids an unbounded read), but
        // LOG a loud, greppable errorId so the inconsistency surfaces instead of
        // silently poisoning a verdict.
        if (res.items.length >= perPage) {
          logger.error("d0-monitor.status-short-read", {
            errorId: "d0-monitor-short-read",
            page,
            totalPages: res.totalPages,
            perPage,
            lastPageItems: res.items.length,
            rowsSoFar: rows.length,
          });
        }
        break;
      }
      // A4: hard page cap — a defensive ceiling so a misbehaving PB (missing/
      // NaN totalPages while always returning a full page) cannot wedge the
      // control-plane. 200 pages × 500 = 100k rows, far beyond the real status
      // collection; hitting it means PB is misbehaving, so log loudly.
      if (page >= MAX_STATUS_PAGES) {
        logger.error("d0-monitor.status-page-cap-hit", {
          errorId: "d0-monitor-page-cap",
          page,
          maxPages: MAX_STATUS_PAGES,
          totalPages: res.totalPages,
          rowsSoFar: rows.length,
        });
        break;
      }
      page += 1;
    }
    return rows;
  }

  /**
   * ONE scan: shape rows → LiveStatusMap, run `buildCellModel` per wired cell
   * (mirroring page-stats), fold `columnGone`. Returns the set of currently
   * fully-gone slugs AND the set of fresh-healthy slugs (for the CLOSE gate),
   * plus the earliest red-D0 onset per gone slug (for `sinceAt`).
   */
  function scan(
    rows: StatusRow[],
    nowMs: number,
  ): {
    gone: Set<string>;
    healthy: Set<string>;
    onsetBySlug: Map<string, number>;
  } {
    const live = mergeRowsToMap(rows);
    const gone = new Set<string>();
    const healthy = new Set<string>();
    const onsetBySlug = new Map<string, number>();

    for (const [slug, cells] of resolveCells()) {
      if (cells.length === 0) continue; // zero-wired column fails safe (§2.4)
      // Keep the FULL CellModel per cell (not just the gone-input pick) so the
      // onset below can be derived from the SAME fold that decides gone — the
      // model's own contributing rows — never a separate raw-row re-scan.
      const models = cells.map((c) =>
        buildCellModel(
          live,
          {
            slug: c.slug,
            featureId: c.featureId,
            isSupported: true,
            isWired: true,
          },
          nowMs,
        ),
      );
      const goneInputs: CellGoneInput[] = models.map((m) => ({
        achievedDepth: m.achievedDepth,
        chipColor: m.chipColor,
        isStaleCell: m.isStaleCell,
        surfaceState: m.surfaceState,
      }));
      if (columnGone(goneInputs)) {
        gone.add(slug);
        // B-onset / C2: derive `sinceAt` from the FOLDED verdict, NOT a raw
        // `row.state === "red"` re-scan of `live`. The old raw scan could
        // disagree with the fold — a red row on a dimension the ladder does not
        // count toward "gone" (or a prefix-colliding sibling's row) could set an
        // earlier/wrong onset, and when the fold said gone but no raw red row
        // matched the slug it silently fell back to `nowMs` (re-timing the
        // onset). Instead we take the earliest failure timestamp across the SAME
        // rows `buildCellModel` folded into each gone cell — the effective
        // D3/D4/D5/D6 winner rows (`.row`), which are exactly the rungs that
        // produced the red-D0 verdict. These rows are already slug-scoped by
        // construction (buildCellModel keys by this slug), so no substring/
        // prefix mis-attribution is possible.
        //
        // C2: match a WINNER row by its NON-GREEN status (the rung that FAILED
        // the ladder gate), NOT by a literal `row.state === "red"`. A gate can
        // fail on a `degraded` (flaky/amber) winner rung whose literal state is
        // not "red" — the old `state === "red"` filter skipped it, leaving
        // `earliest` NaN → onset silently fell back to `nowMs`. A non-green
        // winner row (red OR degraded) is what actually drove the red-D0, so its
        // `first_failure_at ?? observed_at ?? transitioned_at` is the true onset.
        let earliest = Number.NaN;
        for (const m of models) {
          for (const level of [m.d3, m.d4, m.d5, m.d6]) {
            const r = level?.row;
            // A green winner row cannot contribute to a red-D0 verdict; every
            // OTHER winner state (red / degraded / out-of-vocab) is a
            // gate-failing rung whose failure instant times the onset.
            if (!r || r.state === "green") continue;
            const t = parseIso(
              r.first_failure_at ?? r.observed_at ?? r.transitioned_at,
            );
            if (!Number.isNaN(t) && (Number.isNaN(earliest) || t < earliest)) {
              earliest = t;
            }
          }
        }
        // Fallback only when NO winner row carried a parseable timestamp: use the
        // OPEN instant (`nowMs`) as the first-observed onset. This is consumed
        // ONLY for a genuinely NEW map entry below (an already-open slug keeps
        // its persisted `sinceAt`, F8), so it can never re-stamp a live outage.
        onsetBySlug.set(slug, Number.isNaN(earliest) ? nowMs : earliest);
      } else if (columnFreshHealthy(goneInputs)) {
        healthy.add(slug);
      }
      // else: inconclusive (stale / mixed-with-stale) — neither gone nor healthy.
    }
    return { gone, healthy, onsetBySlug };
  }

  // ── Alert composition (§4) ───────────────────────────────────────────
  function dashboardFooter(): string {
    return deps.dashboardUrl ? ` <${deps.dashboardUrl}|Dashboard>` : "";
  }

  /**
   * Compose the aggregated outage message. `shown` is the ALREADY-SELECTED,
   * already-ordered set of slugs to name by bullet (the re-post-due /
   * rotation-priority winners — see the state machine below); `overflowCount`
   * is how many additional open slugs are folded into the "+N more" line. The
   * caller owns selection so the named bullets and the advanced `lastAlertAt`
   * clocks refer to the SAME slugs (B-cadence / C1).
   */
  function outageMessage(
    shown: string[],
    overflowCount: number,
    map: OutageMap,
    nowMs: number,
  ): string {
    const overflow = overflowCount;
    const bullets = shown
      .map((slug) => {
        const since = map[slug]?.sinceAt;
        const sinceMs = parseIso(since);
        const dur = Number.isNaN(sinceMs)
          ? ""
          : ` (${humanizeDuration(nowMs - sinceMs)})`;
        // C6: validate before interpolating — a garbage sinceAt renders as
        // "unknown", never the raw corrupt string.
        return `• \`${slug}\` — gone since ${renderSince(since)}${dur}`;
      })
      .join("\n");
    const more = overflow > 0 ? `\n• +${overflow} more` : "";
    return (
      ":rotating_light: *Showcase PROD — integration completely gone (fully D0)*\n" +
      "The following integration(s) are fully unreachable (whole column down):\n" +
      `${bullets}${more}\n` +
      `Detected + confirmed by the D0-gone monitor.${dashboardFooter()}`
    );
  }

  function recoveryMessage(
    recovered: Array<{ slug: string; sinceAt: string }>,
    nowMs: number,
  ): string {
    if (recovered.length === 1) {
      const r = recovered[0];
      const sinceMs = parseIso(r.sinceAt);
      const span = Number.isNaN(sinceMs)
        ? ""
        : ` (was gone ${r.sinceAt}→${iso(nowMs)}, ${humanizeDuration(nowMs - sinceMs)})`;
      return (
        ":white_check_mark: *Showcase PROD — integration recovered*\n" +
        `\`${r.slug}\` is reachable again${span}.`
      );
    }
    const bullets = recovered
      .map((r) => {
        const sinceMs = parseIso(r.sinceAt);
        const dur = Number.isNaN(sinceMs)
          ? ""
          : ` (${humanizeDuration(nowMs - sinceMs)})`;
        // C6: validate before interpolating — a corrupt-but-shaped persisted
        // sinceAt renders "unknown", never the raw garbage, in the multi-slug
        // recovery bullet too (matches the outage path :672 and single-slug :691).
        return `• \`${r.slug}\` — was gone ${renderSince(r.sinceAt)}→${iso(nowMs)}${dur}`;
      })
      .join("\n");
    return (
      ":white_check_mark: *Showcase PROD — integrations recovered*\n" +
      "The following integration(s) are reachable again:\n" +
      bullets
    );
  }

  // ── The tick ─────────────────────────────────────────────────────────
  async function runTick(): Promise<void> {
    const nowMs = deps.now();

    // §2.5 PRODUCER-LIVENESS GATE — runs FIRST. Inconclusive summary read is
    // treated as idle (fail safe: hold state, do not act on stale data).
    let body: FamilySummaryResponse | null = null;
    try {
      body = await deps.summary.get();
    } catch (err) {
      // A read failure here silently BLINDS the detector (we HOLD/SUSPEND below
      // with no producer signal) — same family as the other silent-disable
      // guards, so surface it at ERROR with a stable, greppable errorId rather
      // than a low-signal WARN.
      logger.error("d0-monitor.summary-read-failed", {
        errorId: "d0-monitor-summary-read",
        err: err instanceof Error ? err.message : String(err),
      });
    }
    // C5: classify three-way so a FRESH DEPLOY (workers online, no run history
    // yet) is a distinct "no-data / not-yet" HOLD, not a permanent producer-idle
    // SUSPEND. In every non-live case we still HOLD (never page without data) —
    // the difference is diagnostic clarity, and that a no-data state advances to
    // live on its own once the fleet produces its first run (no redeploy).
    const producerState: ProducerState =
      body === null ? "idle" : classifyProducer(body, idleWindowMs, nowMs);
    if (producerState !== "live") {
      if (!suspendedLogged) {
        logger.warn("d0-monitor.suspended-producer-idle", {
          idleWindowMs,
          reason:
            body === null
              ? "summary-unavailable"
              : producerState === "no-data"
                ? "producer-no-data"
                : "producer-idle",
        });
        suspendedLogged = true;
      }
      return; // HOLD: keep ALL prior state, no OPEN/CLOSE/re-post.
    }
    suspendedLogged = false;

    // A5/B-A5gap: log the no-wired-cells gap at most ONCE per tick (scan()
    // resolves the cell set up to twice per tick, so the loud log cannot live
    // there without double-logging). This also drives the loader-thunk re-load.
    logEmptyCellsOnce();

    // §3 FIRST SCAN.
    let rows1: StatusRow[];
    try {
      rows1 = await readStatusRows();
    } catch (err) {
      // §9: can't read status → inconclusive, skip this tick (no OPEN/CLOSE).
      logger.warn("d0-monitor.read-failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const s1 = scan(rows1, nowMs);

    // Load the durable outage map up front so the confirm-scan decision can
    // account for RECOVERY candidates (A2), not just OPEN candidates. A slug is
    // a recovery candidate this tick when it is currently open AND s1 read it
    // fresh-healthy.
    const map = await loadMap();
    // Bucket-b: snapshot the loaded map so a PURE NO-OP tick (nothing opened,
    // re-posted, or recovered — the steady all-healthy case) can skip the
    // `putSet` write entirely. Compared against the final serialized map below.
    const mapBefore = JSON.stringify(map);
    const openSlugs = new Set(Object.keys(map));
    const recoveryCandidates = [...s1.healthy].filter((slug) =>
      openSlugs.has(slug),
    );

    // §3 CONFIRM SCAN — run when EITHER there is a candidate-gone slug (OPEN
    // confirm) OR a currently-open slug read fresh-healthy (RECOVERY confirm).
    // A2: recovery/CLOSE is now SYMMETRIC with OPEN — both require a second
    // agreeing read, so a single transient healthy read can no longer fire a
    // false "recovered" (mirrors the double-confirmed OPEN blip-rejection).
    let confirmed = new Set<string>(s1.gone);
    // Confirmed-healthy for recovery: healthy in s1 AND (once confirmed) scan2.
    let confirmedHealthy = new Set<string>(s1.healthy);
    let scan2 = s1;
    // The instant the recovery/outage evidence was last observed — the
    // confirm-scan instant when a confirm ran, else the tick-start (no confirm).
    let evidenceMs = nowMs;
    if (s1.gone.size > 0 || recoveryCandidates.length > 0) {
      // §3 CONFIRM SCAN — wait, then re-READ (never re-probe). Both must agree.
      await sleep(config.confirmDelayMs);
      const now2 = deps.now();
      evidenceMs = now2;
      let rows2: StatusRow[];
      try {
        rows2 = await readStatusRows();
      } catch (err) {
        logger.warn("d0-monitor.read-failed", {
          err: err instanceof Error ? err.message : String(err),
          phase: "confirm",
        });
        return; // inconclusive confirm read — do not OPEN/CLOSE this tick.
      }
      scan2 = scan(rows2, now2);
      confirmed = new Set([...s1.gone].filter((slug) => scan2.gone.has(slug)));
      // A2: a recovery requires BOTH reads to agree healthy.
      confirmedHealthy = new Set(
        [...s1.healthy].filter((slug) => scan2.healthy.has(slug)),
      );
      const blips = [...s1.gone].filter((slug) => !scan2.gone.has(slug));
      if (blips.length > 0) {
        logger.info("d0-monitor.blip-rejected", {
          slugs: blips,
          scan1At: iso(nowMs),
          scan2At: iso(now2),
        });
      }
      const healthyBlips = recoveryCandidates.filter(
        (slug) => !scan2.healthy.has(slug),
      );
      if (healthyBlips.length > 0) {
        logger.info("d0-monitor.recovery-blip-rejected", {
          slugs: healthyBlips,
          scan1At: iso(nowMs),
          scan2At: iso(now2),
        });
      }
    }

    // §5.2 STATE MACHINE. Confirmed-gone = C; confirmed-fresh-healthy = H (both
    // reads agreed). `now2` is the confirm-scan instant when a confirm ran.
    const healthy = confirmedHealthy;
    const repostMs = config.repostMinutes * 60_000;

    // B-flap: the set of slugs OPEN this tick is NOT just the double-confirmed
    // gone set. Confirm is required to OPEN a NEW outage and to CLOSE an
    // existing one, but an ALREADY-OPEN column must NOT silently drop out of
    // the alert cadence just because a later scan was inconclusive (it flapped
    // gone↔inconclusive across the two confirm reads). If we gated re-posts on
    // `confirmed` alone, such a column would stop re-posting hourly while still
    // open — the outage would go quiet without ever recovering. So:
    //   - CONFIRMED-gone slugs (new or still-gone) are open.
    //   - ALREADY-OPEN map slugs that are NOT confirmed-healthy stay open too
    //     (a confirmed recovery is the ONLY thing that closes them, handled
    //     below); an inconclusive later scan holds the outage open.
    const openNow = [
      ...new Set([
        ...confirmed,
        ...Object.keys(map).filter((slug) => !healthy.has(slug)),
      ]),
    ];
    // Ensure every open slug has a persisted entry BEFORE the due/priority sort
    // below reads `lastAlertAt`. A genuinely NEW outage (a confirmed-gone slug
    // with no map entry) is created here with an empty `lastAlertAt` (== due).
    // `lastAlertAt` is advanced only AFTER a successful send.
    for (const slug of openNow) {
      if (!map[slug]) {
        map[slug] = {
          sinceAt: iso(s1.onsetBySlug.get(slug) ?? nowMs),
          lastAlertAt: "",
        };
      }
    }

    // C1 CADENCE / OVERFLOW. Selection is by RE-POST-DUE-NESS + rotation, NOT an
    // alphabetical prefix. The three coupled bugs the old prefix-slice caused:
    //   1. overflow (the alphabetical tail beyond `maxSlugsInMessage`) was NEVER
    //      named and its `lastAlertAt` never advanced → those slugs stayed "due"
    //      every tick → the aggregate re-posted every 15m during a WIDE outage
    //      instead of hourly;
    //   2. a newly-opened slug that fell into overflow forced a post every 15m
    //      even though it could not be named;
    //   3. `lastAlertAt` was advanced for slugs the message never actually named.
    // The coherent model: a slug is DUE when it was never successfully sent
    // (empty/NaN `lastAlertAt`) or its last send aged past the re-post window.
    // We ROTATE — order the shown set so the slugs waiting LONGEST since their
    // last successful mention come first (an unset clock sorts oldest) — then
    // take up to `maxSlugsInMessage`. The post is GATED on at least one DUE slug
    // landing in the shown set, so a newly-opened overflow slug that cannot yet
    // be named does not force a 15m re-post. Only the DUE shown slugs advance
    // their clock (a not-due slug that happens to be shown to fill the message
    // keeps its clock), so no not-due slug's re-post clock is ever reset.
    const isDue = (slug: string): boolean => {
      const ageMs = nowMs - parseIso(map[slug]?.lastAlertAt ?? "");
      return Number.isNaN(ageMs) || ageMs >= repostMs;
    };
    // Rotation key: oldest last-mention first (empty clock == -Infinity == first).
    const lastMentionMs = (slug: string): number => {
      const t = parseIso(map[slug]?.lastAlertAt ?? "");
      return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
    };
    // Order: DUE before not-due; within a group, oldest-mentioned first; a
    // stable slug tie-break keeps the selection deterministic tick-to-tick.
    const ordered = [...openNow].sort((a, b) => {
      const da = isDue(a) ? 0 : 1;
      const db = isDue(b) ? 0 : 1;
      if (da !== db) return da - db;
      const la = lastMentionMs(a);
      const lb = lastMentionMs(b);
      if (la !== lb) return la - lb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const shownSlugs = ordered.slice(0, config.maxSlugsInMessage);
    const overflowCount = openNow.length - shownSlugs.length;
    // GATE: only post when a DUE slug is actually NAMED. If every shown slug is
    // already fresh (all the due slugs, if any, are folded into "+N more"), we
    // hold — a not-yet-nameable slug must not spawn a per-tick re-post.
    const shownDue = shownSlugs.filter((s) => isDue(s));
    // Slugs NEVER-YET-SENT (empty clock) among the named-and-due set — a genuine
    // OPEN this tick, for the log only. Captured before we advance the clock.
    const newlyNamed = shownDue.filter(
      (s) => (map[s]?.lastAlertAt ?? "") === "",
    );

    // POST the ONE aggregated outage message. Only advance lastAlertAt AFTER a
    // successful send (§7 dedupe discipline).
    if (shownDue.length > 0) {
      // Bucket-b: stamp the outage-DURATION line with `evidenceMs` (the confirm-
      // scan instant when a confirm ran, else the tick-start) — the instant the
      // gone evidence was actually observed — for consistency with the recovery
      // message and the `lastAlertAt` stamp, which both use `evidenceMs`.
      const text = outageMessage(shownSlugs, overflowCount, map, evidenceMs);
      try {
        await deps.postAlert(text);
        for (const slug of shownDue) {
          // Advance ONLY the DUE slugs that were NAMED in this message — one
          // successful send drives one shared re-post gate for the slugs it
          // actually reported. A not-due slug shown only to fill the message
          // keeps its own clock (it was already fresh); an overflow slug keeps
          // its clock too, so it rotates into the named positions on a later
          // tick (bounded forward progress). Stamp `evidenceMs` (the confirm-
          // scan instant when a confirm ran, else the tick-start) — the instant
          // the evidence was actually observed — mirroring the recovery post.
          if (map[slug]) map[slug].lastAlertAt = iso(evidenceMs);
        }
        logger.warn("d0-monitor.outage-alerted", {
          slugs: shownSlugs,
          overflow: overflowCount,
          newlyOpened: newlyNamed,
        });
      } catch (err) {
        // Leave lastAlertAt unadvanced → next 15m tick retries (§7/F9). The
        // OPEN entries persist so the outage is remembered.
        logger.error("d0-monitor.alert-send-failed", {
          err: err instanceof Error ? err.message : String(err),
          slugs: shownSlugs,
        });
      }
    }

    // CLOSE / recovery: a slug clears ONLY on positive fresh-healthy evidence
    // (§5.2 F1) — absence-of-gone is NOT recovery. Slugs that are neither
    // confirmed-gone nor fresh-healthy HOLD (inconclusive).
    const recovered: Array<{ slug: string; sinceAt: string }> = [];
    for (const slug of Object.keys(map)) {
      if (confirmed.has(slug)) continue; // still gone → keep open
      if (healthy.has(slug)) {
        recovered.push({ slug, sinceAt: map[slug].sinceAt });
      }
      // else HOLD: inconclusive (stale/no fresh evidence) — do not clear.
    }
    if (recovered.length > 0) {
      // Stamp the confirm-scan instant (when the recovery was actually
      // observed), not the tick-start — the two differ by the confirm delay.
      const text = recoveryMessage(recovered, evidenceMs);
      try {
        await deps.postAlert(text);
        for (const r of recovered) delete map[r.slug]; // clear AFTER send (§5.2)
        logger.warn("d0-monitor.recovery-alerted", {
          slugs: recovered.map((r) => r.slug),
        });
      } catch (err) {
        // Leave the entries in the map → next tick retries the recovery post.
        logger.error("d0-monitor.recovery-send-failed", {
          err: err instanceof Error ? err.message : String(err),
          slugs: recovered.map((r) => r.slug),
        });
      }
    }

    // Bucket-b: persist only when the map actually CHANGED this tick (an OPEN,
    // a re-post clock advance, or a recovery clear). A pure no-op tick — the
    // steady all-healthy case that is the overwhelming majority — skips the
    // `putSet` write, avoiding a needless PocketBase round-trip every 15m.
    if (JSON.stringify(map) !== mapBefore) {
      await saveMap(map, nowMs);
    }
  }

  return {
    async tick(): Promise<void> {
      if (ticking) return;
      ticking = true;
      try {
        await runTick();
      } catch (err) {
        // tick() never rejects — the scheduler must never wedge on this monitor.
        logger.error("d0-monitor.tick-failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        ticking = false;
      }
    },
  };
}
