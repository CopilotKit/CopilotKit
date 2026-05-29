#!/usr/bin/env npx tsx
/**
 * redeploy-env.ts — Trigger Railway `serviceInstanceRedeploy` for the
 * CI-built showcase services in the named environment.
 *
 * Usage:
 *   npx tsx showcase/scripts/redeploy-env.ts <env> [--services <csv>]
 *
 *   npx tsx showcase/scripts/redeploy-env.ts staging
 *     → redeploys all 25 CI_BUILT_SERVICES (default scope excludes
 *       pocketbase/webhooks; explicit --services can still target them)
 *
 *   npx tsx showcase/scripts/redeploy-env.ts staging --services mastra,ag2
 *     → redeploys only the listed services (CSV of SSOT keys OR
 *       showcase_build.yml dispatch_names; mixed is fine).
 *
 * Behavior:
 *   - Default target set: CI_BUILT_SERVICES (25 of 27 SSOT entries).
 *     pocketbase and webhooks are first-party but released by their own
 *     repos — they are excluded from the default scope. An explicit
 *     `--services pocketbase` (or webhooks) WILL still redeploy them;
 *     resolveTargetServices honors any SSOT key the caller asks for.
 *   - When `--services` is provided, each entry is resolved via
 *     resolveTargetServices() against SSOT keys + dispatch_names.
 *   - Per-service Railway failures (including the all-services-fail case)
 *     are logged to stderr and $GITHUB_STEP_SUMMARY but DO NOT fail the
 *     process for staging. Staging is not a release gate; the
 *     verify-deploy workflow is what fails on bad images. For env=prod,
 *     per-service failures DO yield a non-zero exitCode (fail loud).
 *   - Operator/config errors (bad env name, unknown service, missing or
 *     malformed token) ALWAYS fail loud with a non-zero exit.
 *
 * Auth: RAILWAY_TOKEN env var or ~/.railway/config.json.
 * Exit code: 0 on staging even when per-service redeploys fail; non-zero
 * for prod per-service failures and for any operator/config error.
 */

import fs from "fs";
import { fileURLToPath } from "url";
import {
  CI_BUILT_SERVICES,
  PRODUCTION_ENV_ID,
  SERVICES,
  STAGING_ENV_ID,
  resolveEnv,
  serviceForDispatchName,
} from "./railway-envs";
import type { EnvName } from "./railway-envs";
import {
  RAILWAY_GRAPHQL_ENDPOINT,
  sanitizeErrorBody,
} from "./lib/railway-graphql";
import {
  RailwayTokenError,
  resolveRailwayToken,
} from "./lib/railway-token";

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
 */
function makeLiveRedeploy(token: string): RedeployFn {
  return async function liveRedeploy(
    serviceId: string,
    environmentId: string,
  ): Promise<RedeployOutcome> {
    const res = await fetch(RAILWAY_API, {
      method: "POST",
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
      return { ok: false, error: json.errors.map((e) => e.message).join("; ") };
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
   * When undefined, the default scope is `CI_BUILT_SERVICES` (the 25
   * services that `showcase_build.yml` actually builds). pocketbase
   * and webhooks are NEVER in the default scope.
   */
  services?: string[];
}

export interface RunRedeploySummary {
  exitCode: number;
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Normalize a caller-supplied service list (CSV of SSOT keys and/or
 * dispatch_names, in any mix) into a deduped list of SSOT keys.
 *
 * Ordering is intentionally split by branch:
 *   - When `input` is undefined, returns the default `CI_BUILT_SERVICES`
 *     set sorted alphabetically (never includes pocketbase/webhooks).
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
    if (SERVICES[name]) {
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
  return [...resolved];
}

/**
 * Pure argv parser. Accepts either `--services x,y,z` or `--services=x,y,z`.
 * Throws if `--services` is provided with a missing/empty value (silent
 * no-op in CI is worse than a loud failure). Throws on unknown args or
 * empty argv. Exported for direct unit testing.
 */
export function parseArgs(argv: string[]): {
  env: string;
  services?: string[];
} {
  if (argv.length === 0) {
    throw new Error(
      "Usage: redeploy-env.ts <env> [--services <csv>] (env: prod | production | staging)",
    );
  }
  const env = argv[0];
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
    return parts;
  };

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--services") {
      services = ensureNonEmpty(argv[++i]);
    } else if (a.startsWith("--services=")) {
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
  if (env !== "prod" && env !== "staging") {
    throw new Error(
      `Unknown env: ${String(env)} (expected "prod" or "staging")`,
    );
  }
  const envId = env === "prod" ? PRODUCTION_ENV_ID : STAGING_ENV_ID;
  const names = resolveTargetServices(services).sort();

  const failures: Array<{ service: string; error: string }> = [];
  // Per-service structured records — cross-workstream contract consumed
  // by showcase_deploy.yml's `enforce-redeploy-gate` (A.7) via the
  // REDEPLOY_SUMMARY_JSON artifact. Shape:
  //   Array<{ service: string; status: "ok" | "error"; error?: string }>
  // Built in parallel with the existing `failures`/`succeeded` tallies so
  // PR #5093's exit-code computation below is untouched.
  const records: Array<{
    service: string;
    status: "ok" | "error";
    error?: string;
  }> = [];
  let succeeded = 0;

  appendSummary(`## Railway redeploy — env=${env}`);
  appendSummary("");

  for (const name of names) {
    const entry = SERVICES[name];
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
      const error = e instanceof Error ? e.message : String(e);
      failures.push({ service: name, error });
      records.push({ service: name, status: "error", error });
      process.stdout.write(`FAIL (threw): ${error}\n`);
    }
  }

  const attempted = names.length;
  const failed = failures.length;

  appendSummary(`- attempted: **${attempted}**`);
  appendSummary(`- succeeded: **${succeeded}**`);
  appendSummary(`- ${failed} failed`);
  appendSummary("");

  if (failures.length > 0) {
    appendSummary("### Failures");
    appendSummary("");
    appendSummary("| service | status | error |");
    appendSummary("| --- | --- | --- |");
    for (const f of failures) {
      const safeErr = f.error.replace(/\|/g, "\\|").replace(/\n/g, " ");
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
  const jsonPath = process.env.REDEPLOY_SUMMARY_JSON;
  if (jsonPath) {
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

  // Staging: per-service failures are non-fatal (the verify-deploy
  // workflow is the real release gate). Prod: per-service failures must
  // surface as a non-zero exit so an operator notices.
  const exitCode = env === "prod" && failed > 0 ? 1 : 0;
  return { exitCode, attempted, succeeded, failed };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(
      "Usage: npx tsx showcase/scripts/redeploy-env.ts <env> [--services <csv>]",
    );
    console.error("  env: prod | production | staging");
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
