/**
 * CLI CONTROL-PLANE runner — drives d5/d6 probe runs through the SAME fleet
 * wiring staging uses (producer → queue → worker → result-aggregator) instead
 * of the legacy in-process `runLevel()` driver.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 * The legacy `cli/runner.ts` `runLevel()` path runs the d6 driver IN-PROCESS,
 * serially, against a locally-launched Chromium. That bypasses the fleet
 * enumerator → `probe_jobs` queue → worker(s) → aggregator wiring that
 * staging actually exercises. As a dev tool this hides concurrency,
 * claim/lease, and aggregator-rollup bugs that only ever bite in the fleet
 * path. This module makes `bin/showcase test --d5/--d6` faithful to staging
 * BY CONSTRUCTION: it replicates the deep/full fleet PRODUCER tick exactly as
 * `runControlPlane` wires it for the `fleet-producer-*` schedule —
 * `createE2eDeepServiceEnumerator` (d5) / `createServiceEnumerator` (d6) over
 * `createJobProducer`, with the queue = `createFleetQueueClient` over
 * `createPbClient` + `createJobClaimClient`. One `tick({ triggered: true })`
 * enqueues per-service jobs onto `probe_jobs`; the RUNNING worker container(s)
 * claim them, run the driver against the in-network integration URLs, and the
 * result-aggregator writes the d5/d6 status cells to local PocketBase.
 *
 * The host CLI ONLY enqueues + polls PocketBase for the run's terminal cells —
 * it never launches Chromium and never navigates to the integrations (the
 * worker does that, inside the compose network).
 *
 * ── LOCAL_SERVICES_JSON ─────────────────────────────────────────────────
 * Discovery enumerates from `LOCAL_SERVICES_JSON` (the same static-injection
 * seam the control-plane container uses in `docker-compose.local.yml` /
 * `docker-compose.like-staging.yml`). When the operator scopes the run to a
 * slug, we synthesize the IDENTICAL record shape per requested slug
 * (`name: showcase-<slug>`, `publicUrl: http://<slug>:10000`, `demos: [...]`)
 * so the worker resolves the integration over the compose network exactly as
 * staging resolves it over Railway. If the env already provides
 * `LOCAL_SERVICES_JSON`, we honor it (filtered to the requested slugs).
 */

import { createE2eDeepServiceEnumerator } from "../fleet/control-plane/catalog-enumerator.js";
import { createServiceEnumerator } from "../fleet/control-plane/catalog-enumerator.js";
import { D6_DRIVER_KIND } from "../fleet/control-plane/catalog-enumerator.js";
import { createJobProducer } from "../fleet/control-plane/job-producer.js";
import { FLEET_FAMILIES } from "../fleet/control-plane/run-view.js";
import type { ServiceEnumerator } from "../fleet/control-plane/job-producer.js";
import { createFleetQueueClient } from "../fleet/queue-client.js";
import { createPbClient } from "../storage/pb-client.js";
import { createJobClaimClient } from "../fleet/job-claim.js";
import { railwayServicesSource } from "../probes/discovery/railway-services.js";

import type { Logger } from "../types/index.js";
import type { LocalConfig } from "./config.js";
import { getSlugContainerOrigins } from "./config.js";
import type { TestTarget } from "./targets.js";
import type { TerminalResult } from "./results.js";
import { demosForSlug, loadManifest } from "./targets.js";
import { demosToFeatureTypes } from "../probes/helpers/d5-feature-mapping.js";

/** The two fleet levels this runner can drive. */
export type ControlPlaneLevel = "d5" | "d6";

/**
 * Map a runner level onto its §5.1 registry family id. The two levels happen
 * to share their family's name today, but the lookup goes through
 * `FLEET_FAMILIES` deliberately: a registry rename/removal fails loudly here
 * instead of letting a triggered tick stamp a family the /api/runs projection
 * no longer knows (the job would aggregate into nothing — invisible).
 */
function familyForLevel(level: ControlPlaneLevel): string {
  const entry = FLEET_FAMILIES.find((f) => f.family === level);
  if (!entry) {
    throw new Error(
      `no FLEET_FAMILIES entry for control-plane level "${level}" — ` +
        "triggered ticks must stamp a §5.1 registry family",
    );
  }
  return entry.family;
}

/** Tunables for the control-plane run (polling cadence + ceiling). */
export interface ControlPlaneRunOptions {
  level: ControlPlaneLevel;
  /** How long to wait for the worker fleet to drain the run, in ms. */
  timeoutMs?: number;
  /** How often to poll PocketBase for the run's terminal cells, in ms. */
  pollIntervalMs?: number;
  verbose?: boolean;
}

/** Default ceiling: a d6 sweep can take many minutes per service. */
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/**
 * Resolve the PocketBase superuser creds the host CLI uses to enqueue + poll.
 * The running stack's superuser is configured via `POCKETBASE_SUPERUSER_*`
 * (see docker-compose.local.yml). We prefer those env vars, then the
 * config.ts values, then the compose default — so the host enqueue path uses
 * the SAME admin the worker/aggregator use.
 */
function resolvePbCreds(config: LocalConfig): {
  url: string;
  email: string;
  password: string;
} {
  return {
    url: process.env.POCKETBASE_URL_LOCAL || config.pocketbase.url,
    email:
      process.env.POCKETBASE_SUPERUSER_EMAIL ||
      config.pocketbase.email ||
      "admin@example.com",
    password:
      process.env.POCKETBASE_SUPERUSER_PASSWORD ||
      config.pocketbase.password ||
      "showcase-local-dev",
  };
}

/**
 * A per-slug scoping record used by {@link buildLocalServicesJson} and
 * {@link expectedKeys}. `demo` is set ONLY when the caller typed
 * `<slug>:<demo>` (explicit per-demo scoping); when absent, the level's
 * default semantics apply (d5 = representative `agentic-chat`; d6 = full
 * demo set).
 *
 * Exported for unit-test coverage (`control-plane-run.test.ts`) — internal
 * callers should keep using {@link runViaControlPlane}.
 */
export interface SlugScope {
  slug: string;
  demo?: string;
}

/**
 * Deduplicate `(slug, demo)` pairs from the operator-supplied targets. An
 * explicit `slug:demo` is kept distinct from a bare slug for the same slug,
 * so `built-in-agent built-in-agent:tool-rendering` enqueues both the
 * default representative AND the scoped per-demo job. Mirrors the pre-A18
 * `[...new Set(slugs)]` shape for the bare-slug case.
 *
 * Exported for unit-test coverage.
 */
export function dedupeScopes(targets: TestTarget[]): SlugScope[] {
  const scopes: SlugScope[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    // Use NUL escape as separator so a slug containing the separator
    // could never collide; identifiers are ASCII so this is unreachable
    // in practice but cheap insurance against future slug shapes.
    const key = `${t.slug}\x00${t.demo ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ slug: t.slug, demo: t.demo });
  }
  return scopes;
}

/**
 * Build the `LOCAL_SERVICES_JSON` discovery roster the enumerator reads.
 *
 * TWO ROSTER PATHS EXIST, and they must agree for the same slug:
 *
 *  1. COMPOSE-SUPPLIED. `docker-compose.local.yml` sets `LOCAL_SERVICES_JSON`
 *     on the `harness-control-plane` service, and `apply_isolation()` in
 *     `showcase/scripts/cli/_common.sh` rewrites that same line for an
 *     `--isolate` run. When the variable is present this function returns it
 *     VERBATIM — the container's own roster wins.
 *  2. SYNTHESISED (below). The host CLI path, when nothing supplied a roster.
 *
 * Both now carry BOTH AXES per record — `publicUrl` (where the demos are
 * served) and `agentBaseUrl` (where the agent answers) — and both derive
 * `publicUrl` from the SAME source of truth, the `demo_frontend` field in
 * `showcase/integrations/<slug>/manifest.yaml`:
 *
 *   - this function reads it through `getSlugContainerOrigins`, which resolves
 *     `config.unifiedFrontendSlugs` (loaded from the manifests by
 *     `loadConfig`);
 *   - the compose file reads it through `${LOCAL_SERVICE_URL_<SLUG>}`, which
 *     `_common.sh` exports from `showcase/local-services.generated.env` —
 *     emitted from the same manifests by
 *     `showcase/scripts/emit-local-services-env.ts`.
 *
 * `local-services-roster-parity.test.ts` asserts the two paths produce the same
 * `publicUrl` and `agentBaseUrl` for the same slug, so this is a checked claim
 * rather than a comment. THIS IS THE THIRD-DIVERGENCE GUARD: before it, this
 * function hardcoded `http://${slug}:10000` and emitted no agent axis at all,
 * so `showcase test <slug> --d6` (the fleet path, and the default — `--direct`
 * is labelled legacy/debug) could not honour a migration, while the
 * compose-supplied roster could.
 *
 * Per-slug demo scoping:
 *   - When the caller explicitly typed `<slug>:<demo>`, this synthesizes
 *     `demos: [<demo>]` regardless of level — the worker will route only
 *     that demo through the d5/d6 driver, mirroring the legacy direct path's
 *     `target.demo` semantics (`buildDeepInputs`/`buildFullInputs` in
 *     `targets.ts`).
 *   - When `demo` is absent, level controls the demo set: d5 ("take-one")
 *     only needs the representative demo (`agentic-chat`), mirroring the
 *     like-staging overlay; d6 needs the slug's full demo set so the
 *     all-pills driver exercises every cell.
 */
export function buildLocalServicesJson(
  scopes: SlugScope[],
  level: ControlPlaneLevel,
  config: LocalConfig,
): string {
  const fromEnv = process.env.LOCAL_SERVICES_JSON;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  const records = scopes.map(({ slug, demo }) => {
    // BOTH AXES, derived from the manifest's `demo_frontend`. `demoBaseUrl` is
    // where the pages are (the integration's container, or
    // `http://frontend-nextjs:3000/<slug>` once migrated); `agentBaseUrl` is
    // always the integration's own container. Emitting only the first is what
    // made the fleet path unusable for a migrated slug; emitting the first
    // AS the agent URL would make a live frontend green a dead agent.
    const origins = getSlugContainerOrigins(slug, config);
    return {
      name: `showcase-${slug}`,
      publicUrl: origins.demoBaseUrl,
      agentBaseUrl: origins.agentBaseUrl,
      demos: demo
        ? [demo]
        : level === "d5"
          ? ["agentic-chat"]
          : demosForSlug(slug, config),
      // Thread the manifest's `not_supported_features` into the roster so the
      // worker's D6 driver reclassifies architecturally/upstream-blocked
      // features as `skipped-incapable` instead of red — LOCAL==STAGING parity.
      // Without this the discovery local-injection seam reads `[]` and NOTHING
      // gets skipped. Mirrors the legacy `--direct` path (`buildFullInputs` /
      // `buildDeepInputs` in `targets.ts`); `LocalServiceSchema` already accepts
      // the field and the enumerator already forwards it downstream.
      notSupportedFeatures:
        loadManifest(slug, config).not_supported_features ?? [],
    };
  });
  return JSON.stringify(records);
}

/**
 * Build the enumerator for the requested level — the EXACT factory
 * `runControlPlane` wires for the deep (d5) / full (d6) schedule. We narrow
 * the discovery filter to the requested slugs so a scoped CLI run
 * (`showcase test langgraph-python --d5`) enqueues only that service's job,
 * not the whole roster.
 */
function buildEnumerator(
  level: ControlPlaneLevel,
  slugs: string[],
  env: Readonly<Record<string, string | undefined>>,
  logger: Logger,
): ServiceEnumerator {
  // Narrow discovery to ONLY the requested services. The local roster names
  // them `showcase-<slug>`; restrict `namePrefix` to `showcase-` and exclude
  // every name that is not in the requested set is impossible without the
  // full roster, so instead we rely on the synthesized roster already
  // containing only the requested slugs (buildLocalServicesJson). When the
  // env supplies the roster, the producer enqueues every service in it.
  const filter = { namePrefix: "showcase-", nameExcludes: [] as string[] };

  if (level === "d5") {
    return createE2eDeepServiceEnumerator({
      source: railwayServicesSource,
      env,
      fetchImpl: globalThis.fetch,
      logger,
      filter,
    });
  }
  // d6: full all-pills enumerator (same prefix/driver kind the control-plane
  // wires for the d6 schedule).
  return createServiceEnumerator({
    source: railwayServicesSource,
    env,
    fetchImpl: globalThis.fetch,
    logger,
    driverKind: D6_DRIVER_KIND,
    probeKeyPrefix: "d6",
    filter,
  });
}

/**
 * The dashboard status keys a run is expected to terminate, derived from the
 * level + slug (+ optional demo scoping).
 *
 * Default (`demo` absent) semantics — UNCHANGED from the pre-A18 behavior:
 *   - d5 emits the aggregate `d5-single-pill-e2e:<slug>` plus the per-feature
 *     `d5:<slug>/<featureType>` side rows; the representative demo is
 *     `agentic-chat`, so we wait on `d5:<slug>/agentic-chat`.
 *   - d6 emits the per-service aggregate `d6:<slug>` cell.
 *
 * Per-demo scoping (`demo` set — operator typed `<slug>:<demo>`):
 *   - The worker emits side rows keyed by FEATURE TYPE, not demo ID. We
 *     translate the demo ID into its featureType(s) via the same
 *     `REGISTRY_TO_D5` mapping the d6 driver uses (`demosToFeatureTypes`),
 *     and wait on each resulting `<level>:<slug>/<featureType>` side row.
 *     The default-scope key (e.g. `d5:<slug>/agentic-chat` or the d6
 *     aggregate) is INTENTIONALLY OMITTED — the run is scoped to the demo,
 *     so substituting agentic-chat or waiting on the full-sweep aggregate
 *     would be the same false-positive bug A18 fixes.
 *   - If the demo ID does not map to any featureType (e.g. a registry
 *     feature outside the closed D5 set), throw — the run would otherwise
 *     enqueue but never produce a matching side row, hanging until timeout.
 */
export function expectedKeys(
  level: ControlPlaneLevel,
  slug: string,
  demo?: string,
): string[] {
  if (demo) {
    const featureTypes = demosToFeatureTypes([demo]);
    if (featureTypes.length === 0) {
      throw new Error(
        `control-plane ${level}: demo "${demo}" does not map to any D5 featureType ` +
          `(no entry in REGISTRY_TO_D5). The worker would not emit a matching ` +
          `side row — refusing to enqueue a run that cannot terminate.`,
      );
    }
    return featureTypes.map((ft) => `${level}:${slug}/${ft}`);
  }
  if (level === "d5") {
    return [`d5-single-pill-e2e:${slug}`, `d5:${slug}/agentic-chat`];
  }
  return [`d6:${slug}`];
}

interface StatusRow {
  key: string;
  state: string;
  updated: string;
}

// ───────────────────────────────────────────────────────────────────────
// CORRELATION GATE — read back THIS invocation's OWN jobs, never a
// foreign row that happens to share the probeKey.
//
// ── THE BUG THIS EXISTS TO PREVENT ──────────────────────────────────────
// The control-plane container runs its OWN producer on a cron, enqueuing
// jobs for the same services out of `LOCAL_SERVICES_JSON`. Those jobs carry
// the SAME `probe_key` (`d6:<slug>`) and therefore land on the SAME
// dashboard `status` row as the CLI's job.
//
// The CLI used to wait ONLY on `status` rows keyed by `probe_key`, freshness-
// filtered by `updated >= <tick time>`. That is not a correlation — it is a
// race. Observed: one invocation exited 0 with "1 passed" in 9.9 SECONDS,
// reading a foreign row, while its own 41-cell job had only just been claimed
// and ran for five more minutes before finishing RED. A second invocation
// exited 1 off a different foreign row. Every D6 verdict the CLI printed was
// a coin flip on which row landed first — a FALSE GREEN generator.
//
// ── THE FIX ─────────────────────────────────────────────────────────────
// Correlate on `probe_jobs.run_id`, which is the `runId` the producer tick we
// fired minted and returned (`TickResult.runId`, unique per tick per producer
// instance — see `defaultRunIdFactory`) and which the queue client denormalises
// onto every row it enqueues. Two phases:
//
//   1. Wait until EVERY `probe_jobs` row with `run_id = <our runId>` is
//      terminal (`done`/`failed`) AND `result_processed = true` — i.e. OUR
//      jobs finished and the result-consumer aggregated them. No foreign
//      row can satisfy this gate, and the CLI can no longer return before
//      its own work is done.
//   2. Take the verdict from OUR OWN job's `result` (`ServiceJobResult`)
//      wherever it covers an expected key. For d6 it always does: the
//      result carries `aggregateKey` = `d6:<slug>` and one `cells[].cellKey`
//      = `d6:<slug>/<featureId>` per cell. Any key our own results do NOT
//      cover falls back to a `status` row read — but only AFTER phase 1, so
//      the aggregator has already written this run's rows.
// ───────────────────────────────────────────────────────────────────────

/** `probe_jobs` statuses that mean the worker is finished with the job. */
const TERMINAL_JOB_STATUSES = new Set(["done", "failed"]);

/** The `probe_jobs` row fields the correlation gate reads. */
interface RunJobRow {
  id: string;
  probe_key: string;
  status: string;
  result?: unknown;
  result_processed?: boolean;
}

/** Escape a value for interpolation into a PocketBase filter string literal. */
function pbFilterLiteral(value: string): string {
  return JSON.stringify(value);
}

/** List every `probe_jobs` row stamped with `runId`. */
async function pbFetchRunJobs(
  url: string,
  token: string,
  runId: string,
): Promise<RunJobRow[]> {
  const qs = new URLSearchParams({
    perPage: "500",
    filter: `run_id = ${pbFilterLiteral(runId)}`,
    sort: "created",
  });
  const res = await fetch(
    `${url}/api/collections/probe_jobs/records?${qs.toString()}`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) {
    throw new Error(`PocketBase probe_jobs read failed: ${res.status}`);
  }
  const body = (await res.json()) as { items?: RunJobRow[] };
  return body.items ?? [];
}

/**
 * Phase 1 of the correlation gate. Block until all `expectedJobCount` rows
 * stamped with OUR `runId` exist, are terminal, and have been processed by the
 * result-consumer. Throws on timeout naming exactly which of our jobs is
 * outstanding — never falls through to a key-only read.
 */
export async function pollRunJobsUntilProcessed(
  pbUrl: string,
  token: string,
  runId: string,
  expectedJobCount: number,
  timeoutMs: number,
  pollIntervalMs: number,
  logger: Logger,
): Promise<RunJobRow[]> {
  if (runId.trim() === "") {
    // A tick that never ran mints the empty-string runId sentinel. Filtering
    // on it would match every row that has no run_id — the exact class of
    // foreign-row read this gate exists to prevent.
    throw new Error(
      "control-plane run produced an empty runId — refusing to poll for " +
        "results that cannot be correlated to this invocation's jobs",
    );
  }
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await pbFetchRunJobs(pbUrl, token, runId);
    const terminal = rows.filter((r) => TERMINAL_JOB_STATUSES.has(r.status));
    const processed = terminal.filter((r) => r.result_processed === true);
    if (rows.length >= expectedJobCount && processed.length === rows.length) {
      return processed;
    }
    logger.info("cli.control-plane.awaiting-own-jobs", {
      runId,
      seen: rows.length,
      want: expectedJobCount,
      terminal: terminal.length,
      processed: processed.length,
      pending: rows
        .filter((r) => !TERMINAL_JOB_STATUSES.has(r.status))
        .map((r) => `${r.probe_key}=${r.status}`),
    });
    if (Date.now() >= deadline) {
      throw new Error(
        `control-plane run ${runId} timed out after ${Math.round(
          timeoutMs / 1000,
        )}s waiting for its OWN ${expectedJobCount} job(s) to finish — ` +
          `saw ${rows.length} row(s), ${terminal.length} terminal, ` +
          `${processed.length} processed` +
          (rows.length > 0
            ? `: ${rows.map((r) => `${r.probe_key}=${r.status}`).join(", ")}`
            : ""),
      );
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * Phase 2 of the correlation gate. Project the per-key verdicts OUR OWN jobs
 * reported: `aggregateKey` → `aggregateState`, plus one entry per
 * `cells[].cellKey` → `cells[].state`. Rows whose `result` is missing or
 * unparseable contribute nothing (the caller then falls back to the `status`
 * row for those keys).
 *
 * Exported for unit testing.
 */
export function verdictsFromOwnJobs(rows: RunJobRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    let result = row.result;
    if (typeof result === "string") {
      try {
        result = JSON.parse(result) as unknown;
      } catch {
        continue;
      }
    }
    if (result === null || typeof result !== "object") continue;
    const r = result as {
      aggregateKey?: unknown;
      aggregateState?: unknown;
      cells?: unknown;
    };
    if (
      typeof r.aggregateKey === "string" &&
      r.aggregateKey.trim() !== "" &&
      typeof r.aggregateState === "string"
    ) {
      out.set(r.aggregateKey.trim(), r.aggregateState);
    }
    if (Array.isArray(r.cells)) {
      for (const cell of r.cells) {
        if (cell === null || typeof cell !== "object") continue;
        const c = cell as { cellKey?: unknown; state?: unknown };
        if (
          typeof c.cellKey === "string" &&
          c.cellKey.trim() !== "" &&
          typeof c.state === "string"
        ) {
          out.set(c.cellKey.trim(), c.state);
        }
      }
    }
  }
  return out;
}

/**
 * Poll PocketBase `status` for the run's expected keys, returning once every
 * key reached a terminal state newer than `sinceIso`.
 *
 * FALLBACK ONLY. This is a key-keyed read and therefore cannot distinguish our
 * run's row from a foreign producer's row for the same `probe_key` — that is
 * exactly the false-green defect the correlation gate above exists to close.
 * It survives for the keys our own job results do not project (today: the d5
 * aggregate row), and it is called STRICTLY AFTER phase 1 has confirmed our own
 * jobs finished and were aggregated, so the row it reads is this run's in every
 * non-adversarial ordering. Never call it as the primary verdict source.
 */
async function pollStatusUntilTerminal(
  pbUrl: string,
  token: string,
  keys: string[],
  sinceIso: string,
  timeoutMs: number,
  pollIntervalMs: number,
  logger: Logger,
): Promise<Map<string, StatusRow>> {
  const deadline = Date.now() + timeoutMs;
  const sinceMs = Date.parse(sinceIso.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await pbFetchStatus(pbUrl, token, keys);
    const fresh = new Map<string, StatusRow>();
    for (const key of keys) {
      const row = rows.get(key);
      if (!row) continue;
      const updMs = Date.parse(
        row.updated.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"),
      );
      if (Number.isNaN(updMs) || updMs >= sinceMs) {
        fresh.set(key, row);
      }
    }
    if (fresh.size === keys.length) {
      return fresh;
    }
    logger.info("cli.control-plane.polling", {
      have: fresh.size,
      want: keys.length,
      keys,
    });
    if (Date.now() >= deadline) {
      throw new Error(
        `control-plane run timed out after ${Math.round(timeoutMs / 1000)}s waiting for: ${keys
          .filter((k) => !fresh.has(k))
          .join(", ")}`,
      );
    }
    await sleep(pollIntervalMs);
  }
}

async function pbAuth(
  url: string,
  email: string,
  password: string,
): Promise<string> {
  // PB ≤0.22 uses /api/admins; 0.23+ uses /api/collections/_superusers. Try
  // the modern path first, fall back to the legacy one (mirrors pb-client).
  for (const path of [
    "/api/collections/_superusers/auth-with-password",
    "/api/admins/auth-with-password",
  ]) {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    });
    if (res.ok) {
      const body = (await res.json()) as { token?: string };
      if (body.token) return body.token;
    }
  }
  throw new Error(`PocketBase admin auth failed at ${url}`);
}

async function pbFetchStatus(
  url: string,
  token: string,
  keys: string[],
): Promise<Map<string, StatusRow>> {
  const filter = keys.map((k) => `key = ${JSON.stringify(k)}`).join(" || ");
  const qs = new URLSearchParams({
    perPage: "200",
    filter,
    sort: "-updated",
  });
  const res = await fetch(
    `${url}/api/collections/status/records?${qs.toString()}`,
    { headers: { Authorization: token } },
  );
  if (!res.ok) {
    throw new Error(`PocketBase status read failed: ${res.status}`);
  }
  const body = (await res.json()) as {
    items: Array<{ key: string; state: string; updated: string }>;
  };
  const out = new Map<string, StatusRow>();
  for (const item of body.items) {
    if (!out.has(item.key)) {
      out.set(item.key, {
        key: item.key,
        state: item.state,
        updated: item.updated,
      });
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drive a d5/d6 run through the control-plane and wait for the worker fleet
 * to write the run's terminal cells to PocketBase. Returns the per-key
 * terminal results.
 */
export async function runViaControlPlane(
  targets: TestTarget[],
  options: ControlPlaneRunOptions,
  config: LocalConfig,
  logger: Logger,
): Promise<TerminalResult[]> {
  const { level } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  // Deduplicate (slug, demo) pairs via the standalone helper (see
  // `dedupeScopes`): default-scoped repeats collapse to one record; an
  // explicit `slug:demo` is kept distinct from the bare slug for the same
  // slug, so `built-in-agent built-in-agent:tool-rendering` enqueues both
  // the default representative and the scoped per-demo job.
  const scopes = dedupeScopes(targets);
  // The slug-only set is intentionally re-deduped here even though
  // `dedupeScopes` already collapses bare-slug repeats: a caller passing
  // multiple per-demo scopes for the same slug (e.g. `slug:a slug:b`) is
  // preserved by `dedupeScopes` but should reduce to a single discovery
  // filter entry - `buildEnumerator`'s narrow wants the slug SET, not
  // the (slug, demo) set.
  const slugs = [...new Set(scopes.map((s) => s.slug))];

  const creds = resolvePbCreds(config);

  // Build the discovery env the enumerator reads — the SAME static-injection
  // seam staging's control-plane container uses.
  const localServicesJson = buildLocalServicesJson(scopes, level, config);
  const env: Record<string, string | undefined> = {
    ...process.env,
    LOCAL_SERVICES_JSON: localServicesJson,
  };

  // Display the per-scope label so an operator sees the demo qualifier
  // (`<slug>:<demo>`) on the CLI banner, mirroring how the legacy direct path
  // labels a per-demo run.
  const scopeLabel = scopes
    .map((s) => (s.demo ? `${s.slug}:${s.demo}` : s.slug))
    .join(", ");
  console.log(
    `\n  \x1b[36mControl-plane ${level.toUpperCase()} run:\x1b[0m ${scopeLabel}`,
  );
  logger.info("cli.control-plane.start", {
    level,
    scopes,
    pbUrl: creds.url,
  });

  // -- Build the producer exactly as runControlPlane wires it ---------------
  const pb = createPbClient({
    url: creds.url,
    email: creds.email,
    password: creds.password,
    logger,
  });
  const claim = createJobClaimClient({
    url: creds.url,
    email: creds.email,
    password: creds.password,
    logger,
  });
  const queue = createFleetQueueClient({ pb, claim, logger });
  const enumerate = buildEnumerator(level, slugs, env, logger);
  // §4.2: a triggered tick must stamp the SAME family id the scheduled
  // producer for this level would, so the run aggregates into the correct
  // family on the /api/runs projection. Resolve it through the §5.1 registry
  // (never a hardcoded literal) so a registry rename breaks loudly here.
  const producer = createJobProducer({
    queue,
    enumerate,
    logger,
    family: familyForLevel(level),
  });

  // -- Mark when we triggered so polling only reads THIS run's cells --------
  const sinceIso = new Date().toISOString();

  // -- Fire one operator-triggered tick → enqueue onto probe_jobs -----------
  producer.start();
  let enqueued = 0;
  let enqueueFailures = 0;
  // The run batch id THIS invocation minted. It is the correlation key for the
  // result read-back — see the CORRELATION GATE block above.
  let runId = "";
  try {
    const tick = await producer.tick({ triggered: true });
    enqueued = tick.enqueued;
    enqueueFailures = tick.enqueueFailures ?? 0;
    runId = tick.runId;
    console.log(
      `  \x1b[2mEnqueued ${tick.enqueued} job(s) (runId ${tick.runId})\x1b[0m`,
    );
    logger.info("cli.control-plane.tick", {
      runId: tick.runId,
      enqueued: tick.enqueued,
      enqueueFailures: tick.enqueueFailures,
    });
  } finally {
    await producer.stop();
  }

  // Use the demo-aware label so a per-demo zero-enqueue surfaces the qualifier
  // (`<slug>:<demo>`) instead of just the slug; guard the empty-targets edge
  // case so the error doesn't render with a double-space gap.
  const failureLabel = scopeLabel.length > 0 ? scopeLabel : "(no targets)";
  if (enqueued === 0) {
    throw new Error(
      `control-plane enqueued 0 jobs for ${failureLabel} — check LOCAL_SERVICES_JSON / discovery filter`,
    );
  }

  // Finding 3: partial enqueue failures used to be logged-only, so the run
  // would proceed and silently report green if the surviving jobs happened to
  // pass. Treat any enqueue failure as fatal — the operator asked for N jobs
  // and only M < N reached the queue; the remainder will never report a cell
  // and the poll loop would hang to timeout (or, worse on partial coverage,
  // mask a real failure).
  if (enqueueFailures > 0) {
    throw new Error(
      `control-plane enqueue had ${enqueueFailures} failure(s) for ${failureLabel} — ` +
        `partial enqueue would mask missing cells; aborting before poll`,
    );
  }

  // -- Wait for the worker fleet to drain + the aggregator to write cells ---
  // Iterate scopes (NOT bare slugs) so per-demo runs wait on per-cell keys
  // (`<level>:<slug>/<featureType>`) instead of the default-scope key.
  const allKeys = scopes.flatMap(({ slug, demo }) =>
    expectedKeys(level, slug, demo),
  );
  console.log(
    `  \x1b[2mWaiting for worker fleet to produce cells: ${allKeys.join(", ")}\x1b[0m`,
  );

  const token = await pbAuth(creds.url, creds.email, creds.password);
  const deadlineMs = Date.now() + timeoutMs;

  // ── PHASE 1: correlation gate ────────────────────────────────────────────
  // Block on OUR OWN jobs (`probe_jobs.run_id = runId`). This is what makes the
  // verdict trustworthy: the control-plane container's cron producer enqueues
  // jobs with the SAME probe_key onto the SAME status row, and a key-only read
  // would happily return whichever landed first. It once returned "1 passed" in
  // 9.9s while this invocation's own 41-cell job was still running (and later
  // finished RED).
  const ownJobs = await pollRunJobsUntilProcessed(
    creds.url,
    token,
    runId,
    enqueued,
    timeoutMs,
    pollIntervalMs,
    logger,
  );
  const ownVerdicts = verdictsFromOwnJobs(ownJobs);
  logger.info("cli.control-plane.own-jobs-processed", {
    runId,
    jobs: ownJobs.length,
    projectedKeys: ownVerdicts.size,
  });

  // ── PHASE 2: verdicts ───────────────────────────────────────────────────
  // Prefer OUR job's own reported state. For d6 this covers every expected key
  // (`aggregateKey` = `d6:<slug>`, one `cells[].cellKey` per cell), so the
  // verdict never touches the shared status row at all. Only keys our own
  // results do not project fall back to a status read — and only now, after
  // phase 1 proved the aggregator wrote this run's rows.
  const fallbackKeys = allKeys.filter((k) => !ownVerdicts.has(k));
  let terminalRows = new Map<string, StatusRow>();
  if (fallbackKeys.length > 0) {
    logger.info("cli.control-plane.status-fallback", {
      runId,
      keys: fallbackKeys,
      reason:
        "these keys are not projected by this run's own job results; " +
        "falling back to the shared status row",
    });
    terminalRows = await pollStatusUntilTerminal(
      creds.url,
      token,
      fallbackKeys,
      sinceIso,
      Math.max(pollIntervalMs, deadlineMs - Date.now()),
      pollIntervalMs,
      logger,
    );
  }

  const results: TerminalResult[] = [];
  for (const key of allKeys) {
    const ownState = ownVerdicts.get(key);
    const state = (ownState ??
      terminalRows.get(key)?.state ??
      "error") as TerminalResult["state"];
    results.push({
      key,
      state,
      durationMs: 0,
      error: state !== "green" ? `state=${state}` : undefined,
    });
  }
  return results;
}
