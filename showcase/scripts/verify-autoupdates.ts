#!/usr/bin/env npx tsx
/**
 * verify-autoupdates.ts — Live Railway `autoUpdates` drift gate.
 *
 * Every showcase service in the CopilotKit Railway project must have Railway
 * source auto-updates DISABLED: the deploy pipeline is the ONLY thing allowed
 * to move an image (staging floats `:latest` via CI redeploy, prod is
 * digest-pinned via `bin/railway promote`). If Railway's own auto-update
 * feature is enabled on a service (`source.autoUpdates.type = "minor"`), the
 * platform silently re-pulls upstream image changes out-of-band — exactly the
 * class of unmanaged mutation that produced the April→June image drift the
 * sibling gate (`verify-railway-image-refs.ts`) was written to catch after the
 * fact. This gate catches the *cause* (auto-updates left enabled) rather than
 * the *symptom* (a drifted ref).
 *
 * SSOT expectation: `railway-envs.ts` carries a required per-service
 * `autoUpdates` policy field (added alongside this gate); every service is
 * `"disabled"`. This gate does NOT hardcode the service list — it reads the
 * expectation from the SSOT and compares it against the LIVE Railway value.
 *
 * Live value source: `autoUpdates` is NOT exposed on the typed `ServiceSource`
 * GraphQL output. It lives in the `Environment.config` JSON scalar (the same
 * staged-config blob that carries `deploy.multiRegionConfig`), under
 * `services.<serviceId>.source.autoUpdates`. We therefore read
 * `environment(id){ config }` once per env and index into that JSON by
 * serviceId.
 *
 * Usage:
 *   npx tsx showcase/scripts/verify-autoupdates.ts
 *
 * Requires: RAILWAY_TOKEN env var or ~/.railway/config.json
 * Exit: 0 when every service matches the SSOT expectation; 1 on any drift.
 */

import { fileURLToPath } from "url";
import { ENV_ID_BY_NAME, SERVICES } from "./railway-envs";
import type { EnvName } from "./railway-envs";
import {
  RAILWAY_GRAPHQL_ENDPOINT,
  sanitizeErrorBody,
} from "./lib/railway-graphql";
import { RailwayTokenError, resolveRailwayToken } from "./lib/railway-token";

const RAILWAY_API = RAILWAY_GRAPHQL_ENDPOINT;

/**
 * Auto-updates policy vocabulary. Mirrors the `AutoUpdatesPolicy` type the SSOT
 * (`railway-envs.ts`) exports:
 *   - "disabled"  — Railway source auto-updates OFF (the MANAGED target this
 *     gate enforces). Live shape: `autoUpdates` absent/null, or `type` falsy.
 *   - "minor"     — Railway's ENABLED form (`source.autoUpdates.type = "minor"`).
 *   - "unmanaged" — NOT yet under drift-gate management. The gate SKIPS an
 *     "unmanaged" env entirely (no read, no compare, no flag) and does not
 *     count it toward the zero-checked floor.
 *
 * Declared locally (not imported) so this gate compiles standalone even before
 * the SSOT field lands in this worktree; the two definitions are identical.
 */
export type AutoUpdatesPolicy = "disabled" | "minor" | "unmanaged";

/**
 * Shape of a single service's `source.autoUpdates` inside the
 * `Environment.config` JSON scalar. Railway omits the object (or sets it null)
 * when auto-updates are off; when on it carries `{ type: "minor" }`.
 */
export interface LiveAutoUpdates {
  type?: string | null;
}

/** Per-service slice of the `Environment.config` JSON we care about. */
export interface LiveServiceConfig {
  source?: { autoUpdates?: LiveAutoUpdates | null } | null;
}

/** The `Environment.config` JSON scalar (only the `services` map is read). */
export interface EnvironmentConfigJson {
  services?: Record<string, LiveServiceConfig> | null;
}

/**
 * Normalize the raw `Environment.config` value into the typed slice we index
 * into. Railway's GraphQL JSON scalar is USUALLY returned already-parsed (an
 * object), but can come back as a JSON *string* depending on client/transport.
 * A blind `as EnvironmentConfigJson` cast on a string leaves `.services`
 * undefined, which makes every service silently skip (checked===0) and — absent
 * the zero-checked floor — report a false green. So parse strings, and fail
 * loud on anything that is neither an object nor valid JSON, rather than
 * silently degrading to an empty config.
 */
export function parseEnvironmentConfig(raw: unknown): EnvironmentConfigJson {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `Railway Environment.config was a string but is not valid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
        { cause: e },
      );
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(
        `Railway Environment.config parsed to a non-object (${typeof parsed}); expected the staged-config JSON object.`,
      );
    }
    return parsed as EnvironmentConfigJson;
  }
  if (typeof raw === "object") return raw as EnvironmentConfigJson;
  throw new Error(
    `Railway Environment.config had unexpected type "${typeof raw}"; expected an object or JSON string.`,
  );
}

/**
 * Minimal SSOT entry shape this gate consumes. A structural subset of
 * `ServiceEntry` (plus the `autoUpdates` policy field the SSOT adds) so the
 * gate can be driven by fixtures in tests WITHOUT depending on the full
 * `ServiceEntry` interface — and so it compiles whether or not the SSOT field
 * is present in this worktree yet (real `SERVICES` entries are assignable
 * either way).
 */
export interface AutoUpdatesGateEntry {
  serviceId: string;
  environments: Record<string, unknown>;
  /**
   * Per-env auto-updates policy, keyed by the same env names as
   * `environments`. Structural subset of the SSOT `AutoUpdatesByEnv`. Optional
   * so the gate compiles/behaves whether or not the SSOT field is present;
   * `expectedPolicyFor` defaults a missing env to "disabled".
   */
  autoUpdates?: Record<string, AutoUpdatesPolicy>;
}

export interface AutoUpdatesViolation {
  service: string;
  env: EnvName;
  expected: AutoUpdatesPolicy;
  /** Raw live `autoUpdates.type` (null when disabled/absent). */
  liveType: string | null;
  reason: string;
}

/**
 * True iff the live `autoUpdates` block represents an ENABLED auto-update.
 * Any present, non-empty `type` that is not the explicit "disabled" marker
 * counts as enabled — so a future enabled variant (e.g. "all"/"patch") is
 * still caught as drift rather than silently passing.
 */
export function isLiveAutoUpdatesEnabled(
  raw: LiveAutoUpdates | null | undefined,
): boolean {
  const t = raw?.type;
  return typeof t === "string" && t.length > 0 && t !== "disabled";
}

/**
 * Pure, unit-testable comparison. Returns null when the live value matches the
 * SSOT expectation, or an AutoUpdatesViolation describing the drift.
 */
export function checkAutoUpdates(params: {
  service: string;
  env: EnvName;
  expected: AutoUpdatesPolicy;
  liveAutoUpdates: LiveAutoUpdates | null | undefined;
}): AutoUpdatesViolation | null {
  const { service, env, expected, liveAutoUpdates } = params;
  const enabled = isLiveAutoUpdatesEnabled(liveAutoUpdates);
  const liveType = liveAutoUpdates?.type ? liveAutoUpdates.type : null;

  if (expected === "disabled" && enabled) {
    return {
      service,
      env,
      expected,
      liveType,
      reason: `Railway source auto-updates are ENABLED (autoUpdates.type=${JSON.stringify(
        liveType,
      )}) but the SSOT requires "disabled". Disable auto-updates on this service in the Railway dashboard (Service → Settings → Source → Automatic deployments) so only the deploy pipeline moves the image.`,
    };
  }

  if (expected === "minor" && !enabled) {
    return {
      service,
      env,
      expected,
      liveType,
      reason: `SSOT expects auto-updates "minor" but Railway reports them disabled (autoUpdates.type=${JSON.stringify(
        liveType,
      )}).`,
    };
  }

  return null;
}

/**
 * Resolve the SSOT auto-updates expectation for an entry in a SPECIFIC env.
 * Reads the per-env SSOT `autoUpdates[env]` policy; defaults to "disabled"
 * when absent (the managed invariant) so the gate is correct both before and
 * after the SSOT field lands. Structural typing lets real `SERVICES` entries
 * flow in whether or not `ServiceEntry` declares the field yet.
 */
export function expectedPolicyFor(
  entry: AutoUpdatesGateEntry,
  env: EnvName,
): AutoUpdatesPolicy {
  return entry.autoUpdates?.[env] ?? "disabled";
}

/**
 * Per-environment check tally. `expected` = SSOT services that declare this
 * env; `checked` = of those, how many were present in the env's live config
 * and actually compared; `skipped` = declared-but-absent-from-live. An env with
 * `expected > 0` but `checked === 0` means its live `Environment.config` yielded
 * nothing comparable (empty/absent config, wrong project scope) — that env's
 * drift went unverified and the gate must fail even if a sibling env is healthy.
 */
export interface EnvCheckStats {
  expected: number;
  checked: number;
  skipped: number;
}

export interface GateResult {
  violations: AutoUpdatesViolation[];
  checked: number;
  skipped: number;
  /**
   * Per-env tallies, keyed by env name — drives the per-env fail-closed floor.
   * Optional so callers that only build the global counters (e.g. legacy
   * fixtures) still type-check; `summarizeAutoUpdatesFailures` falls back to the
   * global `checked===0` floor when it is absent. `runAutoUpdatesGate` always
   * populates it.
   */
  perEnv?: Record<string, EnvCheckStats>;
}

/**
 * Fetches the RAW `Environment.config` value for one env id (object, JSON
 * string, or absent — exactly what the GraphQL scalar yields). The gate
 * normalizes it via `parseEnvironmentConfig`. Injectable.
 */
export type EnvConfigFetcher = (envId: string) => Promise<unknown>;

/**
 * Core gate — fully injectable so tests drive it with fixtures (no live
 * Railway, no dependency on the SSOT file). For every SSOT service, in every
 * env it declares, reads the live `autoUpdates` from that env's config and
 * compares it to the SSOT expectation. A service absent from an env's live
 * config is skipped (cannot assert), not failed.
 */
export async function runAutoUpdatesGate(deps: {
  services: Record<string, AutoUpdatesGateEntry>;
  envIds: Record<EnvName, string>;
  fetchEnvConfig: EnvConfigFetcher;
}): Promise<GateResult> {
  const { services, envIds, fetchEnvConfig } = deps;
  const violations: AutoUpdatesViolation[] = [];
  let checked = 0;
  let skipped = 0;
  const perEnv: Record<string, EnvCheckStats> = {};

  // Sorted env names for stable, deterministic output ordering.
  for (const env of Object.keys(envIds).sort()) {
    const envId = envIds[env];
    const config = parseEnvironmentConfig(await fetchEnvConfig(envId));
    const liveServices = config.services ?? {};
    const stats: EnvCheckStats = { expected: 0, checked: 0, skipped: 0 };

    // Sorted service names for stable output ordering.
    for (const name of Object.keys(services).sort()) {
      const entry = services[name];
      // Only assert an env the service actually declares. Use Object.hasOwn
      // (matching reconcile-staging.ts) so a declared-but-falsy env value is
      // still asserted rather than silently skipped.
      if (!Object.hasOwn(entry.environments, env)) continue;
      const expected = expectedPolicyFor(entry, env);
      // "unmanaged" env: NOT under drift-gate management. Skip it ENTIRELY —
      // do not read/compare the live value, and do not count it toward the
      // per-env floor (`expected`) or the global tallies. This is how prod
      // stays untouched during a staging-first rollout: its heterogeneous
      // live autoUpdates produce zero violations and never trip the floor.
      if (expected === "unmanaged") continue;
      stats.expected++;
      const liveSvc = liveServices[entry.serviceId];
      if (!liveSvc) {
        // Service not present in this env's live config — nothing to compare.
        skipped++;
        stats.skipped++;
        continue;
      }
      checked++;
      stats.checked++;
      const v = checkAutoUpdates({
        service: name,
        env,
        expected,
        liveAutoUpdates: liveSvc.source?.autoUpdates,
      });
      if (v) violations.push(v);
    }

    perEnv[env] = stats;
  }

  return { violations, checked, skipped, perEnv };
}

export interface FailureSummaryOutput {
  shouldFail: boolean;
  lines: string[];
}

/**
 * Pure failure-summary builder. Mirrors verify-railway-image-refs's
 * summarizeFailures reporting convention.
 */
export function summarizeAutoUpdatesFailures(
  result: GateResult,
): FailureSummaryOutput {
  const { violations, checked, skipped, perEnv } = result;

  // Per-env fail-closed floor: a drift gate must verify EVERY queried env, not
  // just some. An env that expected to check services but verified ZERO of them
  // (empty/absent Environment.config for that env, or wrong project scope) means
  // that env's drift went unverified — and a HEALTHY sibling env must NOT keep
  // the gate green while another env is unverifiable. Fail and name the starved
  // env(s). Sorted for deterministic output.
  const byEnv = perEnv ?? {};
  const starvedEnvs = Object.keys(byEnv)
    .filter((env) => byEnv[env].expected > 0 && byEnv[env].checked === 0)
    .sort();

  if (starvedEnvs.length > 0) {
    const lines: string[] = [
      `\n✗ autoUpdates drift gate verified ZERO expected services in ${starvedEnvs.length} environment(s) — refusing to report success.\n`,
    ];
    for (const env of starvedEnvs) {
      const s = byEnv[env];
      lines.push(
        `  ✗ [${env}] expected ${s.expected} service(s) but checked 0 (${s.skipped} skipped) — empty/absent Environment.config for this env, or wrong Railway project scope. That env's drift went unverified.`,
      );
    }
    lines.push(
      `\nA gate that verified nothing in an environment is not green. Confirm the Railway token can read every queried environment and that each env's config carries the expected services.\n`,
    );
    return { shouldFail: true, lines };
  }

  // Global fail-closed floor (subset of the per-env floor for callers that do
  // not carry a per-env breakdown, e.g. legacy fixtures): a drift gate that
  // verified NOTHING at all must never report success. checked===0 means the
  // live config yielded no comparable service/env pairs (empty/absent/string-
  // form Environment.config, wrong Railway project scope, or every pair skipped).
  if (checked === 0) {
    return {
      shouldFail: true,
      lines: [
        `\n✗ autoUpdates drift gate checked ZERO service/env pairs (${skipped} skipped) — refusing to report success.\n` +
          `This usually means the live Environment.config had no matching services (empty/string-form config, wrong Railway project scope, or every pair skipped). A gate that verified nothing is not green.\n`,
      ],
    };
  }

  const shouldFail = violations.length > 0;
  const lines: string[] = [];
  if (!shouldFail) return { shouldFail, lines };

  lines.push(
    `\n✗ Railway autoUpdates drift detected (${violations.length} violations across ${checked} service/env checks; ${skipped} skipped)\n`,
  );
  for (const v of violations) {
    lines.push(`  ✗ [${v.env}] ${v.service}`);
    lines.push(`    expected: ${v.expected}`);
    lines.push(`    live:     autoUpdates.type=${v.liveType ?? "<none>"}`);
    lines.push(`    reason:   ${v.reason}`);
  }
  lines.push(
    `\nFix by disabling Railway source auto-updates on the offending service(s) so only the deploy pipeline moves images.\n`,
  );
  return { shouldFail, lines };
}

// ── Railway GraphQL plumbing ────────────────────────────────────────────

/**
 * Resolve the Railway bearer token. Mirrors verify-railway-image-refs's
 * getToken(): maps RailwayTokenError onto the exit-1 operator-error contract.
 */
function getToken(): string {
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

async function railwayGql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = sanitizeErrorBody(await res.text());
    throw new Error(`Railway API error: ${res.status} ${body}`);
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Railway GraphQL errors:\n${json.errors.map((e) => `  - ${e.message}`).join("\n")}`,
    );
  }
  return json.data as T;
}

/**
 * Live `Environment.config` reader. Returns the RAW JSON scalar (object or, on
 * some transports, a JSON string); the gate normalizes it via
 * `parseEnvironmentConfig` — so a string-form scalar is parsed rather than
 * cast-and-silently-skipped.
 */
async function fetchEnvConfigLive(envId: string): Promise<unknown> {
  const data = await railwayGql<{ environment: { config: unknown } | null }>(
    `query envConfig($id: String!) {
      environment(id: $id) { config }
    }`,
    { id: envId },
  );
  if (data.environment === null || data.environment === undefined) {
    throw new Error(
      `Railway environment ${envId} returned null — check the env id and that the Railway token has access to this project.`,
    );
  }
  return data.environment.config;
}

async function main(): Promise<void> {
  // SERVICES is `ServiceEntry & { dispatchName? }`; structurally assignable to
  // the minimal gate-entry shape (serviceId + environments + optional
  // autoUpdates). The cast is a widening view, not `any`.
  const services = SERVICES as unknown as Record<string, AutoUpdatesGateEntry>;

  const result = await runAutoUpdatesGate({
    services,
    envIds: ENV_ID_BY_NAME,
    fetchEnvConfig: fetchEnvConfigLive,
  });

  const summary = summarizeAutoUpdatesFailures(result);
  if (summary.shouldFail) {
    for (const line of summary.lines) console.error(line);
    process.exit(1);
  }

  console.log(
    `✓ autoUpdates verified disabled across ${result.checked} service/env checks (${result.skipped} skipped)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
