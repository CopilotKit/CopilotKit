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
import type { CellGoneInput, RegistryDoc } from "./d0-gone-predicate.js";

/** §5.1 stable synthetic rule id (the monitor is a bespoke cron, not a YAML rule). */
export const PROD_D0_GONE_RULE_ID = "prod-d0-gone-monitor";

/** §2.5 idle-window multiplier — 3× the longest resolved producer period, matching
 *  the family-silence monitor's `SILENCE_PERIOD_MULTIPLIER = 3` ("no longer a
 *  single missed window"). Bound to the same cadence math so the two monitors
 *  cannot disagree about whether the fleet is producing. */
export const PRODUCER_IDLE_PERIOD_MULTIPLIER = 3;

/** §8 defaults (all overridable via `PROD_D0_MONITOR_*`). */
export const DEFAULT_CONFIRM_DELAY_MS = 60_000;
export const DEFAULT_REPOST_MINUTES = 60;
export const DEFAULT_MAX_SLUGS_IN_MESSAGE = 25;

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
  const num = (raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw.trim() === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    confirmDelayMs: num(
      env.PROD_D0_MONITOR_CONFIRM_DELAY_MS,
      DEFAULT_CONFIRM_DELAY_MS,
    ),
    repostMinutes: num(
      env.PROD_D0_MONITOR_REPOST_MINUTES,
      DEFAULT_REPOST_MINUTES,
    ),
    maxSlugsInMessage: num(
      env.PROD_D0_MONITOR_MAX_SLUGS_IN_MESSAGE,
      DEFAULT_MAX_SLUGS_IN_MESSAGE,
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
 * Load the generated `registry.json` the monitor enumerates wired cells from.
 * Mirrors the established probe-driver resolver (`d4-chat-roundtrip.ts`):
 * `REGISTRY_JSON_PATH` env override, fallback `/app/data/registry.json` (copied
 * in by the harness Dockerfile). Degrades to an empty doc on missing/parse
 * error and logs — a misconfigured image must not crash the control-plane; the
 * monitor then enumerates zero wired cells (fails safe: never pages).
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
  } catch (err) {
    logger.warn("d0-monitor.registry-load-failed", {
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
  /** The wired+supported cell universe, keyed by slug (§2.4 / page-stats). */
  registry: RegistryDoc;
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
 * §2.5 producer-liveness predicate. The producer is LIVE iff EITHER:
 *   1. any family has a non-null `inflight` (a batch is running right now), OR
 *   2. the freshest activity across families is within the idle window
 *      (3× the longest resolved producer period) AND ≥1 worker is online.
 * Otherwise IDLE (paused/stalled). Derived ONLY from `/api/runs` + the worker
 * heartbeat strip — never from comm-error freshness (which would be circular).
 */
export function isProducerLive(
  body: FamilySummaryResponse,
  idleWindowMs: number,
  nowMs: number,
): boolean {
  if (body.families.some((f) => f.inflight != null)) return true;
  let freshest = Number.NaN;
  for (const f of body.families) {
    const a = latestActivityMs(f);
    if (!Number.isNaN(a) && (Number.isNaN(freshest) || a > freshest)) {
      freshest = a;
    }
  }
  if (Number.isNaN(freshest)) return false;
  return nowMs - freshest <= idleWindowMs && anyWorkerOnline(body.workers);
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
    return p > max ? p : max;
  }, 0);
  const idleWindowMs = PRODUCER_IDLE_PERIOD_MULTIPLIER * longestPeriodMs;

  // The wired+supported cell universe (§2.4) — same enumeration the dashboard's
  // page-stats iterates. Fixed at construction (registry is generated at boot).
  const cellsBySlug = wiredSupportedCells(deps.registry);

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
    let page = 1;
    // Full rows (default fields incl. signal); large perPage to bound round-trips.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await deps.pb.list<StatusRow>("status", {
        page,
        perPage: 500,
        skipTotal: false,
      });
      rows.push(...res.items);
      if (page >= res.totalPages || res.items.length === 0) break;
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

    for (const [slug, cells] of cellsBySlug) {
      if (cells.length === 0) continue; // zero-wired column fails safe (§2.4)
      const models: CellGoneInput[] = cells.map((c) => {
        const m = buildCellModel(
          live,
          {
            slug: c.slug,
            featureId: c.featureId,
            isSupported: true,
            isWired: true,
          },
          nowMs,
        );
        return {
          achievedDepth: m.achievedDepth,
          chipColor: m.chipColor,
          isStaleCell: m.isStaleCell,
          surfaceState: m.surfaceState,
        };
      });
      if (columnGone(models)) {
        gone.add(slug);
        // Earliest red-D0 onset among the column's contributing rows (§2.4).
        let earliest = Number.NaN;
        for (const cell of cells) {
          for (const row of live.values()) {
            // A row belongs to this slug's column when its key names the slug.
            if (row.state === "red" && row.key.includes(`:${cell.slug}`)) {
              const t = parseIso(row.first_failure_at ?? row.observed_at);
              if (
                !Number.isNaN(t) &&
                (Number.isNaN(earliest) || t < earliest)
              ) {
                earliest = t;
              }
            }
          }
        }
        onsetBySlug.set(slug, Number.isNaN(earliest) ? nowMs : earliest);
      } else if (columnFreshHealthy(models)) {
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

  function outageMessage(
    slugs: string[],
    map: OutageMap,
    nowMs: number,
  ): string {
    const shown = slugs.slice(0, config.maxSlugsInMessage);
    const overflow = slugs.length - shown.length;
    const bullets = shown
      .map((slug) => {
        const since = map[slug]?.sinceAt;
        const sinceMs = parseIso(since);
        const dur = Number.isNaN(sinceMs)
          ? ""
          : ` (${humanizeDuration(nowMs - sinceMs)})`;
        return `• \`${slug}\` — gone since ${since ?? "unknown"}${dur}`;
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
        return `• \`${r.slug}\` — was gone ${r.sinceAt}→${iso(nowMs)}${dur}`;
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
      logger.warn("d0-monitor.summary-read-failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    if (body === null || !isProducerLive(body, idleWindowMs, nowMs)) {
      if (!suspendedLogged) {
        logger.warn("d0-monitor.suspended-producer-idle", {
          idleWindowMs,
          reason: body === null ? "summary-unavailable" : "producer-idle",
        });
        suspendedLogged = true;
      }
      return; // SUSPENDED: hold ALL prior state, no OPEN/CLOSE/re-post.
    }
    suspendedLogged = false;

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

    // §3: if S1 empty, no confirm scan — go straight to recovery-check with S1.
    let confirmed = new Set<string>(s1.gone);
    let scan2 = s1;
    if (s1.gone.size > 0) {
      // §3 CONFIRM SCAN — wait, then re-READ (never re-probe). Both must agree.
      await sleep(config.confirmDelayMs);
      const now2 = deps.now();
      let rows2: StatusRow[];
      try {
        rows2 = await readStatusRows();
      } catch (err) {
        logger.warn("d0-monitor.read-failed", {
          err: err instanceof Error ? err.message : String(err),
          phase: "confirm",
        });
        return; // inconclusive confirm read — do not OPEN this tick.
      }
      scan2 = scan(rows2, now2);
      confirmed = new Set([...s1.gone].filter((slug) => scan2.gone.has(slug)));
      const blips = [...s1.gone].filter((slug) => !scan2.gone.has(slug));
      if (blips.length > 0) {
        logger.info("d0-monitor.blip-rejected", {
          slugs: blips,
          scan1At: iso(nowMs),
          scan2At: iso(now2),
        });
      }
    }

    // §5.2 STATE MACHINE. Confirmed-gone = C; fresh-healthy = H (from the LATEST
    // authoritative scan — scan2 when a confirm ran, else s1).
    const healthy = scan2.healthy;
    const map = await loadMap();
    const repostMs = config.repostMinutes * 60_000;

    // OPEN + hourly re-post: build the set of slugs to include in an alert this
    // tick (new opens OR due re-posts).
    const openNow = [...confirmed].sort();
    const toAlert: string[] = [];
    for (const slug of openNow) {
      const existing = map[slug];
      if (!existing) {
        // OPEN: record sinceAt (earliest onset, fallback now). lastAlertAt set
        // AFTER a successful send below.
        map[slug] = {
          sinceAt: iso(s1.onsetBySlug.get(slug) ?? nowMs),
          lastAlertAt: "",
        };
        toAlert.push(slug);
      } else {
        const ageMs = nowMs - parseIso(existing.lastAlertAt);
        if (Number.isNaN(ageMs) || ageMs >= repostMs) {
          toAlert.push(slug); // hourly re-post due (or never successfully sent)
        }
        // else: persist, no post (15m detect, 1h alert not yet due).
      }
    }

    // POST the ONE aggregated outage message (all currently-gone slugs). Only
    // advance lastAlertAt AFTER a successful send (§7 dedupe discipline).
    if (toAlert.length > 0) {
      const text = outageMessage(openNow, map, nowMs);
      try {
        await deps.postAlert(text);
        for (const slug of openNow) {
          // Every currently-open slug's cadence advances on a successful post.
          if (map[slug]) map[slug].lastAlertAt = iso(nowMs);
        }
        logger.warn("d0-monitor.outage-alerted", {
          slugs: openNow,
          newlyOpened: openNow.filter((s) => toAlert.includes(s)),
        });
      } catch (err) {
        // Leave lastAlertAt unadvanced → next 15m tick retries (§7/F9). The
        // OPEN entries persist so the outage is remembered.
        logger.error("d0-monitor.alert-send-failed", {
          err: err instanceof Error ? err.message : String(err),
          slugs: openNow,
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
      const text = recoveryMessage(recovered, nowMs);
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

    await saveMap(map, nowMs);
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
