#!/usr/bin/env npx tsx
/**
 * reconcile-staging.ts — CI-owned scheduled self-heal for the showcase
 * STAGING fleet.
 *
 * Replaces Railway's registry auto-watch (which we are disabling) with a
 * deterministic, CI-controlled reconcile. On a 15-minute cadence it compares
 * each staging showcase service's ACTUALLY-DEPLOYED image digest against the
 * GHCR `:latest` digest for that service's repo. When a service's deployed
 * digest LAGS `:latest`, the reconcile re-runs the existing staging redeploy
 * (`redeploy-env.ts`) scoped to just the lagging services and posts a Slack
 * alert naming them — alert-AND-remediate, not alert-only.
 *
 * Why this exists: staging floats on the mutable `:latest` tag. Railway's
 * registry auto-watch used to notice a new `:latest` push and redeploy the
 * service. Disabling that watch removes the self-heal, so this workflow is the
 * deterministic replacement — CI owns the "is staging actually running the
 * latest image?" question and re-triggers the redeploy that already exists.
 *
 * ── Deployed-digest mechanism ──────────────────────────────────────────────
 * Railway stores TAG-ONLY refs in `serviceInstance.source.image`
 * (`ghcr.io/copilotkit/<repo>:latest`), so the running digest is NOT
 * recoverable from that field. The real running digest lives on the latest
 * SUCCESS deployment's `meta.imageDigest` (a `sha256:…` value). This mirrors
 * `showcase/bin/railway`'s `staging_running_digest` and the harness
 * `image-drift` probe.
 *
 * ── Threshold (v1) ─────────────────────────────────────────────────────────
 * A service is treated as LAGGING on a plain digest MISMATCH
 * (`deployedDigest !== latestDigest`). A precise "how long has it been
 * lagging?" signal is not cheaply available from a single Railway read, so v1
 * uses the mismatch alone. Re-running the staging redeploy is idempotent (it
 * just triggers another redeploy of an image that is already `:latest`), so a
 * transient duplicate remediation is harmless. A deployed digest that cannot be
 * resolved (no SUCCESS deployment / no `meta.imageDigest`) is recorded as an
 * ERROR and SURFACED — it is NOT silently counted as up-to-date and it is NOT
 * redeployed (re-deploying on that ambiguous signal would risk churn without a
 * clear win), but it never masquerades as a healthy "current with :latest"
 * service.
 *
 * ── Debounce (WINDOWED — why a single blip must not page, but flapping must) ──
 * The fail-loud "unconfirmed" verdict is DEBOUNCED over a SLIDING WINDOW of the
 * most recent reconcile cycles. A service pages when it has been unconfirmed on
 * at least `DEFAULT_DEBOUNCE_THRESHOLD` (N=2) of the last `DEFAULT_DEBOUNCE_WINDOW`
 * (M=3) cycles — an N-of-M window, NOT N strictly-consecutive cycles. Both N and
 * M are env-overridable (`RECONCILE_DEBOUNCE_THRESHOLD` / `RECONCILE_DEBOUNCE_WINDOW`).
 * With the N=2/M=3 default:
 *   • a SINGLE-cycle blip `[x, ., .]` = 1/3 → stays silent (debounced);
 *   • TWO CONSECUTIVE `[x, x]` = 2/2 → pages on the 2nd cycle;
 *   • FLAPPING `[x, ., x]` = 2/3 → pages on the 3rd cycle.
 * The window is what makes flapping page: a purely consecutive counter reset to
 * zero on every intervening healthy cycle, so a service that was unconfirmed
 * every OTHER cycle never reached the threshold and NEVER paged — real drift that
 * flaps was silently missed. The window remembers the last M outcomes (including
 * the healthy ones), so an every-other-cycle flap reaches 2/3 and pages.
 *
 * The single-cycle blips this must still suppress: chiefly the redeploy race on a
 * service that keeps exactly one SUCCESS deployment at a time (e.g.
 * `harness-workers`) — mid-redeploy the prior SUCCESS has flipped to REMOVED
 * while the new one is still in-progress, so the deployed digest resolves to
 * null for exactly one cycle; and the transient Railway-read classes (an HTTP
 * 500, a request timeout, a platform "deploys paused" blip). All of these land
 * in the `unconfirmed` set, so the debounce is applied UNIFORMLY at the verdict
 * level rather than per-cause. A condition that PERSISTS or FLAPS — genuine
 * producer/consumer drift (the PR #5352 stale-image class) or a sustained outage
 * — reaches N-of-M and pages, so real drift is never silenced. Remediation of a
 * genuine lag is NOT debounced (it is idempotent and self-heals every cycle);
 * only the fail-loud page + non-zero exit wait for the N-of-M window.
 *
 * The per-service sliding window must survive BETWEEN stateless scheduled runs,
 * so the workflow persists it via `actions/cache` (a tiny JSON file whose path is
 * passed as `RECONCILE_DEBOUNCE_STATE`) — see `applyDebounce`,
 * `loadDebounceState`/`saveDebounceState`, and the cache restore/save steps in
 * showcase_reconcile_staging.yml. An OLD-shape cache entry from before this change
 * (the pre-windowed `{svc: number}` count) is treated as an empty window — one
 * cycle of extra delay, never a throw.
 *
 * ── Local / no-state runs FAIL LOUD ─────────────────────────────────────────
 * A local/manual one-shot `npx tsx reconcile-staging.ts` has NO persistable state
 * backend (`RECONCILE_DEBOUNCE_STATE` is unset), so cross-run debouncing is
 * meaningless — each run stands alone. Such a run therefore uses N=1/M=1
 * (page on the FIRST unconfirmed cycle) so it fails loud (exit 1) on real drift
 * instead of maxing the window at 1/3 and always exiting 0. Only the stateful CI
 * path debounces; see `main`.
 *
 * The newest running digest is the newest SUCCESS deployment BY `createdAt`
 * (descending) — Railway's `deployments()` connection order is not contracted,
 * so the reconcile sorts explicitly rather than trusting API ordering.
 *
 * ── The invariant (the ONE organizing rule) ─────────────────────────────────
 * A reconcile run is GREEN (exit 0) IF AND ONLY IF EVERY in-scope staging
 * service was either POSITIVELY CONFIRMED CURRENT or was a lag whose
 * remediation redeploy CLEANLY fixed it (no failures, no drops). A cleanly
 * remediated lag still posts an INFORMATIONAL Slack alert (alert-AND-remediate)
 * yet exits 0. Any service that is NOT confirmed current or cleanly remediated
 * — for ANY reason — lands in the single `unconfirmed` set, which (once it has
 * reached the N-of-M debounce window — see the Debounce note above) drives
 * BOTH a Slack alert naming the services + the reason AND a non-zero exit. There
 * are no scattered per-cause special-cases: the exit code and the alert are both
 * derived from the debounced subset of that one set (`pageableUnconfirmed`).
 *
 * A service is NOT confirmed current when:
 *   • it is LAGGING (`deployed !== latest`) and its remediation redeploy did
 *     not CLEARLY remediate IT — there is no `status:"ok"` per-service record
 *     for it (it was dropped/skipped, or its own redeploy failed). This is
 *     matched PER-SERVICE, not by comparing the post-expansion `attempted`
 *     count against `lagging.length` (imageOf expansion inflates `attempted`
 *     and could numerically mask a dropped lag — the A16 hole). An INCIDENTAL
 *     expansion-redeploy failure of an ALREADY-CURRENT consumer does NOT count
 *     — it was verified on `:latest` at check time (A19);
 *   • its DEPLOYED digest is null/unresolvable — no SUCCESS deployment, no
 *     parseable `meta.imageDigest`, or the newest SUCCESS was pushed out of the
 *     `deployments(first:10)` window by >10 newer non-SUCCESS deploys;
 *   • its GHCR `:latest` digest is null/empty;
 *   • a per-service Railway/GHCR read threw;
 *   • the in-scope set was EMPTY (`emptyScope`, i.e. `services.length === 0` — a
 *     run that checked nothing is NOT green, mirroring the autoUpdates gate's
 *     zero-checked floor). Like every unconfirmed condition it is DEBOUNCED: the
 *     `(scope)` entry pages + red-exits only once it has reached the
 *     N-of-M window (a single-cycle empty scope stays silent). NOTE: an all-errored
 *     run (scope non-empty but every service faulted) is NOT `emptyScope` — each
 *     faulted service contributes its own entry to the `unconfirmed` set via
 *     `errors`.
 *
 * A LAGGING service whose remediation redeploy CLEARLY succeeded (no failures,
 * no drops) is confirmed-in-progress: the run still posts an informational
 * alert (alert-AND-remediate) but exits 0, and it will match `:latest` on the
 * next cycle. An UNDELIVERED alert alongside a lag also fails loud, but it too
 * is DEBOUNCED: the undelivered-alert condition is folded into the invariant set
 * under the synthetic `(alert)` key, so a single transient Slack non-2xx on a
 * benign remediated lag does NOT red the first cycle — it pages only once it
 * reaches the N-of-M window (see `alerted` / `reconcileStaging`).
 *
 * `alerted` reflects ACTUAL delivery: it is true only when the Slack webhook
 * POST returned 2xx. A missing webhook, a non-2xx response, or a thrown request
 * all leave `alerted === false` so a swallowed alert never reads as success.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   npx tsx showcase/scripts/reconcile-staging.ts
 *
 * Auth: RAILWAY_TOKEN env var or ~/.railway/config.json (Railway reads +
 * redeploy), GHCR_TOKEN / GITHUB_TOKEN (GHCR manifest reads), and
 * SLACK_WEBHOOK_OSS_ALERTS (incoming webhook for the alert — the SAME secret
 * showcase_build.yml posts its failure alerts through).
 *
 * Exit code: 0 on a clean reconcile (including a fully-remediated lag), and on
 * any below-window cycle whose unconfirmed condition has not YET reached N-of-M.
 * A partial redeploy failure, a redeploy that threw, a per-service read fault, or
 * an undelivered lag alert fail loud with a non-zero exit ONLY once the condition
 * has reached the N-of-M window (see the Debounce note and the fail-loud contract
 * above). A per-service Railway read that ERRORS — an unreachable API, an HTTP
 * 500, a request timeout, a "deploys paused" blip — is caught per-service and
 * folded into that same debounced `errors`/`unconfirmed` set, so it too pages
 * only once it reaches the N-of-M window; a TOTAL Railway outage therefore exits
 * 0 on the early cycles and pages on cycle 2 (intended — transient Railway faults
 * were among the false pages this debounce suppresses). The ONE thing NOT
 * debounced is a hard config error — a MISSING/INVALID Railway TOKEN — which
 * exits 1 immediately from `getRailwayToken`/`main` before the reconcile decision
 * core runs.
 *
 * ── Known limitation (OUT of scope here — separate follow-up) ────────────────
 * A PERSISTENT lag whose remediation redeploy is ACCEPTED (`runRedeploy` reports
 * a `status:"ok"` record for it every cycle) but never actually CONVERGES —
 * `:latest` keeps out-running the deployed digest — is treated as remediated each
 * cycle and does NOT escalate: the per-service record reads ok, so the service is
 * confirmed-in-progress rather than unconfirmed, and it never enters the debounce
 * window. Detecting a redeploy that is accepted-but-non-converging needs a
 * distinct signal (e.g. tracking how many consecutive cycles a service has been
 * lagging DESPITE an accepted redeploy) and is deliberately not addressed here.
 */

import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { dirname } from "path";
import {
  CI_BUILT_SERVICES,
  ENV_ID_BY_NAME,
  PROJECT_ID,
  SERVICES,
  repoNameFor,
} from "./railway-envs";
import {
  RAILWAY_GRAPHQL_ENDPOINT,
  sanitizeErrorBody,
} from "./lib/railway-graphql";
import { RailwayTokenError, resolveRailwayToken } from "./lib/railway-token";
import { resolveGhcrDigest } from "./deploy-to-railway";
import { makeLiveRedeploy, runRedeploy } from "./redeploy-env";
import type { RedeployServiceRecord } from "./redeploy-env";

// ── Pure decision core (unit-tested without network) ───────────────────────

/**
 * Default debounce THRESHOLD (N) for the fail-loud "unconfirmed" verdict: a
 * service pages only once it has been unconfirmed on at least N of the last M
 * (`DEFAULT_DEBOUNCE_WINDOW`) reconcile cycles — a sliding N-of-M window, not N
 * strictly-consecutive cycles. At the 15-minute cadence, N=2/M=3 keeps a single
 * blip silent while paging on either two consecutive OR a two-of-three flap
 * within ~45 min. Overridable at runtime via `RECONCILE_DEBOUNCE_THRESHOLD` (see
 * `main`). The pure library default (`reconcileStaging`) is N=1/M=1 — "no
 * debounce, page on the first cycle" — so the invariant unit tests exercise the
 * raw verdict; production wires these constants.
 */
export const DEFAULT_DEBOUNCE_THRESHOLD = 2;

/**
 * Default debounce WINDOW (M): the size of the sliding window of recent cycles
 * over which the threshold (N) is counted. A service pages when it was
 * unconfirmed on ≥N of the last M cycles. M=3 with N=2 pages on two consecutive
 * cycles AND on a two-of-three flap. Overridable via `RECONCILE_DEBOUNCE_WINDOW`
 * (see `main`); clamped to be ≥N so a misconfigured window can never make paging
 * impossible.
 */
export const DEFAULT_DEBOUNCE_WINDOW = 3;

/**
 * Per-service SLIDING WINDOW of the last M reconcile outcomes, carried BETWEEN
 * scheduled runs. Keyed by SSOT service key (or a synthetic label like
 * `(scope)`/`(alert)`); the value is a bounded list (length ≤ M) of the most
 * recent outcomes, oldest→newest, where `true` = UNCONFIRMED that cycle and
 * `false` = confirmed. Unlike the old consecutive counter, a service is NOT
 * dropped the moment it is confirmed once — a `false` is appended so the window
 * remembers the healthy cycle (this is what lets a flap reach N-of-M). A service
 * whose window holds NO `true` is dropped (absent). Persisted as a small JSON
 * object via `actions/cache`.
 */
export type DebounceWindows = Record<string, boolean[]>;

/**
 * Coerce a persisted/prior window value into a clean bounded boolean[]. A
 * non-array (chiefly the OLD `{svc: number}` count shape from before the windowed
 * change, but also any garbage) becomes an empty window — a one-cycle delay, not
 * a throw. Non-boolean elements are dropped and the result is trimmed to the M
 * most recent entries.
 */
function normalizeWindow(w: unknown, window: number): boolean[] {
  if (!Array.isArray(w)) return [];
  const bools = w.filter((x): x is boolean => typeof x === "boolean");
  return bools.slice(-window);
}

/**
 * The debounce decision, pure and unit-testable. Given the PRIOR per-service
 * sliding windows and THIS cycle's `unconfirmed` set, returns:
 *   • `nextWindows` — the windows to persist for the next cycle. For every
 *     service that is EITHER unconfirmed this cycle OR already had a prior
 *     window, the current outcome is appended (`true` if unconfirmed this cycle,
 *     else `false`) and the window is trimmed to the last `window` (M) entries.
 *     A service whose resulting window holds no `true` is dropped (absent) so the
 *     state stays bounded. A single service may appear in `unconfirmed` more than
 *     once (different reasons); it advances its window ONCE.
 *   • `pageable` — the subset of `unconfirmed` (this cycle's entries, all reasons
 *     kept) whose service has now been unconfirmed on ≥ `threshold` (N) of the
 *     last M cycles. This is the set that drives the Slack page + non-zero exit.
 *     Below N-of-M the entry is retained in `unconfirmed` for logging but does
 *     not page. (The window's `true` count only ever rises on an unconfirmed
 *     cycle, so the cycle a service crosses N is always a cycle it is unconfirmed
 *     — a service confirmed THIS cycle is never newly pageable.)
 */
export function applyDebounce(args: {
  unconfirmed: UnconfirmedService[];
  priorWindows: DebounceWindows;
  threshold: number;
  window: number;
}): { nextWindows: DebounceWindows; pageable: UnconfirmedService[] } {
  const { unconfirmed, priorWindows, threshold, window } = args;
  const unconfirmedServices = new Set(unconfirmed.map((u) => u.service));
  // Advance the window for every service in play: those unconfirmed this cycle
  // AND those merely carrying a prior window (they get a `false` so the window
  // remembers the healthy cycle — the flap-detection linchpin).
  const tracked = new Set<string>([
    ...Object.keys(priorWindows),
    ...unconfirmedServices,
  ]);
  const nextWindows: DebounceWindows = {};
  const pageableServices = new Set<string>();
  for (const svc of tracked) {
    const prior = normalizeWindow(priorWindows[svc], window);
    const next = [...prior, unconfirmedServices.has(svc)].slice(-window);
    const unconfirmedCount = next.filter(Boolean).length;
    // Drop a service whose window no longer records ANY unconfirmed cycle.
    if (unconfirmedCount === 0) continue;
    nextWindows[svc] = next;
    if (unconfirmedCount >= threshold) pageableServices.add(svc);
  }
  // pageable ⊆ this cycle's unconfirmed entries (keeping all reasons, in order);
  // a service pageable-by-window but confirmed this cycle has no reason entry and
  // is naturally excluded.
  const pageable = unconfirmed.filter((u) => pageableServices.has(u.service));
  return { nextWindows, pageable };
}

/**
 * A resolved (service, deployedDigest, latestDigest) tuple for one staging
 * service. `deployedDigest` is null when Railway had no SUCCESS deployment /
 * no `meta.imageDigest` to read. Both digests are normalized `sha256:<hex>`
 * strings (or null).
 */
export interface ServiceDigestPair {
  service: string;
  repoName: string;
  deployedDigest: string | null;
  latestDigest: string;
}

/**
 * Redeploy outcome the orchestrator threads into the Slack alert. Mirrors the
 * tally `redeploy-env.ts`'s `runRedeploy` returns, PLUS the per-service
 * `records` — the reconcile confirms remediation PER-SERVICE (each lagging
 * service must have a `status:"ok"` record) rather than comparing the
 * post-expansion `attempted` count against the pre-expansion lagging count
 * (imageOf expansion inflates `attempted`, which can numerically MASK a
 * dropped lagging service — the A16 hole).
 */
export interface RedeployReport {
  attempted: number;
  succeeded: number;
  failed: number;
  /** Per-service outcomes (post-expansion), matched by service key. */
  records: RedeployServiceRecord[];
}

export interface ReconcileDeps {
  /**
   * SSOT keys of the staging services to reconcile. Defaults to
   * `stagingReconcileServices()` (CI-built services that declare a staging
   * env). Injectable so the test can pin a small fixed scope.
   */
  services?: string[];
  /**
   * Resolve the digest currently DEPLOYED on the staging serviceInstance.
   * Returns null when no running digest is resolvable.
   */
  fetchDeployedDigest: (
    serviceId: string,
    environmentId: string,
  ) => Promise<string | null>;
  /** Resolve the GHCR `:latest` digest for a repo name. */
  fetchLatestDigest: (repoName: string) => Promise<string>;
  /**
   * Trigger a staging redeploy scoped to the given SSOT keys. Returns the
   * per-run tally.
   */
  redeployStaging: (services: string[]) => Promise<RedeployReport>;
  /**
   * Post a Slack alert with the given text. Returns true only when the alert
   * was ACTUALLY delivered (a 2xx POST); false on a missing webhook, a non-2xx
   * response, or a thrown request. The caller records the returned value as
   * `summary.alerted` so a swallowed alert never reads as a delivered one.
   */
  postSlackAlert: (text: string) => Promise<boolean>;
  /** Progress logger. Defaults to console.log. */
  log?: (line: string) => void;
  /**
   * Debounce THRESHOLD (N) for the fail-loud "unconfirmed" verdict — a service
   * pages when unconfirmed on ≥N of the last M (`debounceWindow`) cycles (see
   * `applyDebounce`). Defaults to 1 so the invariant unit tests exercise the raw
   * verdict. Production wires `DEFAULT_DEBOUNCE_THRESHOLD` (2).
   */
  debounceThreshold?: number;
  /**
   * Debounce WINDOW (M): the sliding-window size over which the threshold (N) is
   * counted. Defaults to `debounceThreshold` (i.e. N-of-N = strictly
   * consecutive) when omitted, so a caller that sets only the threshold keeps the
   * simple consecutive behavior; production wires `DEFAULT_DEBOUNCE_WINDOW` (3)
   * to catch flapping. Clamped to ≥N internally.
   */
  debounceWindow?: number;
  /**
   * Load the PRIOR per-service sliding windows persisted by the previous
   * scheduled run (via `actions/cache`). Returns {} when there is no prior
   * state. When omitted, prior windows default to {} (each cycle stands alone —
   * only meaningful with a N=1/M=1 immediate policy, i.e. the local no-state run).
   */
  loadDebounceState?: () => Promise<DebounceWindows>;
  /**
   * Persist the UPDATED per-service sliding windows for the next scheduled run to
   * read. Called once per cycle, before the run exits, so the window survives
   * between stateless runs. When omitted, state is not saved.
   */
  saveDebounceState?: (windows: DebounceWindows) => Promise<void>;
}

/**
 * One in-scope service that could NOT be positively confirmed current, with a
 * human-readable reason. This is the atom of the invariant: the reconcile is
 * green iff the `unconfirmed` set is empty. `service` may be a synthetic label
 * (e.g. `(redeploy)` / `(scope)`) for a fleet-level shortfall that is not
 * attributable to a single service.
 */
export interface UnconfirmedService {
  service: string;
  reason: string;
}

export interface ReconcileSummary {
  /**
   * Count of services SUCCESSFULLY COMPARED — both the deployed digest and the
   * GHCR `:latest` digest resolved (i.e. `pairs.length`). This INCLUDES any
   * found lagging; it is NOT a positively-current count (that is
   * `checked - lagging.length`). Services whose digest read errored are not
   * counted here — they land in `errors`/`unconfirmed`.
   */
  checked: number;
  lagging: string[];
  errors: { service: string; error: string }[];
  redeployed: boolean;
  /** True only when a Slack alert was ACTUALLY delivered (2xx POST). */
  alerted: boolean;
  /**
   * The remediation redeploy tally, or null when no redeploy ran. Threaded out
   * so a partial (`failed > 0`) or dropped (`attempted < lagging.length`)
   * remediation flows into `unconfirmed`.
   */
  redeployReport: RedeployReport | null;
  /**
   * THE INVARIANT SET: every in-scope service NOT positively confirmed current
   * this cycle, with its reason — PLUS the synthetic `(alert)` entry when a lag
   * was remediated but its Slack alert did not deliver. This is the RAW,
   * pre-debounce set: it is surfaced for logging (an operator sees a condition
   * building toward a page), but the exit code and the Slack page are derived
   * from the DEBOUNCED subset (`pageableUnconfirmed`), not from this set — a
   * single-cycle blip is present here yet does not red the run. There are no
   * separate per-cause special-cases: every non-green cause flows through here.
   */
  unconfirmed: UnconfirmedService[];
  /**
   * THE DEBOUNCED INVARIANT SET: the subset of `unconfirmed` whose service has
   * been unconfirmed on ≥N of the last M cycles and therefore actually PAGES this
   * cycle. The Slack alert and the exit code are derived from THIS set, not the
   * raw `unconfirmed` — a single-cycle blip is present in `unconfirmed` (for
   * logging) but absent here (debounced). With the default N=1/M=1 this equals
   * `unconfirmed`.
   */
  pageableUnconfirmed: UnconfirmedService[];
  /**
   * The per-service sliding windows to persist for the next cycle (the output of
   * `applyDebounce`). Threaded out for the CI log so an operator can see a
   * below-window service being debounced (e.g. "1/2 within a 3-cycle window").
   */
  debounceWindows: DebounceWindows;
  /**
   * True when the in-scope set was empty (`services.length === 0`) — the run
   * checked nothing, which is NOT green. Recorded as its own field for the alert
   * text; it also contributes a `(scope)` entry to `unconfirmed`, which is
   * DEBOUNCED like every other condition (it pages only once it reaches the
   * N-of-M window).
   */
  emptyScope: boolean;
}

/**
 * Normalize a digest for comparison: trim + lowercase. null passes through.
 * GHCR's Docker-Content-Digest and Railway's meta.imageDigest are both
 * `sha256:<hex>`, but normalizing guards against stray casing/whitespace.
 */
function normalizeDigest(d: string | null): string | null {
  if (d === null) return null;
  const t = d.trim().toLowerCase();
  return t === "" ? null : t;
}

/**
 * The reconcile decision, pure and unit-testable. A service is LAGGING when
 * its deployed digest resolved (non-null) AND differs from the GHCR `:latest`
 * digest. A null deployed digest is NOT lagging (see the threshold note in the
 * file header). Returns the lagging SSOT keys, sorted for stable output.
 */
export function selectLaggingServices(pairs: ServiceDigestPair[]): string[] {
  return pairs
    .filter(
      (p) => p.deployedDigest !== null && p.deployedDigest !== p.latestDigest,
    )
    .map((p) => p.service)
    .sort();
}

/**
 * The default reconcile scope: every staging service that floats `:latest`.
 * That is BOTH:
 *   • every CI-built service that declares a staging env (it floats `:latest`
 *     in staging and is redeployed by the build's staging redeploy), AND
 *   • every `imageOf` consumer that declares a staging env — a service that
 *     runs another (CI-built) service's image on its OWN serviceInstance
 *     (e.g. `harness-workers` runs the `showcase-harness` image). A consumer
 *     tracks the same `:latest` but has an INDEPENDENT deployment history, so
 *     it can drift from its producer (the PR #5352 regression: `harness`
 *     bounced, `harness-workers` left running the stale image). Excluding it
 *     from the reconcile scope would leave that drift undetected — and it IS
 *     remediable, since `runRedeploy`/`resolveTargetServices` honor any SSOT
 *     key and `expandImageConsumers` redeploys consumers — so include it.
 *
 * Its GHCR `:latest` is checked against `repoNameFor(consumer, "staging")`,
 * which resolves to the producer's repo via the consumer's `repoName`
 * override; its deployed digest is read from the consumer's own
 * serviceInstance. Sorted for stable iteration.
 */
export function stagingReconcileServices(): string[] {
  const scope = new Set<string>();
  for (const [name, entry] of Object.entries(SERVICES)) {
    if (!Object.hasOwn(entry.environments, "staging")) continue;
    if (CI_BUILT_SERVICES.has(name) || entry.imageOf !== undefined) {
      scope.add(name);
    }
  }
  return [...scope].sort();
}

/**
 * Compute the ONE invariant set — every in-scope service NOT positively
 * confirmed current, with its reason — from the raw reconcile facts. This is the
 * single place the "not confirmed current" cases from the header contract are
 * enumerated. It returns the RAW (pre-debounce) set; `reconcileStaging` then
 * DEBOUNCES it (via `applyDebounce`) and the exit code and the Slack page derive
 * from that debounced subset (`pageableUnconfirmed`), so a single-cycle blip
 * surfaced here does not itself red the run.
 *
 * Sources of "unconfirmed":
 *   • per-service digest-read faults (`errors`) — null/unresolvable deployed
 *     digest, null/empty GHCR `:latest`, a thrown read, or a bogus SSOT key;
 *   • a remediation redeploy that THREW before reporting (`redeployError`) —
 *     every lagging service is unconfirmed (remediation did not run to a
 *     result), so once that condition reaches the N-of-M debounce window the
 *     invariant pages + exits non-zero (A17). A below-threshold throw cycle is
 *     debounced: it neither red-exits nor posts an (empty) alert;
 *   • a lagging service NOT positively confirmed remediated — it lacks a
 *     `status:"ok"` per-service record in `redeployReport.records` (it was
 *     dropped/skipped, or its own redeploy failed). This is matched
 *     PER-SERVICE, NOT by comparing the post-expansion `attempted` count
 *     against `lagging.length`: imageOf expansion inflates `attempted`, so a
 *     genuinely dropped lagging service could be numerically masked (A16);
 *   • any OTHER service the redeploy attempted and FAILED that was NOT already
 *     confirmed current at check time — e.g. an imageOf consumer pulled in by
 *     expansion that was itself lagging/unresolved — since it is still running
 *     the stale image. A consumer that WAS confirmed current stays confirmed
 *     even if its incidental expansion redeploy fails (A19): it was already
 *     verified on `:latest`, so the failure is not evidence of a stale image;
 *   • an EMPTY in-scope set (`emptyScope`) — a run that checked nothing.
 */
export function buildUnconfirmed(args: {
  errors: { service: string; error: string }[];
  lagging: string[];
  redeployReport: RedeployReport | null;
  redeployError: string | null;
  emptyScope: boolean;
  /**
   * Services POSITIVELY CONFIRMED CURRENT at check time (deployed === latest).
   * `runRedeploy` expands an explicitly-redeployed lagging service to ALSO
   * redeploy its `imageOf` consumers; a consumer that was already current only
   * gets an INCIDENTAL expansion redeploy. If that incidental redeploy fails,
   * the service is STILL current (it was verified on `:latest`), so it must
   * NOT be marked unconfirmed (A19). Passing the set lets the "other failed"
   * loop below exclude such already-verified services.
   */
  confirmedCurrent: Set<string>;
}): UnconfirmedService[] {
  const {
    errors,
    lagging,
    redeployReport,
    redeployError,
    emptyScope,
    confirmedCurrent,
  } = args;
  const unconfirmed: UnconfirmedService[] = [];

  if (emptyScope) {
    unconfirmed.push({
      service: "(scope)",
      reason:
        "no in-scope staging services — the reconcile checked nothing (a zero-checked run is not green)",
    });
  }

  for (const e of errors) {
    unconfirmed.push({ service: e.service, reason: e.error });
  }

  // A17: the remediation redeploy THREW before returning a report. No lagging
  // service can be confirmed remediated, so every one is unconfirmed — the
  // invariant still alerts AND exits non-zero even when the redeploy itself
  // throws (a bare propagated throw would go CI-red but skip the Slack alert).
  if (redeployError !== null) {
    for (const svc of lagging) {
      unconfirmed.push({
        service: svc,
        reason: `remediation redeploy threw before confirming this lagging service: ${redeployError}`,
      });
    }
  }

  if (redeployReport !== null) {
    // A16: confirm remediation PER-SERVICE. A lagging service is confirmed only
    // if the redeploy reported a status:"ok" record for it. Comparing the
    // post-expansion `attempted` count against `lagging.length` is DEFEATED by
    // imageOf expansion (which inflates `attempted`), so a dropped lagging
    // service could read green — match the records instead.
    const okServices = new Set(
      redeployReport.records
        .filter((r) => r.status === "ok")
        .map((r) => r.service),
    );
    for (const svc of lagging) {
      if (okServices.has(svc)) continue;
      const rec = redeployReport.records.find((r) => r.service === svc);
      const detail =
        rec === undefined
          ? "the remediation redeploy attempted no redeploy for it (dropped/skipped and never remediated)"
          : `its remediation redeploy failed${rec.error ? `: ${rec.error}` : ""}`;
      unconfirmed.push({
        service: svc,
        reason: `lagging service not confirmed current — ${detail}`,
      });
    }
    // Any OTHER service the redeploy attempted and FAILED (e.g. an imageOf
    // consumer added by expansion) that was NOT already confirmed current is
    // also not current — it is still running the stale image. Lagging failures
    // are already reported above.
    //
    // A19: a service CONFIRMED CURRENT at check time stays confirmed even if
    // its INCIDENTAL expansion redeploy fails. `runRedeploy` expands a lagging
    // service to also redeploy its imageOf consumers; a consumer that was
    // already on `:latest` was positively verified before the redeploy ran, so
    // a failed incidental redeploy of it is not evidence of a stale image and
    // must NOT fail the run. (This never re-opens the A16 hole: a genuinely
    // LAGGING dropped/failed service is NOT in `confirmedCurrent` and is still
    // caught above via per-service record matching.)
    for (const r of redeployReport.records) {
      if (r.status !== "error") continue;
      if (lagging.includes(r.service)) continue;
      if (confirmedCurrent.has(r.service)) continue;
      unconfirmed.push({
        service: r.service,
        reason: `remediation redeploy failed${r.error ? `: ${r.error}` : ""}`,
      });
    }
  }

  return unconfirmed;
}

/**
 * Build the single Slack alert text for a non-green reconcile. Names the
 * unconfirmed services + reasons (the fail-loud part) AND the lagging services
 * + remediation outcome (the informational alert-AND-remediate part). The
 * headline reflects the ACTUAL condition — unconfirmed services when any exist,
 * otherwise a plain lag notice — rather than a hardcoded cause. Human-voiced,
 * mrkdwn.
 */
export function buildReconcileAlert(args: {
  lagging: string[];
  redeployReport: RedeployReport | null;
  unconfirmed: UnconfirmedService[];
  scope: number;
}): string {
  const { lagging, redeployReport, unconfirmed, scope } = args;
  const sections: string[] = [];

  if (unconfirmed.length > 0) {
    const n = unconfirmed.length;
    const sample = unconfirmed
      .slice(0, 8)
      .map((u) => `• \`${u.service}\`: ${u.reason}`)
      .join("\n");
    const more = n > 8 ? `\n…and ${n - 8} more` : "";
    sections.push(
      `:rotating_light: *Showcase staging reconcile — ${n} service${n === 1 ? "" : "s"} NOT confirmed current* ` +
        `(of ${scope} in scope). Staging drift is not fully self-healed until this clears:\n${sample}${more}`,
    );
  }

  if (lagging.length > 0 && redeployReport !== null) {
    const n = lagging.length;
    const bullets = lagging.map((s) => `• \`${s}\``).join("\n");
    sections.push(
      `:arrows_counterclockwise: ${n} service${n === 1 ? "" : "s"} lagging \`:latest\`, re-triggered the staging redeploy:\n${bullets}\n` +
        `redeploy: ${redeployReport.succeeded}/${redeployReport.attempted} triggered (${redeployReport.failed} failed)`,
    );
  }

  return sections.join("\n\n");
}

/**
 * The scheduled run's exit code, derived PURELY from the debounced invariant set
 * (`pageableUnconfirmed`). Fail loud (non-zero) iff at least one condition has
 * reached the N-of-M debounce window and is therefore pageable this cycle; 0
 * otherwise. A below-window blip — a transient read fault, a one-cycle
 * redeploy race, a redeploy that threw, or a benign remediated lag whose
 * informational alert got a transient non-2xx — is present in `unconfirmed` (for
 * logging) but not yet in `pageableUnconfirmed`, so it does NOT red the run until
 * it reaches N-of-M. An undelivered lag alert is itself folded into the invariant set
 * under the `(alert)` key (see `reconcileStaging`), so it too is debounced rather
 * than reding the very first cycle. See the invariant in the file header.
 */
export function reconcileExitCode(summary: ReconcileSummary): number {
  return summary.pageableUnconfirmed.length > 0 ? 1 : 0;
}

/**
 * Compare each staging service's deployed digest against GHCR `:latest`, then
 * redeploy + alert per the ONE invariant: the run is green iff EVERY in-scope
 * service is positively confirmed current. Per-service digest-fetch failures —
 * including an unresolvable deployed digest or an empty GHCR `:latest` — become
 * `unconfirmed` entries (they never mask another service's lag and never read
 * as a healthy "current" service). A lag is remediated by a scoped redeploy; a
 * redeploy that fails or drops a lagging service, and an empty in-scope set,
 * also land in `unconfirmed`. That raw set is then DEBOUNCED over a sliding
 * N-of-M window (`applyDebounce`): a condition pages + red-exits only once it has
 * been unconfirmed on ≥N of the last M cycles, so a single-cycle blip stays
 * silent while a flap (unconfirmed every other cycle) still pages. A single Slack
 * alert names the PAGEABLE (debounced) unconfirmed services + reasons and the
 * lag/remediation outcome, and the exit code is derived from the same debounced
 * set — a below-window cycle never red-exits and never posts an
 * empty/invalid alert, even when the redeploy throws or the Slack POST returns
 * non-2xx. All I/O is injected via `deps` so the decision → action wiring is
 * unit-tested offline.
 */
export async function reconcileStaging(
  deps: ReconcileDeps,
): Promise<ReconcileSummary> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const stagingEnvId = ENV_ID_BY_NAME["staging"];
  const services = deps.services ?? stagingReconcileServices();

  const pairs: ServiceDigestPair[] = [];
  const errors: { service: string; error: string }[] = [];

  for (const name of services) {
    // Own-property guard so an inherited prototype key can never dereference a
    // bogus SERVICES entry.
    const entry = Object.hasOwn(SERVICES, name) ? SERVICES[name] : undefined;
    if (entry === undefined) {
      errors.push({ service: name, error: "not an SSOT service key" });
      continue;
    }
    try {
      const repoName = repoNameFor(name, "staging");
      const [deployedRaw, latestRaw] = await Promise.all([
        deps.fetchDeployedDigest(entry.serviceId, stagingEnvId),
        deps.fetchLatestDigest(repoName),
      ]);
      const deployedDigest = normalizeDigest(deployedRaw);
      const latestDigest = normalizeDigest(latestRaw);
      if (latestDigest === null) {
        // A missing GHCR :latest digest is a fault, not a comparison — record
        // and skip rather than treat the null-vs-something as a lag.
        errors.push({
          service: name,
          error: `GHCR :latest digest for ${repoName} resolved empty`,
        });
        continue;
      }
      if (deployedDigest === null) {
        // No resolvable SUCCESS deployment digest. Per the header contract this
        // is recorded as an ERROR and surfaced — NOT silently treated as
        // up-to-date, and NOT redeployed (the ambiguous signal would risk
        // churn). It stays out of `pairs` so it never reads as "current".
        errors.push({
          service: name,
          error: `no resolvable deployed digest (no SUCCESS deployment / meta.imageDigest) for ${repoName}`,
        });
        log(`  ${name.padEnd(36)} ERROR: deployed digest unresolved`);
        continue;
      }
      pairs.push({ service: name, repoName, deployedDigest, latestDigest });
      log(
        `  ${name.padEnd(36)} deployed=${deployedDigest} latest=${latestDigest}`,
      );
    } catch (e) {
      const error = sanitizeErrorBody(
        e instanceof Error ? e.message : String(e),
      );
      errors.push({ service: name, error });
      log(`  ${name.padEnd(36)} ERROR: ${error}`);
    }
  }

  const lagging = selectLaggingServices(pairs);
  const laggingSet = new Set(lagging);
  // Services POSITIVELY CONFIRMED CURRENT at check time: a resolved pair whose
  // deployed digest matched `:latest`. Threaded into buildUnconfirmed so an
  // incidental imageOf-expansion redeploy failure of an already-current service
  // does not falsely mark it unconfirmed (A19).
  const confirmedCurrent = new Set(
    pairs.filter((p) => !laggingSet.has(p.service)).map((p) => p.service),
  );
  const emptyScope = services.length === 0;

  // Remediate any lag FIRST so the redeploy tally feeds the invariant set.
  let redeployed = false;
  let redeployReport: RedeployReport | null = null;
  let redeployError: string | null = null;
  if (lagging.length > 0) {
    log(
      `\n${lagging.length} staging service(s) lagging :latest: ${lagging.join(", ")}`,
    );
    // A17: guard the redeploy call. A thrown remediation must NOT propagate
    // out of the reconcile before the alert fires — a bare throw would go
    // CI-red but skip the Slack alert, half-violating the invariant. On throw
    // we record the error, leave redeployReport null, and let buildUnconfirmed
    // mark every lagging service unconfirmed so the run still alerts + exits
    // non-zero.
    try {
      redeployReport = await deps.redeployStaging(lagging);
      redeployed = true;
    } catch (e) {
      redeployError = sanitizeErrorBody(
        e instanceof Error ? e.message : String(e),
      );
      log(`\nremediation redeploy threw before confirming: ${redeployError}`);
    }
  }

  // THE ONE INVARIANT: every in-scope service not positively confirmed current.
  const unconfirmed = buildUnconfirmed({
    errors,
    lagging,
    redeployReport,
    redeployError,
    emptyScope,
    confirmedCurrent,
  });

  // ── DEBOUNCE the fail-loud verdict over a sliding N-of-M window ─────────────
  // A single-cycle blip (the harness-workers redeploy race, a transient Railway
  // HTTP 500 / timeout, a platform "deploys paused" hiccup) all surface as
  // `unconfirmed` and clear by the next cycle — they must NOT page. Only a
  // condition that is unconfirmed on ≥N of the last M cycles (genuine drift that
  // persists OR flaps every other cycle, a sustained outage) pages. Applied
  // uniformly at the verdict level rather than per-cause. Remediation of a real
  // lag already ran ABOVE and is unaffected — only the page + non-zero exit wait
  // for the window. Threshold defaults to N=1/M=1 (no debounce) for the pure/test
  // path; production wires DEFAULT_DEBOUNCE_THRESHOLD/DEFAULT_DEBOUNCE_WINDOW. The
  // window is clamped to ≥N so a misconfigured M can never make paging impossible.
  const threshold = deps.debounceThreshold ?? 1;
  const window = Math.max(deps.debounceWindow ?? threshold, threshold);
  const priorWindows = (await deps.loadDebounceState?.()) ?? {};
  // First debounce pass over the base invariant set → the subset that PAGES this
  // cycle. The Slack page names ONLY these: a below-window blip is retained in
  // `unconfirmed` for logging but is never named in the page.
  const { pageable: pageableBase } = applyDebounce({
    unconfirmed,
    priorWindows,
    threshold,
    window,
  });

  // Alert whenever the run has something to SAY this cycle — derived from the
  // DEBOUNCED set (not raw `lagging`):
  //   • a PAGEABLE (debounced) unconfirmed condition → the fail-loud page, OR
  //   • a lag we have an actual redeploy RESULT for → the informational
  //     alert-AND-remediate notice. Remediation is NOT debounced (it self-heals
  //     every cycle), so this notice fires the cycle a lag is remediated.
  // A below-threshold blip whose redeploy THREW carries no report and nothing
  // pageable, so it says nothing this cycle: we skip the post rather than emit an
  // empty/invalid Slack payload (the old bypass posted "" and red-exited).
  let alerted = false;
  let alertAttempted = false;
  if (
    pageableBase.length > 0 ||
    (lagging.length > 0 && redeployReport !== null)
  ) {
    if (pageableBase.length > 0) {
      log(
        `\n${pageableBase.length} staging service(s) NOT confirmed current on ${threshold}+ of the last ${window} cycles (of ${services.length} in scope).`,
      );
    }
    const alertText = buildReconcileAlert({
      lagging,
      redeployReport,
      unconfirmed: pageableBase,
      scope: services.length,
    });
    // Never POST an empty/invalid payload. The fire condition above already
    // guarantees a non-empty body (a page renders the unconfirmed section; a lag
    // with a report renders the lagging section) — this is a belt-and-suspenders
    // guard so no future path can slip an empty alert through.
    if (alertText !== "") {
      alertAttempted = true;
      alerted = await deps.postSlackAlert(alertText);
    }
  } else {
    log(
      `\nAll ${pairs.length} checked staging service(s) current with :latest.`,
    );
  }

  // An UNDELIVERED lag alert is itself a fail-loud condition (a drift notice we
  // could not deliver), but it is DEBOUNCED like every other verdict so a single
  // transient Slack non-2xx on a benign remediated lag does NOT red the run on
  // cycle 1. Fold it into the invariant set under its own synthetic `(alert)` key
  // and re-derive the debounced verdict from `priorWindows`, so the exit code
  // stays a pure function of the debounced set (see `reconcileExitCode`). Because
  // `applyDebounce` keys off `priorWindows` (not the first pass's output), the
  // base services get identical windows in both passes — only `(alert)` is added.
  const unconfirmedFinal: UnconfirmedService[] = [...unconfirmed];
  if (alertAttempted && !alerted && lagging.length > 0) {
    unconfirmedFinal.push({
      service: "(alert)",
      reason:
        "a lagging service was remediated but the Slack drift alert did not deliver (non-2xx) — failing loud (once persisted) so the notice is not silently lost",
    });
  }
  const { nextWindows, pageable: pageableUnconfirmed } = applyDebounce({
    unconfirmed: unconfirmedFinal,
    priorWindows,
    threshold,
    window,
  });
  // Persist the updated windows BEFORE returning so the window survives to the
  // next stateless scheduled run (the caller exits right after this returns).
  await deps.saveDebounceState?.(nextWindows);

  // Log any unconfirmed service still being debounced (below the N-of-M window)
  // so an operator can see it building toward a page rather than a silent gap.
  const debounced = unconfirmedFinal.filter(
    (u) => !pageableUnconfirmed.some((p) => p.service === u.service),
  );
  if (debounced.length > 0) {
    for (const u of debounced) {
      const w = nextWindows[u.service] ?? [];
      const trues = w.filter(Boolean).length;
      log(
        `  debounced (${trues}/${threshold} unconfirmed within the last ${w.length}/${window} cycles, not yet paging): ${u.service}: ${u.reason}`,
      );
    }
  }

  return {
    checked: pairs.length,
    lagging,
    errors,
    redeployed,
    alerted,
    redeployReport,
    unconfirmed: unconfirmedFinal,
    pageableUnconfirmed,
    debounceWindows: nextWindows,
    emptyScope,
  };
}

// ── Live wiring (main) ──────────────────────────────────────────────────────

const RAILWAY_API = RAILWAY_GRAPHQL_ENDPOINT;

/**
 * Resolve the Railway bearer token, mapping a RailwayTokenError onto the
 * script's exit-1 operator/config-error contract (mirrors the other scripts).
 */
function getRailwayToken(): string {
  try {
    return resolveRailwayToken().token;
  } catch (e) {
    if (e instanceof RailwayTokenError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}

/** A single deployment edge as returned by Railway's `deployments()` query. */
export interface DeploymentEdge {
  node: {
    id: string;
    status: string;
    meta: unknown;
    createdAt: string;
  };
}

interface DeploymentsResponse {
  deployments: {
    edges: DeploymentEdge[];
  } | null;
}

/**
 * Pick the imageDigest of the newest SUCCESS deployment from a batch of edges.
 *
 * Railway's `deployments()` connection order is NOT contracted, so we sort the
 * SUCCESS deployments by `createdAt` descending and take the first rather than
 * trusting the API to return newest-first. A wrong pick would either flag a
 * false lag (churn) or miss a real one. Returns null when there is no SUCCESS
 * deployment or no parseable `meta.imageDigest`.
 *
 * A18 — NaN-safe ordering: an unparseable/missing `createdAt` yields NaN from
 * `Date.getTime()`, and a comparator that returns NaN leaves the sort order
 * undefined — an invalid-timestamp SUCCESS could then win "newest" and select
 * the WRONG digest (false lag or masked lag). We map an unparseable timestamp
 * to `-Infinity` so it sorts to the BOTTOM and can never beat a valid SUCCESS.
 * The determinism guarantee is: any valid-timestamp SUCCESS always wins "newest"
 * over an invalid one, so a valid digest is never masked by a bogus timestamp.
 * (The comparator is NOT NaN-free in every case — subtracting two `-Infinity`
 * values yields NaN — but that only arises when EVERY SUCCESS has an invalid
 * timestamp; there is no valid candidate to protect, and V8's stable sort then
 * preserves input order, so the pick stays deterministic.)
 */
function successCreatedAtMs(edge: DeploymentEdge): number {
  const t = new Date(edge.node.createdAt).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

export function pickNewestSuccessDigest(
  edges: DeploymentEdge[],
): string | null {
  const newest = edges
    .filter((e) => e.node.status === "SUCCESS")
    .sort((a, b) => successCreatedAtMs(b) - successCreatedAtMs(a))[0];
  if (!newest) return null;
  let meta = newest.node.meta;
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch {
      return null;
    }
  }
  if (meta === null || typeof meta !== "object") return null;
  const m = meta as { imageDigest?: unknown; image?: unknown };
  let digest =
    typeof m.imageDigest === "string" && m.imageDigest !== ""
      ? m.imageDigest
      : null;
  if (
    digest === null &&
    typeof m.image === "string" &&
    m.image.includes("@sha256:")
  ) {
    digest = m.image.split("@", 2)[1] ?? null;
  }
  return digest;
}

/**
 * Read the digest the staging deployment is ACTUALLY running: the newest
 * SUCCESS deployment's `meta.imageDigest`. Mirrors `showcase/bin/railway`'s
 * `staging_running_digest`. Returns null when no SUCCESS deployment /
 * imageDigest is available.
 */
async function liveFetchDeployedDigest(
  token: string,
  serviceId: string,
  environmentId: string,
): Promise<string | null> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // first:10 is a safe upper bound: a staging service's newest SUCCESS is
      // effectively always among its 10 most-recent deployments (queued/failed
      // attempts included). We do NOT rely on the connection's order — see
      // pickNewestSuccessDigest, which sorts by createdAt.
      query: `query Deployments($serviceId: String!, $environmentId: String!) {
        deployments(first: 10, input: { serviceId: $serviceId, environmentId: $environmentId }) {
          edges { node { id status meta createdAt } }
        }
      }`,
      variables: { serviceId, environmentId },
    }),
  });
  if (!res.ok) {
    const body = sanitizeErrorBody(await res.text());
    throw new Error(`Railway deployments query HTTP ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    data?: DeploymentsResponse;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e) => sanitizeErrorBody(e.message)).join("; "),
    );
  }
  const edges = json.data?.deployments?.edges ?? [];
  return pickNewestSuccessDigest(edges);
}

/**
 * Post the reconcile alert to the shared #oss-alerts incoming webhook (the
 * SAME `SLACK_WEBHOOK_OSS_ALERTS` secret showcase_build.yml posts through).
 * Returns true ONLY when the alert actually delivered (a 2xx POST). A missing
 * webhook, a non-2xx response, or a thrown request return false and are warned
 * to stderr — the caller records this as `summary.alerted` so a swallowed
 * alert never reads as a delivered one (and, alongside a real lag, fails the
 * run loud per the exit-code contract).
 */
async function livePostSlackAlert(text: string): Promise<boolean> {
  const webhook = (process.env.SLACK_WEBHOOK_OSS_ALERTS || "").trim();
  if (!webhook) {
    process.stderr.write(
      "warning: SLACK_WEBHOOK_OSS_ALERTS is not set — skipping Slack alert\n",
    );
    return false;
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      process.stderr.write(
        `warning: Slack webhook POST non-2xx (${res.status}) — alert may have been dropped\n`,
      );
      return false;
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`warning: Slack webhook POST failed (${msg})\n`);
    return false;
  }
}

/**
 * The debounce state file path, from `RECONCILE_DEBOUNCE_STATE` (set by the
 * workflow to a path inside the `actions/cache`-backed directory). Null when
 * unset — a local/manual one-shot run then has NO persistable state backend, so
 * `main` switches it to an immediate N=1/M=1 policy (fail loud on the first
 * unconfirmed cycle) rather than debouncing against state it cannot keep. In CI
 * the env is always set so the sliding window persists between cycles.
 */
function debounceStatePath(): string | null {
  const p = (process.env.RECONCILE_DEBOUNCE_STATE || "").trim();
  return p === "" ? null : p;
}

/**
 * Read the prior per-service sliding windows. Returns {} on the first run, a
 * cache miss, or an unparseable/malformed file — a fresh start, never a throw (a
 * bad state file must not take down the self-heal). Only the windowed shape
 * (a boolean[] per service) is accepted; an OLD-shape entry from before the
 * windowed change (the pre-windowed `{svc: number}` count) or any other garbage
 * is treated as an empty window (dropped) — a one-cycle delay, never a throw.
 */
async function liveLoadDebounceState(path: string): Promise<DebounceWindows> {
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const out: DebounceWindows = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue; // old numeric shape / garbage → empty window
      const bools = v.filter((x): x is boolean => typeof x === "boolean");
      if (bools.length > 0) out[k] = bools; // applyDebounce trims to the window
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the updated sliding windows for the next scheduled cycle to read. */
async function liveSaveDebounceState(
  path: string,
  windows: DebounceWindows,
): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(windows), "utf8");
}

/**
 * The runtime debounce threshold (N): `RECONCILE_DEBOUNCE_THRESHOLD` when it
 * parses to a positive integer, else `DEFAULT_DEBOUNCE_THRESHOLD` (2).
 */
function resolveDebounceThreshold(): number {
  const raw = (process.env.RECONCILE_DEBOUNCE_THRESHOLD || "").trim();
  if (raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return DEFAULT_DEBOUNCE_THRESHOLD;
}

/**
 * The runtime debounce window (M): `RECONCILE_DEBOUNCE_WINDOW` when it parses to
 * a positive integer, else `DEFAULT_DEBOUNCE_WINDOW` (3). Clamped to ≥N so a
 * window smaller than the threshold (which could never page) fails safe — it
 * still pages — rather than silently disabling the fail-loud verdict.
 */
function resolveDebounceWindow(threshold: number): number {
  const raw = (process.env.RECONCILE_DEBOUNCE_WINDOW || "").trim();
  let w = DEFAULT_DEBOUNCE_WINDOW;
  if (raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1) w = n;
  }
  return Math.max(w, threshold);
}

/**
 * The resolved runtime debounce policy: the state-file path (or null) plus the
 * N-of-M window `main` wires into `reconcileStaging`.
 */
export interface DebouncePolicy {
  statePath: string | null;
  threshold: number;
  window: number;
}

/**
 * Resolve the runtime debounce policy from the environment. This is the single
 * seam that decides CI-debounced vs local-fail-loud, kept pure + exported so the
 * local fail-loud selection is unit-testable without going near the network:
 *   • CI (a `RECONCILE_DEBOUNCE_STATE` backend is configured): the configured
 *     N-of-M window applies (`RECONCILE_DEBOUNCE_THRESHOLD` /
 *     `RECONCILE_DEBOUNCE_WINDOW`, defaulting to 2-of-3), so the per-service
 *     sliding window persists between cycles and a single blip stays silent.
 *   • Local/manual one-shot (NO state backend): an immediate N=1/M=1 policy — a
 *     run with no persistable state cannot debounce across runs, so it FAILS
 *     LOUD (exit 1) on the first unconfirmed cycle instead of maxing the window
 *     at 1/M and always exiting 0 (the regression this closes).
 */
export function resolveDebouncePolicy(): DebouncePolicy {
  const statePath = debounceStatePath();
  if (statePath === null) return { statePath: null, threshold: 1, window: 1 };
  const threshold = resolveDebounceThreshold();
  return { statePath, threshold, window: resolveDebounceWindow(threshold) };
}

async function main(): Promise<void> {
  const token = getRailwayToken();
  const redeploy = makeLiveRedeploy(token);
  const { statePath, threshold, window } = resolveDebouncePolicy();

  const deps: ReconcileDeps = {
    fetchDeployedDigest: (serviceId, environmentId) =>
      liveFetchDeployedDigest(token, serviceId, environmentId),
    fetchLatestDigest: (repoName) => resolveGhcrDigest(repoName, "latest"),
    redeployStaging: async (services) => {
      const summary = await runRedeploy({
        env: "staging",
        services,
        redeploy,
        appendSummary: (line) => process.stderr.write(line + "\n"),
      });
      return {
        attempted: summary.attempted,
        succeeded: summary.succeeded,
        failed: summary.failed,
        records: summary.records,
      };
    },
    postSlackAlert: livePostSlackAlert,
    debounceThreshold: threshold,
    debounceWindow: window,
    // Only wire cross-run persistence when a state path is configured (CI). A
    // local run without it carries no state — each cycle stands alone (and runs
    // the immediate N=1/M=1 policy above so drift fails loud).
    loadDebounceState: statePath
      ? () => liveLoadDebounceState(statePath)
      : undefined,
    saveDebounceState: statePath
      ? (windows) => liveSaveDebounceState(statePath, windows)
      : undefined,
  };

  console.log(
    `Reconciling staging against GHCR :latest (project ${PROJECT_ID})…`,
  );
  const summary = await reconcileStaging(deps);
  console.log(
    `\nchecked=${summary.checked} lagging=${summary.lagging.length} errors=${summary.errors.length} redeployed=${summary.redeployed} alerted=${summary.alerted} unconfirmed=${summary.unconfirmed.length} pageable=${summary.pageableUnconfirmed.length} threshold=${threshold} window=${window} emptyScope=${summary.emptyScope}`,
  );
  if (
    summary.unconfirmed.length > 0 &&
    summary.pageableUnconfirmed.length < summary.unconfirmed.length
  ) {
    console.log(
      `debounce state: ${JSON.stringify(summary.debounceWindows)} (services unconfirmed on fewer than ${threshold} of the last ${window} cycles are suppressed this cycle)`,
    );
  }
  if (summary.errors.length > 0) {
    for (const e of summary.errors) {
      console.error(`  digest-read error: ${e.service}: ${e.error}`);
    }
  }

  const code = reconcileExitCode(summary);
  if (code !== 0) {
    // Fail loud so the scheduled run goes RED and the alert isn't the only
    // signal (see the invariant in the file header). Every non-green cause
    // flows through the ONE debounced `pageableUnconfirmed` set — including an
    // undelivered lag alert (the `(alert)` key) — so report it directly.
    console.error(
      `${summary.pageableUnconfirmed.length} staging service(s) NOT confirmed current on ${threshold}+ of the last ${window} cycles (alerted=${summary.alerted}):`,
    );
    for (const u of summary.pageableUnconfirmed) {
      console.error(`  unconfirmed: ${u.service}: ${u.reason}`);
    }
  }
  // The run is green ONLY when every in-scope service was confirmed current
  // (or a lag was cleanly remediated AND its alert delivered). Any unconfirmed
  // service fails the whole scheduled run — the self-heal is not allowed to
  // read green while a staging service is unverified.
  process.exit(code);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    // Hard operator/config error (missing token, unreachable Railway, a bug in
    // the wiring). Fail loud so the scheduled run goes red.
    console.error(e);
    process.exit(1);
  });
}
