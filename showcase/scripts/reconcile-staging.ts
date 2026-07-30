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
 * uses the mismatch alone. The 15-minute cadence itself provides the debounce:
 * a service that is mid-redeploy (its new deployment not yet SUCCESS) simply
 * matches on the next cycle, and re-running the staging redeploy is idempotent
 * (it just triggers another redeploy of an image that is already `:latest`), so
 * a transient duplicate is harmless. A deployed digest that cannot be resolved
 * (no SUCCESS deployment / no `meta.imageDigest`) is recorded as an ERROR and
 * SURFACED — it is NOT silently counted as up-to-date and it is NOT redeployed
 * (re-deploying on that ambiguous signal would risk churn without a clear win),
 * but it never masquerades as a healthy "current with :latest" service.
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
 * — for ANY reason — lands in the single `unconfirmed` set, which drives BOTH a
 * Slack alert naming the services + the reason AND a non-zero exit. There are
 * no scattered per-cause special-cases: the exit code and the alert are derived
 * from that one set.
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
 *     zero-checked floor). NOTE: an all-errored run (scope non-empty but every
 *     service faulted) is NOT `emptyScope` — each faulted service contributes
 *     its own entry to the `unconfirmed` set via `errors`.
 *
 * A LAGGING service whose remediation redeploy CLEARLY succeeded (no failures,
 * no drops) is confirmed-in-progress: the run still posts an informational
 * alert (alert-AND-remediate) but exits 0, and it will match `:latest` on the
 * next cycle. An UNDELIVERED alert alongside a lag also fails loud (see
 * `alerted`).
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
 * Exit code: 0 on a clean reconcile (including a fully-remediated lag). A hard
 * operator/config error (missing Railway token, unreachable Railway), a
 * systemic failure, a partial redeploy failure, or an undelivered lag alert all
 * fail loud with a non-zero exit (see the fail-loud contract above).
 */

import { fileURLToPath } from "url";
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
   * THE INVARIANT SET: every in-scope service NOT positively confirmed current,
   * with its reason. A run is green iff this is empty. The exit code and the
   * alert are both derived from it (see `reconcileExitCode` / the header
   * contract) — there are no separate per-cause special-cases.
   */
  unconfirmed: UnconfirmedService[];
  /**
   * True when the in-scope set was empty (`services.length === 0`) — the run
   * checked nothing, which is NOT green. Recorded as its own field for the
   * alert text; it also contributes an entry to `unconfirmed`.
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
 * confirmed current, with its reason — from the raw reconcile facts. This is
 * the single place the "not confirmed current" cases from the header contract
 * are enumerated; the exit code and the alert both derive from its result.
 *
 * Sources of "unconfirmed":
 *   • per-service digest-read faults (`errors`) — null/unresolvable deployed
 *     digest, null/empty GHCR `:latest`, a thrown read, or a bogus SSOT key;
 *   • a remediation redeploy that THREW before reporting (`redeployError`) —
 *     every lagging service is unconfirmed (remediation did not run to a
 *     result), so the invariant still alerts + exits non-zero (A17);
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
 * The scheduled run's exit code, derived purely from the ONE invariant. Fail
 * loud (non-zero) whenever any in-scope service is unconfirmed, or when a lag
 * was found but its alert never delivered; 0 only when every service was
 * confirmed current (or a lag was cleanly remediated AND its alert delivered).
 * See the invariant in the file header.
 */
export function reconcileExitCode(summary: ReconcileSummary): number {
  if (summary.unconfirmed.length > 0) return 1;
  if (summary.lagging.length > 0 && !summary.alerted) return 1;
  return 0;
}

/**
 * Compare each staging service's deployed digest against GHCR `:latest`, then
 * redeploy + alert per the ONE invariant: the run is green iff EVERY in-scope
 * service is positively confirmed current. Per-service digest-fetch failures —
 * including an unresolvable deployed digest or an empty GHCR `:latest` — become
 * `unconfirmed` entries (they never mask another service's lag and never read
 * as a healthy "current" service). A lag is remediated by a scoped redeploy; a
 * redeploy that fails or drops a lagging service, and an empty in-scope set,
 * also land in `unconfirmed`. A single Slack alert names the unconfirmed
 * services + reasons and the lag/remediation outcome, and the exit code is
 * derived from the same set. All I/O is injected via `deps` so the decision →
 * action wiring is unit-tested offline.
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

  // Alert whenever the run is not a clean silent no-op: any unconfirmed service
  // (fail-loud) OR any lag (informational alert-AND-remediate). A single alert
  // covers both.
  let alerted = false;
  if (unconfirmed.length > 0 || lagging.length > 0) {
    if (unconfirmed.length > 0) {
      log(
        `\n${unconfirmed.length} staging service(s) NOT confirmed current (of ${services.length} in scope).`,
      );
    }
    alerted = await deps.postSlackAlert(
      buildReconcileAlert({
        lagging,
        redeployReport,
        unconfirmed,
        scope: services.length,
      }),
    );
  } else {
    log(
      `\nAll ${pairs.length} checked staging service(s) current with :latest.`,
    );
  }

  return {
    checked: pairs.length,
    lagging,
    errors,
    redeployed,
    alerted,
    redeployReport,
    unconfirmed,
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

async function main(): Promise<void> {
  const token = getRailwayToken();
  const redeploy = makeLiveRedeploy(token);

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
  };

  console.log(
    `Reconciling staging against GHCR :latest (project ${PROJECT_ID})…`,
  );
  const summary = await reconcileStaging(deps);
  console.log(
    `\nchecked=${summary.checked} lagging=${summary.lagging.length} errors=${summary.errors.length} redeployed=${summary.redeployed} alerted=${summary.alerted} unconfirmed=${summary.unconfirmed.length} emptyScope=${summary.emptyScope}`,
  );
  if (summary.errors.length > 0) {
    for (const e of summary.errors) {
      console.error(`  digest-read error: ${e.service}: ${e.error}`);
    }
  }

  const code = reconcileExitCode(summary);
  if (code !== 0) {
    // Fail loud so the scheduled run goes RED and the alert isn't the only
    // signal (see the invariant in the file header). Every non-green cause
    // flows through the ONE `unconfirmed` set, so report it directly.
    if (summary.unconfirmed.length > 0) {
      console.error(
        `${summary.unconfirmed.length} staging service(s) NOT confirmed current (alerted=${summary.alerted}):`,
      );
      for (const u of summary.unconfirmed) {
        console.error(`  unconfirmed: ${u.service}: ${u.reason}`);
      }
    } else if (summary.lagging.length > 0 && !summary.alerted) {
      console.error(
        `lag detected (${summary.lagging.join(", ")}) but the Slack alert did not deliver.`,
      );
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
