/**
 * Prod re-sweep enqueue + freshness wait + equivalence gate (UNIT U10, spec §6.2).
 *
 * ── WHAT THIS DOES ────────────────────────────────────────────────────────
 * After a cluster promote has re-pinned the closure on prod (U4's
 * `promote-fleet.sh` ran in the `promote` job), the verification of "did prod
 * actually come up equivalent to staging?" cannot trust the FROZEN prod status
 * rows: they describe the pre-promote prod. So this module:
 *
 *   1. ENQUEUE — fires a fresh D-level sweep on the PROD control plane (prod
 *      harness scheduler/producer → prod `probe_jobs` queue → prod
 *      harness-workers → result-aggregator), scoped to the promoted Tier-2
 *      integration closure. This is NOT a new probe path — it is one
 *      operator-TRIGGERED producer tick against prod, the SAME
 *      producer→queue→worker wiring `bin/showcase test --d5/--d6` drives
 *      locally (`runViaControlPlane` / `createJobProducer`). The CLI host only
 *      enqueues + polls; the prod workers run the drivers inside the prod
 *      network.
 *
 *   2. POLL — waits until EVERY promoted cell has at least one contributing
 *      prod `status` row whose `observed_at` post-dates the re-sweep TRIGGER
 *      instant, or a 20-minute timeout → REFUSE "re-sweep did not complete".
 *      A pre-trigger row is the pre-promote prod and is not evidence about the
 *      just-promoted prod (mirrors equivalence-gate §6.4 freshness).
 *
 *   3. GATE — runs U9's `runEquivalenceGate` over the freshly-swept prod rows
 *      vs the current staging rows. Promote success flips to the equivalence
 *      definition: FAIL only on a cell green-on-staging / not-green-on-prod,
 *      gray/stale excluded, one-directional (prod greener passes).
 *
 * ── FALLBACK (spec §4.4 / §8.1) ───────────────────────────────────────────
 * Prod `harness-workers` is an out-of-PR operational prerequisite. Until it is
 * provisioned, the prod scheduler runs the probes INLINE (degraded throughput
 * but functional). The enqueue layer reports `workersProvisioned`; this gate
 * ANNOTATES fallback mode in its result/summary and does NOT block on it — the
 * provisioning decision is a maintainer prereq, not a code unit.
 *
 * ── TESTABILITY ───────────────────────────────────────────────────────────
 * The orchestration (enqueue → poll-for-freshness → gate) is pure over an
 * injected `ProdControlPlane` (enqueue + read-prod-status) + injected
 * `readStagingStatus` + clock + sleep, so the whole path is unit-tested against
 * a FAKE prod control-plane (no Railway, no PocketBase). The CLI entrypoint at
 * the bottom wires the REAL prod control-plane (`createRealProdControlPlane`,
 * dynamically importing the harness producer/queue wiring) and the prod/staging
 * PocketBase readers.
 */

import { runEquivalenceGate } from "./equivalence-gate";
import type { EquivalenceGateResult, GateCell } from "./equivalence-gate";
import {
  keyFor,
  CATALOG_TO_D5_KEY,
  STARTER_LEVELS,
} from "../shell-dashboard/src/lib/live-status";
import type {
  LiveStatusMap,
  StatusRow,
} from "../shell-dashboard/src/lib/live-status";
import { STARTER_TO_COLUMN } from "../harness/src/probes/helpers/starter-mapping";

/** Default re-sweep ceiling (spec §6.2): 20 minutes → REFUSE on timeout. */
export const DEFAULT_RESWEEP_TIMEOUT_MS = 20 * 60_000;
/** How often to re-read prod PocketBase for post-trigger freshness. */
export const DEFAULT_RESWEEP_POLL_INTERVAL_MS = 15_000;

/** Outcome of the prod enqueue tick. */
export interface ProdEnqueueResult {
  /** Epoch ms the re-sweep was triggered (the freshness watermark). */
  triggerAt: number;
  /** Number of per-cell jobs that reached the prod queue. */
  enqueued: number;
  /** Number of jobs that FAILED to enqueue (any > 0 = REFUSE). */
  enqueueFailures: number;
  /**
   * False when prod `harness-workers` is unprovisioned and the scheduler is
   * running probes inline (degraded fallback, §4.4). Annotated, never blocked.
   */
  workersProvisioned: boolean;
}

/**
 * The prod control-plane seam. Production wires this to the harness
 * producer/queue (enqueue) + a prod PocketBase reader (readProdStatus); tests
 * inject a fake.
 */
export interface ProdControlPlane {
  /**
   * Fire ONE operator-triggered producer tick against PROD, scoped to the
   * promoted closure, returning the trigger instant + enqueue accounting.
   * `atMs` is the caller's clock reading for the trigger watermark.
   */
  enqueue(atMs: number): Promise<ProdEnqueueResult>;
  /** Read the current prod `status` rows into a LiveStatusMap. */
  readProdStatus(): Promise<LiveStatusMap>;
}

/** Test alias — a fake that satisfies {@link ProdControlPlane}. */
export type FakeProdControlPlane = ProdControlPlane;

/**
 * The per-axis enqueue accounting a real enqueue seam returns. The real prod
 * enqueue fans out over TWO axes (agent d6 producer tick + starter_smoke
 * trigger); each seam reports how many jobs landed and how many failed, and
 * {@link createRealProdControlPlane} sums them into the {@link ProdEnqueueResult}.
 */
export interface EnqueueAxisResult {
  enqueued: number;
  enqueueFailures: number;
}

/**
 * The AGENT-axis enqueue seam: fire a TRIGGERED d6 producer tick scoped to the
 * given harness slugs against prod. Defaults to the real harness
 * producer→queue wiring; tests inject a fake.
 */
export type AgentEnqueueFn = (
  agentSlugs: string[],
  atMs: number,
) => Promise<EnqueueAxisResult>;

/**
 * The STARTER-axis enqueue seam: TRIGGER the prod `starter_smoke` CRON probe,
 * scoped to the given `starter_smoke:starter-<rawSlug>` filter keys. Defaults
 * to an HTTP POST to the prod harness `/api/probes/starter_smoke/trigger`
 * endpoint; tests inject a fake.
 */
export type StarterEnqueueFn = (
  starterTriggerKeys: string[],
  atMs: number,
) => Promise<EnqueueAxisResult>;

/** Injected dependencies for the prod re-sweep + gate. */
export interface ProdResweepDeps {
  /** The prod control-plane (enqueue + read prod status). */
  controlPlane: ProdControlPlane;
  /** The promoted closure as gate cells (caller enumerates from U3/U4 output). */
  cells: GateCell[];
  /** Read the current staging `status` rows into a LiveStatusMap. */
  readStagingStatus(): Promise<LiveStatusMap>;
  /** Epoch-ms clock. Defaults to `Date.now`. */
  now?: () => number;
  /** Sleep helper (ms). Defaults to a real `setTimeout` wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Polling tunables for {@link pollProdFreshness}. */
export interface FreshnessPollOptions {
  /** The re-sweep trigger watermark (epoch ms); rows must post-date it. */
  triggerAt: number;
  /** Ceiling before REFUSE. Default {@link DEFAULT_RESWEEP_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Re-read cadence. Default {@link DEFAULT_RESWEEP_POLL_INTERVAL_MS}. */
  pollIntervalMs?: number;
}

/** The full result of a verify-prod re-sweep + equivalence gate. */
export interface VerifyProdResweepResult {
  /** When the re-sweep was triggered (epoch ms). */
  triggerAt: number;
  /** Whether prod workers were provisioned (false = inline fallback, §4.4). */
  workersProvisioned: boolean;
  /** The equivalence-gate verdict over the FRESH prod vs staging rows. */
  gate: EquivalenceGateResult;
  /** A human-readable summary for `$GITHUB_STEP_SUMMARY` + Slack. */
  summary: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enumerate the prod `status` keys a single cell derives from. A cell is
 * considered FRESH iff at least one of these keys has a post-trigger row. This
 * mirrors the keyspace `equivalence-gate.newestProdObservation` /
 * `buildCellModel`'s resolvers fan out over (e2e, chat/tools, health, and the
 * per-cell d5/d6 family) so the freshness verdict cannot diverge from the rows
 * the chip is derived from.
 */
export function freshnessKeysForCell(cell: GateCell): string[] {
  const { slug, featureId } = cell;
  // STARTER axis: a starter cell is probed on the `starter_smoke` matrix, whose
  // rows are keyed `starter:<columnSlug>/<level>`. It never writes the agent
  // e2e/chat/tools/health + d5/d6 rows, so freshness must consult ITS keyspace
  // — mirroring `equivalence-gate.newestProdObservation` and the rows
  // `buildCellModel`'s `resolveStarterChip` derives from.
  if (cell.probeAxis === "starter") {
    return STARTER_LEVELS.map((level) => keyFor("starter", slug, level));
  }
  if (featureId === null) {
    return [keyFor("health", slug), keyFor("agent", slug)];
  }
  const keys: string[] = [
    keyFor("e2e", slug, featureId),
    keyFor("chat", slug),
    keyFor("tools", slug),
    keyFor("health", slug),
  ];
  const familyKeys = CATALOG_TO_D5_KEY[featureId];
  if (familyKeys) {
    for (const ft of familyKeys) {
      keys.push(keyFor("d5", slug, ft));
      keys.push(keyFor("d6", slug, ft));
    }
  }
  return keys;
}

/**
 * The newest prod `observed_at` (epoch ms) across every key a cell derives
 * from, or `null` when the cell has NO contributing prod row at all. An
 * unparseable `observed_at` cannot establish recency and is skipped (it can
 * never beat the trigger), failing safe toward "not fresh".
 */
function newestObservation(rows: LiveStatusMap, cell: GateCell): number | null {
  let newest: number | null = null;
  for (const key of freshnessKeysForCell(cell)) {
    const r = rows.get(key);
    if (!r) continue;
    const ms = Date.parse(r.observed_at);
    if (Number.isNaN(ms)) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

/** True iff the cell has at least one contributing row at/after `triggerAt`. */
function cellIsFresh(
  rows: LiveStatusMap,
  cell: GateCell,
  triggerAt: number,
): boolean {
  const newest = newestObservation(rows, cell);
  return newest !== null && newest >= triggerAt;
}

/**
 * Fire the prod re-sweep enqueue and validate the tick landed jobs for the
 * WHOLE closure. REFUSES (throws) on a zero-enqueue or any partial enqueue
 * failure — a cell whose job never reached the prod queue would never produce
 * a fresh row, so the freshness poll could only ever time out (or, worse, a
 * surviving subset could mask the missing cells). Mirrors the CLI
 * control-plane's fail-loud enqueue guards (`runViaControlPlane`).
 */
export async function enqueueProdResweep(
  deps: ProdResweepDeps,
): Promise<ProdEnqueueResult> {
  const now = deps.now ?? Date.now;
  const res = await deps.controlPlane.enqueue(now());
  if (res.enqueued === 0) {
    throw new Error(
      "prod re-sweep enqueued 0 jobs — no cell would ever produce a fresh row; " +
        "refusing before the freshness poll (check the promoted closure / prod discovery)",
    );
  }
  if (res.enqueueFailures > 0) {
    throw new Error(
      `prod re-sweep had ${res.enqueueFailures} enqueue failure(s) — the missing ` +
        "cells will never report a fresh row; refusing before the freshness poll",
    );
  }
  return res;
}

/**
 * Poll prod PocketBase until EVERY promoted cell has a contributing row whose
 * `observed_at` post-dates `triggerAt`, then return the prod LiveStatusMap.
 * Throws "re-sweep did not complete" on timeout (spec §6.2 REFUSE).
 */
export async function pollProdFreshness(
  deps: ProdResweepDeps,
  opts: FreshnessPollOptions,
): Promise<LiveStatusMap> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RESWEEP_TIMEOUT_MS;
  const pollIntervalMs =
    opts.pollIntervalMs ?? DEFAULT_RESWEEP_POLL_INTERVAL_MS;
  const deadline = now() + timeoutMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const prodRows = await deps.controlPlane.readProdStatus();
    const stale = deps.cells.filter(
      (cell) => !cellIsFresh(prodRows, cell, opts.triggerAt),
    );
    if (stale.length === 0) {
      return prodRows;
    }
    if (now() >= deadline) {
      const label = stale.map((c) => `${c.slug}/${c.featureId}`).join(", ");
      throw new Error(
        `re-sweep did not complete: ${stale.length} of ${deps.cells.length} ` +
          `promoted cell(s) had no prod row post-dating the trigger within ` +
          `${Math.round(timeoutMs / 60_000)}m: ${label}`,
      );
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * Build the workflow-summary / Slack text. Prefixes the equivalence-gate
 * summary with the re-sweep mode banner (fallback annotation, §4.4).
 */
function buildSummary(
  res: ProdEnqueueResult,
  gate: EquivalenceGateResult,
): string {
  const mode = res.workersProvisioned
    ? "prod harness-workers (full throughput)"
    : "scheduler INLINE fallback — prod harness-workers unprovisioned (§4.4, degraded throughput)";
  return (
    `Prod re-sweep mode: ${mode}.\n` +
    `Triggered ${res.enqueued} job(s) at ${new Date(res.triggerAt).toISOString()}.\n` +
    gate.summary
  );
}

/**
 * Full verify-prod re-sweep: enqueue a fresh prod sweep over the promoted
 * closure, wait for every cell to report a post-trigger row (or REFUSE on
 * timeout), then run U9's equivalence gate over the FRESH prod vs current
 * staging rows. Returns the gate verdict + fallback annotation.
 */
export async function runVerifyProdResweep(
  deps: ProdResweepDeps,
  opts: Partial<FreshnessPollOptions> = {},
): Promise<VerifyProdResweepResult> {
  const now = deps.now ?? Date.now;
  const enqueueRes = await enqueueProdResweep(deps);

  const prodRows = await pollProdFreshness(deps, {
    triggerAt: enqueueRes.triggerAt,
    timeoutMs: opts.timeoutMs,
    pollIntervalMs: opts.pollIntervalMs,
  });

  const stagingRows = await deps.readStagingStatus();

  const gate = runEquivalenceGate({
    cells: deps.cells,
    stagingRows,
    prodRows,
    reSweepTriggerAt: enqueueRes.triggerAt,
    now: now(),
  });

  return {
    triggerAt: enqueueRes.triggerAt,
    workersProvisioned: enqueueRes.workersProvisioned,
    gate,
    summary: buildSummary(enqueueRes, gate),
  };
}

// Re-export the gate row shape so callers building maps have one import site.
export type { StatusRow };

// ===========================================================================
// REAL prod control-plane wiring + CLI entrypoint
//
// Everything above is pure over the injected `ProdControlPlane` + readers and
// is what the unit tests exercise against a FAKE prod control-plane. Below is
// the production wiring the `verify-prod` workflow job invokes
// (`npx tsx verify-prod-resweep.ts`). It is intentionally thin — all the
// orchestration logic lives in the pure core above.
// ===========================================================================

import { resolve as resolvePath } from "node:path";
import type { createJobProducer } from "../harness/src/fleet/control-plane/job-producer";
import type { createServiceEnumerator } from "../harness/src/fleet/control-plane/catalog-enumerator";
import type { FLEET_FAMILIES } from "../harness/src/fleet/control-plane/run-view";
import type { createFleetQueueClient } from "../harness/src/fleet/queue-client";
import type { createPbClient } from "../harness/src/storage/pb-client";
import type { createJobClaimClient } from "../harness/src/fleet/job-claim";
import type { railwayServicesSource } from "../harness/src/probes/discovery/railway-services";
import type { Logger } from "../harness/src/types/index";

// The prod ENQUEUE reuses the harness producer→queue wiring (the SAME path
// `runViaControlPlane` drives — spec §6.2, not a new probe path). That import
// graph is heavy (croner / playwright / zod, ~28 harness files), so it is
// loaded via a DYNAMIC `import()` INSIDE the enqueue call rather than at module
// top: the pure orchestration core, the unit tests (which inject a FAKE control
// plane), and the config-absent no-op path never pay for — or even need — the
// harness graph. Only a real prod enqueue (where the harness package is
// installed alongside) materializes it. The relative `../harness/src/...`
// specifiers mirror the established cross-package pattern in
// `provision-starter-fleet.ts`.
type HarnessProducerWiring = {
  createJobProducer: typeof createJobProducer;
  createServiceEnumerator: typeof createServiceEnumerator;
  D6_DRIVER_KIND: string;
  FLEET_FAMILIES: typeof FLEET_FAMILIES;
  createFleetQueueClient: typeof createFleetQueueClient;
  createPbClient: typeof createPbClient;
  createJobClaimClient: typeof createJobClaimClient;
  railwayServicesSource: typeof railwayServicesSource;
};

async function loadHarnessProducerWiring(): Promise<HarnessProducerWiring> {
  const [
    jobProducer,
    catalogEnumerator,
    runView,
    queueClient,
    pbClient,
    jobClaim,
    discovery,
  ] = await Promise.all([
    import("../harness/src/fleet/control-plane/job-producer"),
    import("../harness/src/fleet/control-plane/catalog-enumerator"),
    import("../harness/src/fleet/control-plane/run-view"),
    import("../harness/src/fleet/queue-client"),
    import("../harness/src/storage/pb-client"),
    import("../harness/src/fleet/job-claim"),
    import("../harness/src/probes/discovery/railway-services"),
  ]);
  return {
    createJobProducer: jobProducer.createJobProducer,
    createServiceEnumerator: catalogEnumerator.createServiceEnumerator,
    D6_DRIVER_KIND: catalogEnumerator.D6_DRIVER_KIND,
    FLEET_FAMILIES: runView.FLEET_FAMILIES,
    createFleetQueueClient: queueClient.createFleetQueueClient,
    createPbClient: pbClient.createPbClient,
    createJobClaimClient: jobClaim.createJobClaimClient,
    railwayServicesSource: discovery.railwayServicesSource,
  };
}

/** PocketBase superuser creds + base URL for one env's status reader. */
interface PbCreds {
  url: string;
  email: string;
  password: string;
}

/**
 * Read one env's `status` collection into a LiveStatusMap via the PocketBase
 * REST API. Mirrors the dashboard's bulk fetch — full rows (signal included,
 * which `buildCellModel`/U7 needs to read `errorClass`/`errorDesc`), paged.
 * Fails loud on an auth or read error: a silent empty map would make the
 * equivalence gate vacuously pass.
 */
async function readPbStatus(creds: PbCreds): Promise<LiveStatusMap> {
  const token = await pbAuth(creds);
  const map: LiveStatusMap = new Map();
  let page = 1;
  // PB caps perPage at 500; page until totalPages is exhausted.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const qs = new URLSearchParams({
      page: String(page),
      perPage: "500",
      sort: "-updated",
    });
    const res = await fetch(
      `${creds.url}/api/collections/status/records?${qs.toString()}`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) {
      throw new Error(
        `PocketBase status read failed at ${creds.url}: ${res.status}`,
      );
    }
    const body = (await res.json()) as {
      items: StatusRow[];
      totalPages: number;
    };
    for (const item of body.items) {
      // Keep the NEWEST row per key (sorted -updated → first wins).
      if (!map.has(item.key)) map.set(item.key, item);
    }
    if (page >= body.totalPages || body.items.length === 0) break;
    page += 1;
  }
  return map;
}

async function pbAuth(creds: PbCreds): Promise<string> {
  // PB ≤0.22 uses /api/admins; 0.23+ uses /api/collections/_superusers
  // (mirror control-plane-run.ts + pb-client).
  for (const path of [
    "/api/collections/_superusers/auth-with-password",
    "/api/admins/auth-with-password",
  ]) {
    const res = await fetch(`${creds.url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: creds.email, password: creds.password }),
    });
    if (res.ok) {
      const b = (await res.json()) as { token?: string };
      if (b.token) return b.token;
    }
  }
  throw new Error(`PocketBase admin auth failed at ${creds.url}`);
}

/** Resolve a required env var or fail loud. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(`${name} is not set — required for the prod re-sweep`);
  }
  return v.trim();
}

/** Create one privacy-bounded stderr method for the CLI producer logger. */
const createCliLogMethod =
  (level: string) =>
  (msg: string, meta?: Record<string, unknown>): void => {
    const tail = meta ? ` ${JSON.stringify(meta)}` : "";
    console.error(`[verify-prod-resweep] ${level} ${msg}${tail}`);
  };

/** Minimal stderr logger for the prod producer wiring (CLI context). */
function createCliLogger(): Logger {
  return {
    info: createCliLogMethod("info"),
    warn: createCliLogMethod("warn"),
    error: createCliLogMethod("error"),
    debug: () => {},
  };
}

/** Resolve the §5.1 registry family id for the d6 level (fail loud on rename). */
function d6Family(families: HarnessProducerWiring["FLEET_FAMILIES"]): string {
  const entry = families.find((f) => f.family === "d6");
  if (!entry) {
    throw new Error(
      'no FLEET_FAMILIES entry for "d6" — the prod re-sweep must stamp a §5.1 registry family',
    );
  }
  return entry.family;
}

/**
 * The default AGENT-axis enqueue: a TRIGGERED d6 producer tick scoped to the
 * promoted harness slugs against PROD. REUSES the EXISTING producer→queue→worker
 * path verbatim — the SAME `createJobProducer` + `createFleetQueueClient` +
 * `producer.tick({ triggered: true })` wiring `runViaControlPlane`
 * (`harness/src/cli/control-plane-run.ts`) drives for `bin/showcase test --d6`,
 * only pointed at the PROD PocketBase + PROD Railway environment (no
 * `LOCAL_SERVICES_JSON` → real prod discovery). We do NOT re-implement the
 * producer (that would be a drift-prone second copy) and we do NOT invent a new
 * probe path (spec §6.2 / ambiguity #4): a TRIGGERED d6 tick is exactly the
 * operator-trigger seam the producer already exposes (`EnumerateContext.triggered`).
 *
 * The host only ENQUEUES + POLLS prod PB. The prod `harness-workers` claim the
 * `probe_jobs` and run the drivers inside the prod network. When prod
 * `harness-workers` is unprovisioned (§4.4), the prod scheduler drains the
 * queue INLINE (degraded throughput, still functional) — the enqueue path is
 * identical; we annotate `workersProvisioned: false`.
 *
 * Discovery is scoped to the promoted slugs by a post-enumerate filter: the
 * prod Railway roster is `showcase-<slug>`, so we keep the `showcase-` prefix
 * then drop every discovered service whose slug is NOT in the promoted set
 * (mirrors `runViaControlPlane`'s per-slug narrowing).
 *
 * A starter-only closure yields ZERO agent slugs — this seam is a no-op then
 * (we never spin up the heavy producer graph), so the d6 path is not driven for
 * a closure that has nothing on the agent axis.
 */
function makeAgentEnqueue(args: {
  prodPb: PbCreds;
  prodRailwayEnv: {
    token: string;
    projectId: string;
    environmentId: string;
  };
  logger: Logger;
}): AgentEnqueueFn {
  // The prod discovery env the enumerator reads (NO LOCAL_SERVICES_JSON → the
  // railway-services source queries the prod Railway environment).
  const discoveryEnv: Record<string, string | undefined> = {
    ...process.env,
    LOCAL_SERVICES_JSON: undefined,
    RAILWAY_TOKEN: args.prodRailwayEnv.token,
    RAILWAY_PROJECT_ID: args.prodRailwayEnv.projectId,
    RAILWAY_ENVIRONMENT_ID: args.prodRailwayEnv.environmentId,
  };
  return async (agentSlugs: string[]): Promise<EnqueueAxisResult> => {
    // No agent-axis cells (e.g. a starter-only closure) → nothing to enqueue
    // on the d6 path; skip the heavy harness producer graph entirely.
    if (agentSlugs.length === 0) {
      return { enqueued: 0, enqueueFailures: 0 };
    }
    // `agentSlugs` are the HARNESS slugs (the `showcase-` prefix stripped — see
    // cellsFromClosureCsv), the SAME normalization the discovery enumerator's
    // `serviceSlug` (= `deriveSlug(name)`) produces, so `requested.has(serviceSlug)`
    // below matches the promoted integrations and enqueues one job per cell.
    const requested = new Set(agentSlugs);
    // Materialize the heavy harness producer graph only now (real enqueue).
    const w = await loadHarnessProducerWiring();
    const pb = w.createPbClient({
      url: args.prodPb.url,
      email: args.prodPb.email,
      password: args.prodPb.password,
      logger: args.logger,
    });
    const claim = w.createJobClaimClient({
      url: args.prodPb.url,
      email: args.prodPb.email,
      password: args.prodPb.password,
      logger: args.logger,
    });
    const queue = w.createFleetQueueClient({ pb, claim, logger: args.logger });
    const enumerate = w.createServiceEnumerator({
      source: w.railwayServicesSource,
      env: discoveryEnv,
      fetchImpl: globalThis.fetch,
      logger: args.logger,
      driverKind: w.D6_DRIVER_KIND,
      probeKeyPrefix: "d6",
      // Narrow the prod roster to the promoted slugs only: keep the
      // `showcase-` prefix, then exclude every discovered service whose
      // slug is not in the promoted set. Discovery applies `nameExcludes`
      // after `namePrefix`, so a precomputed exclusion list cannot drop a
      // slug we want; we instead post-filter the enumerated specs below.
      filter: { namePrefix: "showcase-", nameExcludes: [] as string[] },
    });
    const producer = w.createJobProducer({
      queue,
      // Wrap the enumerator to drop any spec whose slug was NOT promoted —
      // a TRIGGERED tick over the whole roster would re-sweep unrelated
      // integrations and inflate the freshness wait.
      enumerate: async (ctx) => {
        const all = await enumerate(ctx);
        return all.filter((s) => requested.has(s.serviceSlug));
      },
      logger: args.logger,
      family: d6Family(w.FLEET_FAMILIES),
    });

    producer.start();
    try {
      const tick = await producer.tick({
        triggered: true,
        filter: { slugs: agentSlugs },
      });
      return {
        enqueued: tick.enqueued,
        enqueueFailures: tick.enqueueFailures ?? 0,
      };
    } finally {
      await producer.stop();
    }
  };
}

/**
 * The default STARTER-axis enqueue: TRIGGER the prod `starter_smoke` CRON probe,
 * scoped to the promoted starters' `starter_smoke:starter-<rawSlug>` keys. The
 * starter_smoke probe is NOT a control-plane producer family (the d6 discovery
 * filter EXCLUDES `starter-*` services), so it never flows through the
 * `createJobProducer` path. Its operator-trigger seam is the prod harness
 * `POST /api/probes/starter_smoke/trigger` route (`harness/src/http/probes.ts`),
 * which accepts a `{ filter: { slugs } }` body and narrows the probe's
 * discovered targets to the post-`key_template` keys before fan-out. Triggering
 * it makes the prod starter_smoke driver re-probe ONLY the promoted starters and
 * write fresh `starter:<col>/<level>` rows — exactly the keys
 * {@link freshnessKeysForCell} waits on for a starter cell.
 *
 * A closure with no starter cells yields ZERO trigger keys — this seam is then a
 * no-op (no trigger POST), mirroring the agent seam's empty-slug short-circuit.
 */
function makeStarterEnqueue(args: {
  prodHarnessBaseUrl: string;
  prodHarnessTriggerToken: string;
  logger: Logger;
}): StarterEnqueueFn {
  return async (starterTriggerKeys: string[]): Promise<EnqueueAxisResult> => {
    if (starterTriggerKeys.length === 0) {
      return { enqueued: 0, enqueueFailures: 0 };
    }
    const url = `${args.prodHarnessBaseUrl.replace(/\/$/, "")}/api/probes/${STARTER_SMOKE_PROBE_ID}/trigger`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${args.prodHarnessTriggerToken}`,
        },
        body: JSON.stringify({ filter: { slugs: starterTriggerKeys } }),
      });
    } catch (err) {
      // A transport failure means the starter_smoke tick never fired — fail
      // loud so the enqueue REFUSES rather than the freshness poll timing out
      // 20 minutes later with a confusing "starter never reported" message.
      throw new Error(
        `prod starter_smoke trigger POST failed (${url}): ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    if (!res.ok) {
      throw new Error(
        `prod starter_smoke trigger returned ${res.status} at ${url} — ` +
          "the starter cells will never report a fresh row; refusing before the freshness poll",
      );
    }
    args.logger.info("verify-prod-resweep.starter-trigger", {
      keys: starterTriggerKeys,
    });
    // One starter_smoke tick covers every requested starter target; count one
    // enqueued job per filter key so the caller's zero-enqueue guard treats a
    // starter-only closure as a real enqueue.
    return { enqueued: starterTriggerKeys.length, enqueueFailures: 0 };
  };
}

/**
 * Build the REAL prod control-plane. The enqueue fans out over BOTH probe axes
 * in the promoted closure ({@link partitionCellsByAxis}): the AGENT-axis cells
 * (showcase-* integrations) through a TRIGGERED d6 producer tick, and the
 * STARTER-axis cells (starter-* containers) through a `starter_smoke` CRON-probe
 * trigger. Each axis writes a DIFFERENT keyspace
 * (`d5/d6/e2e/chat/tools/health` vs `starter:<col>/<level>`), so driving only
 * the d6 tick would leave a starter cell's freshness poll waiting forever on
 * `starter:<col>/<level>` rows that were never produced — the bug this split
 * fixes.
 *
 * The two enqueue seams are injectable (`agentEnqueue` / `starterEnqueue`),
 * defaulting to the real harness producer + the real prod harness HTTP trigger,
 * so the axis-split routing is unit-testable without Railway / the harness graph
 * / a live prod harness.
 */
export function createRealProdControlPlane(args: {
  cells: GateCell[];
  prodPb: PbCreds;
  prodRailwayEnv: {
    token: string;
    projectId: string;
    environmentId: string;
  };
  workersProvisioned: boolean;
  /** Override the AGENT-axis (d6 producer) enqueue — tests inject a fake. */
  agentEnqueue?: AgentEnqueueFn;
  /** Override the STARTER-axis (starter_smoke trigger) enqueue — tests inject a fake. */
  starterEnqueue?: StarterEnqueueFn;
  /** Prod harness base URL for the default starter_smoke trigger seam. */
  prodHarnessBaseUrl?: string;
  /** Bearer token for the default starter_smoke trigger seam. */
  prodHarnessTriggerToken?: string;
}): ProdControlPlane {
  const logger = createCliLogger();
  const { agentSlugs, starterTriggerKeys } = partitionCellsByAxis(args.cells);

  const agentEnqueue =
    args.agentEnqueue ??
    makeAgentEnqueue({
      prodPb: args.prodPb,
      prodRailwayEnv: args.prodRailwayEnv,
      logger,
    });
  const starterEnqueue =
    args.starterEnqueue ??
    (() => {
      // Only the DEFAULT starter seam needs the prod harness URL + token. When
      // the closure has no starter cells, no default is required (no trigger).
      if (starterTriggerKeys.length === 0) {
        return async (): Promise<EnqueueAxisResult> => ({
          enqueued: 0,
          enqueueFailures: 0,
        });
      }
      if (
        args.prodHarnessBaseUrl === undefined ||
        args.prodHarnessTriggerToken === undefined
      ) {
        throw new Error(
          "verify-prod-resweep: the promoted closure includes starter cells but " +
            "prodHarnessBaseUrl / prodHarnessTriggerToken were not supplied — " +
            "cannot trigger the prod starter_smoke probe.",
        );
      }
      return makeStarterEnqueue({
        prodHarnessBaseUrl: args.prodHarnessBaseUrl,
        prodHarnessTriggerToken: args.prodHarnessTriggerToken,
        logger,
      });
    })();

  return {
    async enqueue(atMs: number): Promise<ProdEnqueueResult> {
      // Drive ONLY the axes the promoted closure actually populates — a
      // starter-only closure must not touch the d6 producer, and an agent-only
      // closure must not POST the starter_smoke trigger. An empty axis
      // contributes nothing to the enqueue accounting.
      const empty: EnqueueAxisResult = { enqueued: 0, enqueueFailures: 0 };
      const [agentRes, starterRes] = await Promise.all([
        agentSlugs.length > 0 ? agentEnqueue(agentSlugs, atMs) : empty,
        starterTriggerKeys.length > 0
          ? starterEnqueue(starterTriggerKeys, atMs)
          : empty,
      ]);
      return {
        triggerAt: atMs,
        enqueued: agentRes.enqueued + starterRes.enqueued,
        enqueueFailures: agentRes.enqueueFailures + starterRes.enqueueFailures,
        workersProvisioned: args.workersProvisioned,
      };
    },
    async readProdStatus(): Promise<LiveStatusMap> {
      return readPbStatus(args.prodPb);
    },
  };
}

/**
 * The representative catalog feature stamped on every promoted integration
 * cell. `agentic-chat` is the universal baseline feature every showcase
 * integration ships (the d5/d6 take-one) and the default-scope cell the
 * dashboard derives. It MUST be a catalogued feature; the module-load
 * assertion below fails loud if a `CATALOG_TO_D5_KEY` refactor ever drops it.
 */
const REPRESENTATIVE_FEATURE = "agentic-chat";

// Fail loud at load if the representative feature is no longer catalogued —
// otherwise `freshnessKeysForCell` would silently lose the d5/d6 family keys
// (`CATALOG_TO_D5_KEY[featureId]` undefined) and the freshness poll would only
// ever consult the integration-level keys, weakening the gate.
if (!CATALOG_TO_D5_KEY[REPRESENTATIVE_FEATURE]) {
  throw new Error(
    `verify-prod-resweep: representative feature "${REPRESENTATIVE_FEATURE}" ` +
      "is not present in CATALOG_TO_D5_KEY — the cell derivation cannot stamp " +
      "a catalogued feature; update REPRESENTATIVE_FEATURE.",
  );
}

/**
 * Strip the `showcase-` prefix from an SSOT service name to derive the HARNESS
 * SLUG — the key the enqueue discovery's `serviceSlug` and `keyFor(...)` use.
 * Mirrors discovery's `deriveSlugFromServiceName` / the catalog-enumerator's
 * `deriveSlug` (the import would drag the heavy harness producer graph this
 * module loads lazily, so the one-line normalization is re-stated here). Bare
 * names (infra/shells) pass through unchanged.
 */
function deriveSlug(name: string): string {
  return name.startsWith("showcase-") ? name.slice("showcase-".length) : name;
}

/**
 * `showcase-`-prefixed SSOT names that are NOT probe-wired integration cells.
 * Mirrors the non-starter `showcase-*` exclusions in the catalog-enumerator's
 * `D6_DISCOVERY_FILTER.nameExcludes` (the SSOT for which `showcase-*` services
 * the d6 sweep skips): `showcase-ms-agent-harness-dotnet` is `deployed: true`
 * but unprobed, so the enqueue discovery never emits a d6 row for it — a cell
 * for it could only ever time out the freshness poll. Importing the enumerator
 * constant directly would drag the heavy harness graph this module loads
 * lazily, so the single non-integration `showcase-*` name is re-stated here.
 */
const NON_INTEGRATION_SHOWCASE_NAMES = new Set([
  "showcase-ms-agent-harness-dotnet",
]);

/**
 * Parse the promoted closure CSV (U4's `succeeded_csv`) into gate cells. The
 * CSV carries SSOT `.name` values: integrations are `showcase-<slug>`
 * (prefixed), while infra/shell services are bare names (`aimock`,
 * `dashboard`, `docs`, `dojo`, `webhooks`, `pocketbase`, `harness`). Each
 * promoted INTEGRATION maps to its representative cell:
 *   - the `slug` is the HARNESS slug (the `showcase-` prefix STRIPPED), so it
 *     matches both `keyFor(...)` (the freshness keyspace) and the enqueue
 *     discovery's `serviceSlug` (= `deriveSlug(name)`). Emitting the raw
 *     prefixed token here would match neither (zero enqueue + freshness
 *     timeout → REFUSE).
 *   - the `featureId` is the representative catalog feature
 *     ({@link REPRESENTATIVE_FEATURE}), validated against `CATALOG_TO_D5_KEY`.
 *
 * Membership is a POSITIVE "is this a catalogued integration?" test rather than
 * a hand-maintained infra blocklist (robust to infra name drift): a token is
 * an integration iff it is `showcase-`-prefixed, is not a known unprobed
 * `showcase-*` service, and its representative feature is catalogued. Infra and
 * shell services carry bare names, so they fail the prefix test and are
 * excluded automatically.
 *
 * STARTER axis (tier-2 `starter-*` closure members): a `starter-<rawSlug>`
 * token is a starter-template container, probed on the `starter_smoke` matrix —
 * NOT the agent feature ladder. It is emitted as a `probeAxis: "starter"` cell
 * whose `slug` is the DASHBOARD COLUMN slug (`STARTER_TO_COLUMN[rawSlug]`), so
 * the equivalence gate / freshness poll resolve it from the
 * `starter:<columnSlug>/<level>` rows. A starter is never stamped with the
 * representative `agentic-chat` feature.
 */
/**
 * The featureId label stamped on a STARTER-axis cell. The starter axis is NOT
 * feature-scoped (its rows are keyed `starter:<columnSlug>/<level>`, not by a
 * catalog feature), so this is a non-catalogued LABEL — deliberately NOT
 * {@link REPRESENTATIVE_FEATURE}, so a starter never resolves through (or is
 * emitted as) a phantom `agentic-chat` cell. `buildCellModel` /
 * `freshnessKeysForCell` / `newestProdObservation` all route off
 * `probeAxis === "starter"`, never this label.
 */
const STARTER_FEATURE_LABEL = "starter";

/**
 * The `starter_smoke` CRON probe id (`showcase/harness/config/probes/starter_smoke.yml`).
 * The prod re-sweep TRIGGERS this probe (operator-trigger seam) for the
 * starter-axis cells — it is NOT a control-plane producer family, so it never
 * flows through the d6 `createJobProducer` path.
 */
export const STARTER_SMOKE_PROBE_ID = "starter_smoke";

/**
 * The starter-fleet Railway service-name prefix (`starter-<rawSlug>`). The
 * `starter_smoke` probe's `key_template` is `starter_smoke:${name}`, so the
 * per-target slug a `scheduler.trigger(... filter.slugs)` invocation matches is
 * the POST-key_template key `starter_smoke:starter-<rawSlug>` (see
 * `probe-invoker.ts` — the filter compares against `ResolvedInput.key`).
 */
const STARTER_SERVICE_PREFIX = "starter-";

/**
 * Reverse of STARTER_TO_COLUMN: dashboard COLUMN slug → starter RAW slug (the
 * `starter-<rawSlug>` Railway service-name slug the starter_smoke discovery
 * enumerates). `cellsFromClosureCsv` stores the COLUMN slug on a starter cell
 * (so the equivalence gate / freshness poll resolve the `starter:<col>/<level>`
 * rows), but the starter_smoke TRIGGER filter is keyed by the SERVICE name, so
 * the enqueue must map back. STARTER_TO_COLUMN is injective in practice (each
 * column has exactly one raw starter), so the reverse is unambiguous; built
 * once at module load.
 */
const COLUMN_TO_STARTER_RAW: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  for (const [rawSlug, columnSlug] of Object.entries(STARTER_TO_COLUMN)) {
    out[columnSlug] = rawSlug;
  }
  return out;
})();

/**
 * The two enqueue axes a promoted closure fans out over. The real prod enqueue
 * must drive BOTH: the AGENT-axis cells through the d6 producer→queue tick, and
 * the STARTER-axis cells through a `starter_smoke` CRON-probe trigger. They have
 * different trigger surfaces AND different keyspaces (`d5/d6/e2e/...` vs
 * `starter:<col>/<level>`), so a single d6 tick can NEVER produce the rows a
 * starter cell's freshness poll waits on.
 */
export interface AxisPartition {
  /** Harness slugs (showcase- prefix stripped) for the d6 producer tick. */
  agentSlugs: string[];
  /**
   * `starter_smoke:starter-<rawSlug>` trigger-filter keys for the starter_smoke
   * CRON-probe trigger (the POST-key_template keys `probe-invoker` matches).
   */
  starterTriggerKeys: string[];
}

/**
 * Split the promoted closure cells into the AGENT and STARTER enqueue axes.
 * Agent cells contribute their harness slug to the d6 producer tick; starter
 * cells (column slug) are reverse-mapped to their `starter-<rawSlug>` service
 * name and emitted as `starter_smoke:starter-<rawSlug>` trigger-filter keys. A
 * starter cell whose column slug has no reverse mapping is dropped (it could
 * only ever time out the freshness poll) — symmetric with `cellsFromClosureCsv`
 * dropping an unmapped starter on the way in.
 */
export function partitionCellsByAxis(cells: GateCell[]): AxisPartition {
  const agentSlugs: string[] = [];
  const starterTriggerKeys: string[] = [];
  for (const cell of cells) {
    if (cell.probeAxis === "starter") {
      const rawSlug = COLUMN_TO_STARTER_RAW[cell.slug];
      if (rawSlug === undefined) continue;
      starterTriggerKeys.push(
        `${STARTER_SMOKE_PROBE_ID}:${STARTER_SERVICE_PREFIX}${rawSlug}`,
      );
      continue;
    }
    agentSlugs.push(cell.slug);
  }
  return { agentSlugs, starterTriggerKeys };
}

export function cellsFromClosureCsv(csv: string): GateCell[] {
  const cells: GateCell[] = [];
  for (const token of csv.split(",").map((s) => s.trim())) {
    if (token.length === 0) continue;
    // ── STARTER axis: `starter-<rawSlug>` closure tokens. The raw slug is a
    //    key of STARTER_TO_COLUMN (the starter-smoke matrix slug); remap it to
    //    the dashboard COLUMN slug so the cell is keyed the way starter_smoke
    //    rows are (`starter:<columnSlug>/<level>`). A starter NOT in the map
    //    has no smoke column and is dropped (it could only ever time out the
    //    freshness poll), mirroring the showcase-* unprobed exclusion. ──
    if (token.startsWith("starter-")) {
      const rawSlug = token.slice("starter-".length);
      const columnSlug = STARTER_TO_COLUMN[rawSlug];
      if (columnSlug === undefined) continue;
      cells.push({
        slug: columnSlug,
        featureId: STARTER_FEATURE_LABEL,
        isSupported: true,
        isWired: true,
        probeAxis: "starter",
      });
      continue;
    }
    // Positive integration gate: infra/shell names are bare (no `showcase-`),
    // so the prefix requirement alone drops them.
    if (!token.startsWith("showcase-")) continue;
    if (NON_INTEGRATION_SHOWCASE_NAMES.has(token)) continue;
    cells.push({
      slug: deriveSlug(token),
      featureId: REPRESENTATIVE_FEATURE,
      isSupported: true,
      isWired: true,
    });
  }
  return cells;
}

/** CLI entry: wire the real prod control-plane + readers, run, exit non-zero on REFUSE/FAIL. */
async function main(): Promise<void> {
  const closureCsv = requireEnv("PROMOTED_CLOSURE_CSV");
  const cells = cellsFromClosureCsv(closureCsv);
  if (cells.length === 0) {
    console.log(
      "::notice::no promoted integration cells in PROMOTED_CLOSURE_CSV — " +
        "nothing to re-sweep; equivalence gate vacuously passes.",
    );
    return;
  }

  const prodPb: PbCreds = {
    url: requireEnv("PROD_POCKETBASE_URL"),
    email: requireEnv("PROD_POCKETBASE_SUPERUSER_EMAIL"),
    password: requireEnv("PROD_POCKETBASE_SUPERUSER_PASSWORD"),
  };
  const stagingPb: PbCreds = {
    url: requireEnv("STAGING_POCKETBASE_URL"),
    email: requireEnv("STAGING_POCKETBASE_SUPERUSER_EMAIL"),
    password: requireEnv("STAGING_POCKETBASE_SUPERUSER_PASSWORD"),
  };
  // §4.4 fallback annotation: the operator/CI declares whether prod
  // harness-workers are provisioned. Default true; an explicit "false" flips
  // the gate into inline-fallback annotation (still functional).
  const workersProvisioned =
    (process.env.PROD_HARNESS_WORKERS_PROVISIONED ?? "true").toLowerCase() !==
    "false";

  // The STARTER-axis enqueue triggers the prod `starter_smoke` CRON probe over
  // HTTP. Only require its base URL + trigger token when the closure actually
  // contains starter cells — an agent-only promote never touches the route.
  const hasStarterCells = cells.some((c) => c.probeAxis === "starter");

  const controlPlane = createRealProdControlPlane({
    cells,
    prodPb,
    prodRailwayEnv: {
      token: requireEnv("RAILWAY_TOKEN"),
      projectId: requireEnv("RAILWAY_PROJECT_ID"),
      environmentId: requireEnv("RAILWAY_ENVIRONMENT_ID_PROD"),
    },
    workersProvisioned,
    ...(hasStarterCells
      ? {
          prodHarnessBaseUrl: requireEnv("PROD_HARNESS_BASE_URL"),
          prodHarnessTriggerToken: requireEnv("PROD_HARNESS_TRIGGER_TOKEN"),
        }
      : {}),
  });

  const result = await runVerifyProdResweep({
    controlPlane,
    cells,
    readStagingStatus: () => readPbStatus(stagingPb),
  });

  // Surface the verdict to the workflow summary + logs.
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  const block = `## Prod equivalence gate\n\n\`\`\`\n${result.summary}\n\`\`\`\n`;
  if (summaryFile) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(summaryFile, block);
  }
  console.log(result.summary);

  if (!result.gate.passed) {
    console.error(
      `::error::Equivalence gate FAILED — ${result.gate.mismatches.length} prod regression(s).`,
    );
    process.exit(1);
  }
}

// Run main only when invoked directly (not when imported by the test).
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolvePath(process.argv[1]) === resolvePath(import.meta.filename);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(
      `::error::prod re-sweep refused: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
