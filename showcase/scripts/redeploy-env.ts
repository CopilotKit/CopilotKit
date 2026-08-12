#!/usr/bin/env npx tsx
/**
 * redeploy-env.ts — Trigger Railway `serviceInstanceRedeploy` for the
 * CI-built showcase services in the named environment.
 *
 * Usage:
 *   npx tsx showcase/scripts/redeploy-env.ts <env> [--services <csv>]
 *
 *   npx tsx showcase/scripts/redeploy-env.ts staging
 *     → redeploys all CI_BUILT_SERVICES (every ciBuilt SSOT entry; the
 *       default scope excludes webhooks and the non-CI-built
 *       harness-workers — though harness-workers joins via
 *       imageOf expansion on staging; explicit --services can still
 *       target any SSOT key)
 *
 *   npx tsx showcase/scripts/redeploy-env.ts staging --services mastra,ag2
 *     → redeploys only the listed services (CSV of SSOT keys OR
 *       showcase_build.yml dispatch_names; mixed is fine).
 *
 * Behavior:
 *   - Default target set: CI_BUILT_SERVICES (every ciBuilt SSOT entry,
 *     pocketbase included). webhooks is first-party but released by its
 *     own repo, and harness-workers is not CI-built —
 *     neither is in the default scope. An explicit
 *     `--services webhooks` (or harness-workers) WILL still redeploy
 *     them; resolveTargetServices honors any SSOT key the caller asks
 *     for.
 *   - When `--services` is provided, each entry is resolved via
 *     resolveTargetServices() against SSOT keys + dispatch_names.
 *   - In BOTH cases the resolved set is expanded with `imageOf` consumers
 *     (expandImageConsumers): a service that runs another service's image
 *     (e.g. harness-workers running the shared showcase-harness image)
 *     redeploys whenever that image's builder is in scope. The expansion
 *     is env-aware — a consumer only joins envs it actually declares, so
 *     the staging-only worker is never ADDED to a prod redeploy by
 *     expansion. That env filter applies ONLY to consumers added by
 *     expansion: a service the caller explicitly names in `--services`
 *     is attempted even in an env it does not declare.
 *   - Per-service Railway failures (including the all-services-fail case)
 *     print FAIL lines to stdout and land in the markdown summary written
 *     to $GITHUB_STEP_SUMMARY (mirrored to stderr). Exit-code policy is
 *     FAIL-LOUD BY DEFAULT: any per-service failure yields a non-zero
 *     exitCode for EVERY env except staging. Staging is the single
 *     documented carve-out (failures stay non-fatal) because staging is
 *     not a release gate — the verify-deploy workflow is what fails on
 *     bad images. A future env (preview, canary, …) inherits the fatal
 *     default; do NOT add it to a carve-out list unless it also gets its
 *     own downstream gate.
 *   - Operator/config errors (bad env name, unknown service, missing or
 *     malformed token) ALWAYS fail loud with a non-zero exit.
 *
 * Auth: RAILWAY_TOKEN env var or ~/.railway/config.json.
 * Exit code: 0 on staging even when per-service redeploys fail; non-zero
 * for per-service failures in any other env and for any operator/config
 * error.
 */

import fs from "fs";
import { fileURLToPath } from "url";
import {
  CI_BUILT_SERVICES,
  ENV_IDS,
  ENV_ID_BY_NAME,
  SERVICES,
  resolveEnv,
  serviceForDispatchName,
} from "./railway-envs";
import type { EnvName } from "./railway-envs";
import {
  RAILWAY_GRAPHQL_ENDPOINT,
  sanitizeErrorBody,
} from "./lib/railway-graphql";
import { RailwayTokenError, resolveRailwayToken } from "./lib/railway-token";

const RAILWAY_API = RAILWAY_GRAPHQL_ENDPOINT;

/**
 * Resolve the Railway bearer token for this run. Wraps the shared
 * `resolveRailwayToken` envelope and maps any RailwayTokenError onto
 * the script's exit-1 contract for operator/config errors. The shared
 * helper never calls process.exit — exit-code mapping lives HERE so the
 * helper stays unit-testable.
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

export interface RedeployResult {
  ok: true;
}
export interface RedeployFailure {
  ok: false;
  error: string;
}
export type RedeployOutcome = RedeployResult | RedeployFailure;

export type RedeployFn = (
  serviceId: string,
  environmentId: string,
) => Promise<RedeployOutcome>;

/**
 * Build a `liveRedeploy` RedeployFn bound to a single resolved token, so
 * token resolution happens once per process rather than once per service.
 * Exported for direct unit testing (timeout signal + error sanitization).
 */
export function makeLiveRedeploy(token: string): RedeployFn {
  return async function liveRedeploy(
    serviceId: string,
    environmentId: string,
  ): Promise<RedeployOutcome> {
    const res = await fetch(RAILWAY_API, {
      method: "POST",
      // A hung Railway API must surface as a per-service FAIL (the timeout
      // rejection is caught by runRedeploy's per-service try/catch), not
      // stall the CI job until the runner's global timeout.
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `mutation serviceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
      }`,
        variables: { serviceId, environmentId },
      }),
    });
    if (!res.ok) {
      const body = sanitizeErrorBody(await res.text());
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }
    const json = (await res.json()) as {
      data?: { serviceInstanceRedeploy?: boolean };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      // Sanitize each GraphQL error message exactly like the HTTP-error
      // path above — Railway/Cloudflare error strings can be multi-KB and
      // markdown-breaking too.
      return {
        ok: false,
        error: json.errors.map((e) => sanitizeErrorBody(e.message)).join("; "),
      };
    }
    if (json.data?.serviceInstanceRedeploy !== true) {
      return {
        ok: false,
        error: `serviceInstanceRedeploy returned ${JSON.stringify(json.data?.serviceInstanceRedeploy)}`,
      };
    }
    return { ok: true };
  };
}

export interface RunRedeployOpts {
  env: EnvName;
  redeploy: RedeployFn;
  appendSummary: (line: string) => void;
  /**
   * Explicit service list. Each entry may be either an SSOT key
   * (e.g. `showcase-mastra`) or a `showcase_build.yml` dispatch_name
   * (e.g. `mastra`, `shell-dashboard`, `showcase-aimock`).
   *
   * When undefined, the default scope is `CI_BUILT_SERVICES` (the
   * services that `showcase_build.yml` actually builds). webhooks is
   * NEVER in the default scope. In both branches the scope is then
   * expanded with env-declaring `imageOf` consumers (see
   * expandImageConsumers).
   */
  services?: string[];
}

/**
 * A single per-service redeploy outcome. `status:"ok"` means Railway accepted
 * the `serviceInstanceRedeploy` for that service; `status:"error"` carries the
 * sanitized failure. Callers that must confirm a SPECIFIC service was actually
 * redeployed (e.g. reconcile-staging's per-service remediation check) match on
 * these records rather than the post-expansion `attempted` COUNT — imageOf
 * expansion inflates `attempted` above the requested set, so a count alone can
 * mask a dropped/failed service.
 */
export interface RedeployServiceRecord {
  service: string;
  status: "ok" | "error";
  error?: string;
}

export interface RunRedeploySummary {
  exitCode: number;
  attempted: number;
  succeeded: number;
  failed: number;
  /**
   * Per-service outcomes for EVERY service the run attempted (post-expansion),
   * in iteration order. Exposed so a caller can confirm remediation
   * per-service instead of trusting the aggregate counts.
   */
  records: RedeployServiceRecord[];
}

/**
 * Normalize a caller-supplied service list (CSV of SSOT keys and/or
 * dispatch_names, in any mix) into a deduped list of SSOT keys.
 *
 * Ordering is intentionally split by branch:
 *   - When `input` is undefined, returns the default `CI_BUILT_SERVICES`
 *     set sorted alphabetically (never includes webhooks).
 *   - When `input` is provided, returns the resolved SSOT keys in the
 *     caller's INSERTION order (deduped). `runRedeploy` then sorts before
 *     iterating, so the user-visible iteration order is alphabetical in
 *     both cases, but this function preserves insertion order so callers
 *     that want it can opt in.
 *
 * Exported for direct unit testing.
 */
export function resolveTargetServices(input: string[] | undefined): string[] {
  if (input === undefined) {
    return [...CI_BUILT_SERVICES].sort();
  }
  const resolved = new Set<string>();
  for (const raw of input) {
    const name = raw.trim();
    if (!name) continue;
    // Own-property lookup: a bare `SERVICES[name]` truthiness check would
    // resolve inherited Object.prototype keys (e.g. "toString") to a
    // truthy non-entry, letting a bogus name flow downstream to a
    // redeploy(undefined, …) call instead of failing loud here.
    if (Object.hasOwn(SERVICES, name)) {
      resolved.add(name);
      continue;
    }
    const viaDispatch = serviceForDispatchName(name);
    if (viaDispatch) {
      resolved.add(viaDispatch);
      continue;
    }
    throw new Error(
      `Unknown service "${name}" — not an SSOT key or dispatch_name in railway-envs.ts. Add it to SERVICES (with a dispatchName) or fix the caller.`,
    );
  }
  // An explicitly-provided list that resolves to NOTHING (every entry
  // empty/whitespace) must fail loud: returning [] would let runRedeploy
  // exit 0 having redeployed nothing — the silent-no-op class this
  // script's header forbids. (parseArgs already rejects empty CSV at the
  // CLI boundary; this guards the programmatic path.)
  if (resolved.size === 0) {
    throw new Error(
      "--services was provided but resolved to zero services — refusing to silently no-op. Pass at least one SSOT key or dispatch_name, or omit --services for the default CI-built scope.",
    );
  }
  return [...resolved];
}

/**
 * Expand a resolved SSOT-key list with its `imageOf` consumers for the
 * given env: any service whose `imageOf` names a service already in the
 * list runs that service's image, so a redeploy of the builder must also
 * redeploy the consumer (a rebuilt `showcase-harness:latest` that only
 * bounces the `harness` scheduler leaves `harness-workers` silently
 * running the stale image — the PR #5352 regression).
 *
 * Env-aware: a consumer is only added if it declares `env` in its
 * `environments` map (the staging-only worker must never enter a prod
 * redeploy). Contract: the `env` parameter must be a normalized EnvName
 * key as registered in ENV_ID_BY_NAME ("prod"/"staging") — anything else
 * (synonyms like "production", garbage, inherited prototype keys) THROWS
 * up front. Silent no-expansion on a bad env string is exactly the
 * stale-image regression class this function exists to prevent, so
 * unknown envs fail loud; route synonyms through resolveEnv first.
 * Single-level by design — `assertImageConsumersValid` in railway-envs.ts
 * forbids imageOf on ciBuilt services, so there are no
 * consumer-of-consumer chains to chase. Preserves the input order and
 * appends consumers (callers sort before iterating). Exported for direct
 * unit testing.
 */
export function expandImageConsumers(names: string[], env: EnvName): string[] {
  // Own-key check against the canonical env registry: a plain
  // `ENV_ID_BY_NAME[env]` truthiness test would accept inherited
  // Object.prototype keys (e.g. "constructor") as known envs.
  if (!Object.hasOwn(ENV_ID_BY_NAME, env)) {
    throw new Error(
      `Unknown env "${String(env)}" — expandImageConsumers requires a normalized SSOT env key (one of: ${Object.keys(ENV_ID_BY_NAME).join(", ")}). Synonyms like "production" must be normalized via resolveEnv() first.`,
    );
  }
  const out = new Set(names);
  const inScope = new Set(names);
  for (const [consumer, entry] of Object.entries(SERVICES)) {
    if (entry.imageOf === undefined) continue;
    if (!inScope.has(entry.imageOf)) continue;
    if (!Object.hasOwn(entry.environments, env)) continue;
    out.add(consumer);
  }
  return [...out];
}

/**
 * The accepted env spellings for usage strings, derived from the ENV_IDS
 * registry (open-env contract: a newly registered spelling shows up here
 * with no code change — never hardcode the prod/production/staging triple).
 */
function usageEnvList(): string {
  return Object.keys(ENV_IDS).join(" | ");
}

/**
 * Pure argv parser. Accepts either `--services x,y,z` or `--services=x,y,z`.
 * Throws if `--services` is provided with a missing/empty value or a
 * flag-like value (whole-token OR any flag-like CSV part), or is passed
 * more than once (silent no-op / silent last-one-wins in CI is worse than
 * a loud failure). Throws on unknown args, on a flag-like first argument
 * (a forgotten env), or on empty argv. Exported for direct unit testing.
 */
export function parseArgs(argv: string[]): {
  env: string;
  services?: string[];
} {
  if (argv.length === 0) {
    throw new Error(
      `Usage: redeploy-env.ts <env> [--services <csv>] (env: ${usageEnvList()})`,
    );
  }
  const env = argv[0];
  if (env.startsWith("-")) {
    // A flag in the env position means the operator forgot the env
    // argument entirely (`redeploy-env.ts --services mastra`) — consuming
    // the flag AS an env would surface as a confusing Unknown-env error
    // far from the actual mistake.
    throw new Error(
      `Missing env argument (got flag "${env}"). Usage: redeploy-env.ts <env> [--services <csv>] (env: ${usageEnvList()})`,
    );
  }
  let services: string[] | undefined;

  const ensureNonEmpty = (raw: string | undefined): string[] => {
    if (raw === undefined || raw === "") {
      throw new Error("--services requires a non-empty comma-separated value");
    }
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) {
      throw new Error("--services requires a non-empty comma-separated value");
    }
    for (const part of parts) {
      if (part.startsWith("-")) {
        // Mirror of the space-form next-token guard below: a flag-like
        // CSV part (`--services=--bogus`, `--services mastra,-x`) is a
        // mis-typed invocation, not a service name — fail at the CLI
        // boundary instead of as an Unknown-service error downstream.
        throw new Error(
          `--services entries must be service names, got flag-like "${part}"`,
        );
      }
    }
    return parts;
  };

  const ensureNotDuplicate = (): void => {
    if (services !== undefined) {
      throw new Error(
        "Duplicate --services flag — pass a single comma-separated list",
      );
    }
  };

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--services") {
      ensureNotDuplicate();
      const next = argv[i + 1];
      if (next !== undefined && next.startsWith("-")) {
        // A flag-like next token means the value was forgotten; consuming
        // it as the CSV would silently swallow the next flag.
        throw new Error(`--services requires a value (got "${next}")`);
      }
      services = ensureNonEmpty(argv[++i]);
    } else if (a.startsWith("--services=")) {
      ensureNotDuplicate();
      services = ensureNonEmpty(a.slice("--services=".length));
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return services === undefined ? { env } : { env, services };
}

export async function runRedeploy(
  opts: RunRedeployOpts,
): Promise<RunRedeploySummary> {
  const { env, redeploy, appendSummary, services } = opts;
  // Resolve the Railway env-id via the canonical registry — NOT a
  // hardcoded prod/staging pair. The SSOT's open-env contract says a new
  // env needs only a registry entry; hardcoding the pair here would make
  // this script the one consumer that silently can't see it. Own-key
  // lookup so inherited Object.prototype keys don't pass as envs.
  if (!Object.hasOwn(ENV_ID_BY_NAME, env)) {
    throw new Error(
      `Unknown env "${String(env)}" — runRedeploy requires a normalized SSOT env key (one of: ${Object.keys(ENV_ID_BY_NAME).join(", ")}). Synonyms like "production" must be normalized via resolveEnv() first.`,
    );
  }
  const envId = ENV_ID_BY_NAME[env];
  // Resolve the caller's scope, then pull in every `imageOf` consumer of a
  // service already in scope (env-aware) — a rebuilt image must redeploy
  // ALL the services that run it, not just its build slot.
  //
  // The DEFAULT scope (no explicit --services) is env-aware: a ciBuilt
  // service that does not declare the target env — e.g. a staging-only
  // integration whose prod instance is not yet provisioned
  // (showcase-strands-typescript) — must NOT enter that env's default
  // redeploy scope, exactly as a staging-only worker must not. Explicit
  // --services stays UNFILTERED (the CONTRACT PIN: an operator can force a
  // named service in an env it does not declare). imageOf expansion below
  // is independently env-aware.
  const base = resolveTargetServices(services);
  const scoped =
    services === undefined
      ? base.filter((name) => Object.hasOwn(SERVICES[name].environments, env))
      : base;
  const names = expandImageConsumers(scoped, env).sort();

  const failures: Array<{ service: string; error: string }> = [];
  // Per-service structured records — cross-workstream contract consumed
  // by showcase_deploy.yml's `enforce-redeploy-gate` (A.7) via the
  // REDEPLOY_SUMMARY_JSON artifact. Shape:
  //   Array<{ service: string; status: "ok" | "error"; error?: string }>
  // Built in parallel with the existing `failures`/`succeeded` tallies so
  // PR #5093's exit-code computation below is untouched.
  const records: RedeployServiceRecord[] = [];
  let succeeded = 0;

  appendSummary(`## Railway redeploy — env=${env}`);
  appendSummary("");

  for (const name of names) {
    // Defensive own-property lookup. Currently unreachable: every name here
    // came through resolveTargetServices (which rejects non-SSOT names,
    // including inherited Object.prototype keys) and expandImageConsumers
    // (which only adds real SSOT keys). This guard is defense-in-depth
    // against future refactors of that resolution pipeline — if one ever
    // lets a bogus name through, fail loud as an operator error instead of
    // reaching redeploy(undefined, envId).
    const entry = Object.hasOwn(SERVICES, name) ? SERVICES[name] : undefined;
    if (entry === undefined) {
      throw new Error(
        `Unknown service "${name}" — not an SSOT key in railway-envs.ts. Add it to SERVICES or fix the caller.`,
      );
    }
    process.stdout.write(`  ${name.padEnd(36)} `);
    try {
      const outcome = await redeploy(entry.serviceId, envId);
      if (outcome.ok) {
        succeeded++;
        records.push({ service: name, status: "ok" });
        process.stdout.write("OK\n");
      } else {
        failures.push({ service: name, error: outcome.error });
        records.push({ service: name, status: "error", error: outcome.error });
        process.stdout.write(`FAIL: ${outcome.error}\n`);
      }
    } catch (e: unknown) {
      // Sanitize like the non-throw FAIL path: makeLiveRedeploy pre-sanitizes
      // the errors it RETURNS, but a rejection thrown by the redeploy fn
      // (e.g. an AbortSignal timeout, or a fetch error wrapping a multi-KB
      // Cloudflare HTML page) bypasses that — sanitize before recording so
      // the records artifact and the markdown summary stay bounded/clean.
      const error = sanitizeErrorBody(
        e instanceof Error ? e.message : String(e),
      );
      failures.push({ service: name, error });
      records.push({ service: name, status: "error", error });
      process.stdout.write(`FAIL (threw): ${error}\n`);
    }
  }

  const attempted = names.length;
  const failed = failures.length;

  appendSummary(`- attempted: **${attempted}**`);
  appendSummary(`- succeeded: **${succeeded}**`);
  appendSummary(`- failed: **${failed}**`);
  appendSummary("");

  if (failures.length > 0) {
    appendSummary("### Failures");
    appendSummary("");
    appendSummary("| service | status | error |");
    appendSummary("| --- | --- | --- |");
    for (const f of failures) {
      // Escape pipes and flatten ALL line-break chars — including a bare
      // \r with no following \n — so the markdown table row stays intact.
      const safeErr = f.error.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
      appendSummary(`| \`${f.service}\` | FAIL | ${safeErr} |`);
    }
    appendSummary("");
    if (env === "staging") {
      appendSummary(
        "Staging redeploys are non-fatal — the verify-deploy workflow is the gate.",
      );
    }
  }

  // A.4: optional per-service JSON summary for showcase_deploy.yml's
  // `enforce-redeploy-gate` job. Atomic write (stage to .tmp, rename) so
  // a CI consumer racing the writer never sees a partial file. A failure
  // here is warn-only — PR #5093's exit-code semantics MUST NOT regress
  // on a disk hiccup.
  // Trimmed: a whitespace-only value is exactly as unusable as the empty
  // string and must hit the same loud warn path below — untrimmed it is
  // truthy and would fall through to a write against a garbage path.
  const jsonPath = process.env.REDEPLOY_SUMMARY_JSON?.trim();
  if (jsonPath === "") {
    // Set-but-empty is almost certainly a workflow wiring bug (e.g. an
    // unexpanded expression) — the falsy check below would silently skip
    // the write and the CI consumer would see "no artifact" with zero
    // signal about why. Warn loudly; still skip the write (there is no
    // usable path to write to).
    process.stderr.write(
      "warning: REDEPLOY_SUMMARY_JSON is set but empty — skipping the JSON summary write\n",
    );
  } else if (jsonPath) {
    try {
      const tmp = `${jsonPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(records, null, 2) + "\n");
      fs.renameSync(tmp, jsonPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        `warning: failed to write REDEPLOY_SUMMARY_JSON=${jsonPath} (${msg})\n`,
      );
      // Non-fatal: best-effort CI summary write; do NOT regress
      // PR #5093's exit semantics on a disk hiccup.
    }
  }

  // Fail-loud DEFAULT: per-service failures yield a non-zero exit in
  // every env. Staging is the single documented carve-out (non-fatal —
  // the verify-deploy workflow is its real release gate). Inverted from
  // the historic `env === "prod"` allowlist so a future env (preview,
  // canary, …) inherits fatal semantics instead of silently swallowing
  // failures the way only staging is meant to.
  const exitCode = env !== "staging" && failed > 0 ? 1 : 0;
  return { exitCode, attempted, succeeded, failed, records };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(
      "Usage: npx tsx showcase/scripts/redeploy-env.ts <env> [--services <csv>]",
    );
    console.error(`  env: ${usageEnvList()}`);
    console.error("  --services: optional CSV of SSOT keys or dispatch_names");
    process.exit(2);
  }
  const parsed = parseArgs(argv);
  const { env } = resolveEnv(parsed.env);
  const services = parsed.services;

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  const appendSummary = (line: string) => {
    if (summaryFile) {
      try {
        fs.appendFileSync(summaryFile, line + "\n");
      } catch (e) {
        // Best-effort: a non-writable $GITHUB_STEP_SUMMARY must not abort
        // the run. Mirror to stderr so the failure is at least visible.
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(
          `warning: failed to append to GITHUB_STEP_SUMMARY (${msg})\n`,
        );
      }
    }
    // Also mirror to stderr so local runs see it.
    process.stderr.write(line + "\n");
  };

  // Resolve the Railway token ONCE for the whole run, then thread it
  // through to liveRedeploy. Missing/malformed creds exit non-zero from
  // getToken() before we ever enter the per-service loop.
  const token = getToken();
  const redeploy = makeLiveRedeploy(token);

  const result = await runRedeploy({
    env,
    redeploy,
    appendSummary,
    services,
  });
  console.log(
    `\n${result.succeeded}/${result.attempted} redeploys triggered (${result.failed} failed)`,
  );
  process.exit(result.exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    // Fail loud on operator/config errors (bad env name, unknown service,
    // missing/malformed token, parseArgs rejection, etc.). Per-service
    // Railway failures are caught INSIDE runRedeploy and reflected in
    // result.exitCode — they never reach this catch — so reaching here
    // means something is wrong with how the script was invoked or
    // configured, and CI should see a red run instead of a silent no-op.
    process.exit(1);
  });
}
