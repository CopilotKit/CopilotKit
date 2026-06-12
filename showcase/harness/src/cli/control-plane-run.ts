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
import type { TestTarget } from "./targets.js";
import type { TerminalResult } from "./results.js";
import { demosForSlug } from "./targets.js";

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
 * Build the `LOCAL_SERVICES_JSON` discovery roster the enumerator reads. If
 * the env already supplies it (the control-plane container's value), reuse it
 * verbatim; otherwise synthesize the canonical local record per requested
 * slug, matching the compose overlay shape exactly.
 *
 * `level` controls the demo set: d5 ("take-one") only needs the representative
 * demo (`agentic-chat`), mirroring the like-staging overlay; d6 needs the
 * slug's full demo set so the all-pills driver exercises every cell.
 */
function buildLocalServicesJson(
  slugs: string[],
  level: ControlPlaneLevel,
  config: LocalConfig,
): string {
  const fromEnv = process.env.LOCAL_SERVICES_JSON;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  const records = slugs.map((slug) => ({
    name: `showcase-${slug}`,
    publicUrl: `http://${slug}:10000`,
    demos: level === "d5" ? ["agentic-chat"] : demosForSlug(slug, config),
  }));
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
 * level + slug. d5 emits the aggregate `d5-single-pill-e2e:<slug>` plus the
 * per-feature `d5:<slug>/<featureType>` side rows; the representative demo is
 * `agentic-chat`, so we wait on `d5:<slug>/agentic-chat`. d6 emits the
 * per-service `d6:<slug>` cell.
 */
function expectedKeys(level: ControlPlaneLevel, slug: string): string[] {
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

/**
 * Poll PocketBase `status` for the run's expected keys, returning once every
 * key reached a terminal state newer than `sinceIso` (so we read THIS run's
 * cells, not a stale prior run's). Throws on timeout.
 */
async function pollStatusUntilTerminal(
  pbUrl: string,
  email: string,
  password: string,
  keys: string[],
  sinceIso: string,
  timeoutMs: number,
  pollIntervalMs: number,
  logger: Logger,
): Promise<Map<string, StatusRow>> {
  const deadline = Date.now() + timeoutMs;
  const token = await pbAuth(pbUrl, email, password);
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
  const slugs = [...new Set(targets.map((t) => t.slug))];

  const creds = resolvePbCreds(config);

  // Build the discovery env the enumerator reads — the SAME static-injection
  // seam staging's control-plane container uses.
  const localServicesJson = buildLocalServicesJson(slugs, level, config);
  const env: Record<string, string | undefined> = {
    ...process.env,
    LOCAL_SERVICES_JSON: localServicesJson,
  };

  console.log(
    `\n  \x1b[36mControl-plane ${level.toUpperCase()} run:\x1b[0m ${slugs.join(", ")}`,
  );
  logger.info("cli.control-plane.start", {
    level,
    slugs,
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
  try {
    const tick = await producer.tick({ triggered: true });
    enqueued = tick.enqueued;
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

  if (enqueued === 0) {
    throw new Error(
      `control-plane enqueued 0 jobs for ${slugs.join(", ")} — check LOCAL_SERVICES_JSON / discovery filter`,
    );
  }

  // -- Wait for the worker fleet to drain + the aggregator to write cells ---
  const allKeys = slugs.flatMap((slug) => expectedKeys(level, slug));
  console.log(
    `  \x1b[2mWaiting for worker fleet to produce cells: ${allKeys.join(", ")}\x1b[0m`,
  );

  const terminalRows = await pollStatusUntilTerminal(
    creds.url,
    creds.email,
    creds.password,
    allKeys,
    sinceIso,
    timeoutMs,
    pollIntervalMs,
    logger,
  );

  const results: TerminalResult[] = [];
  for (const key of allKeys) {
    const row = terminalRows.get(key);
    results.push({
      key,
      state: (row?.state ?? "error") as TerminalResult["state"],
      durationMs: 0,
      error: row && row.state !== "green" ? `state=${row.state}` : undefined,
    });
  }
  return results;
}
