#!/usr/bin/env npx tsx
/**
 * verify-railway-image-refs.ts — Per-env drift assertion for Railway
 * showcase image refs.
 *
 * Fetches every service in the CopilotKit Showcase Railway project and
 * validates the image reference configured on each env-scoped service
 * instance against the canonical shape for that env:
 *
 *   STAGING : ghcr.io/copilotkit/<repo>:latest              (mutable tag)
 *   PROD    : ghcr.io/copilotkit/<repo>@sha256:<digest>     (immutable pin)
 *
 * <repo> defaults to the Railway service name; per-env overrides live
 * in railway-envs.ts via `repoNameOverride` (currently: SSOT key
 * `aimock` overrides BOTH prod and staging to repo `showcase-aimock`
 * — the fixture-baking wrapper is the permanent, canonical aimock
 * image; prod must be `@sha256`-pinned, staging is `:latest`. Plus
 * pocketbase and webhooks, which override BOTH envs to
 * `showcase-pocketbase` and `showcase-eval-webhook` respectively).
 *
 * Backstory: on 2026-04-21, 18 production services were found with malformed
 * image refs `ghcr.io/copilotkit/showcase-<slug>atest` (missing the `:`
 * before `latest`, so Docker treats `...atest` as the tag). The root cause
 * was an out-of-band MCP/manual mutation — no committed code touched them.
 * This script exists so any future corruption fails loudly and early in CI
 * before a bad deploy goes out.
 *
 * Usage:
 *   npx tsx showcase/scripts/verify-railway-image-refs.ts
 *
 * Requires: RAILWAY_TOKEN env var or ~/.railway/config.json
 * Exit: 0 when every env-scoped instance matches; 1 on any violation.
 */

import { fileURLToPath } from "url";
import {
  PRODUCTION_ENV_ID,
  PROJECT_ID,
  SERVICES,
  STAGING_ENV_ID,
  repoNameFor,
} from "./railway-envs";
import type { EnvName } from "./railway-envs";
import {
  RAILWAY_GRAPHQL_ENDPOINT,
  sanitizeErrorBody,
} from "./lib/railway-graphql";
import { RailwayTokenError, resolveRailwayToken } from "./lib/railway-token";

const RAILWAY_API = RAILWAY_GRAPHQL_ENDPOINT;

// Canonical shapes per env.
//   Staging :latest pattern — exact-match against `<repo>:latest`.
//   Prod    @sha256:<hex>  — exact-match against `<repo>@sha256:<64 hex>`.
const STAGING_SHAPE = /^ghcr\.io\/copilotkit\/[a-z0-9-]+:latest$/;
const PROD_SHAPE = /^ghcr\.io\/copilotkit\/[a-z0-9-]+@sha256:[0-9a-f]{64}$/;

export interface ValidateOpts {
  env: EnvName;
  /** Expected GHCR repo name. Caller resolves this from SERVICES + env. */
  repoName: string;
}

export interface Violation {
  service: string;
  env: EnvName;
  image: string | null;
  reason: string;
}

/**
 * Pure, unit-testable validator. Caller is responsible for resolving
 * the expected repo name from the SERVICES map (handling per-env
 * overrides) and passing it in here.
 *
 * Returns null when valid, or a Violation describing the failure.
 * The `service` field is left blank ("") so the main loop can fill it in;
 * tests can ignore it.
 */
export function validateImage(
  image: string | null,
  opts: ValidateOpts,
): Violation | null {
  const { env, repoName } = opts;
  // Normalize empty-string to null so the reporter renders `<unset>`
  // rather than a blank line on a missing image.
  const normalizedImage = image === "" ? null : image;
  if (!normalizedImage) {
    return {
      service: "",
      env,
      image: null,
      reason:
        "no image source configured (expected a Docker image, not a repo)",
    };
  }

  if (env === "staging") {
    if (!STAGING_SHAPE.test(normalizedImage)) {
      if (!normalizedImage.startsWith("ghcr.io/copilotkit/")) {
        return {
          service: "",
          env,
          image: normalizedImage,
          reason: `image is not on ghcr.io/copilotkit (got: ${normalizedImage}); staging expects ghcr.io/copilotkit/<repo>:latest`,
        };
      }
      if (/@sha256:/.test(normalizedImage)) {
        return {
          service: "",
          env,
          image: normalizedImage,
          reason:
            "staging must float on :latest, found a @sha256: digest pin. Promote-back-from-prod bug?",
        };
      }
      return {
        service: "",
        env,
        image: normalizedImage,
        reason:
          "image is on ghcr.io/copilotkit but is not the `:latest` shape (staging requires the mutable :latest tag)",
      };
    }
    const expected = `ghcr.io/copilotkit/${repoName}:latest`;
    if (normalizedImage !== expected) {
      return {
        service: "",
        env,
        image: normalizedImage,
        reason: `image repo name mismatches expected (expected exactly ${expected})`,
      };
    }
    return null;
  }

  // env === "prod"
  if (!PROD_SHAPE.test(normalizedImage)) {
    if (!normalizedImage.startsWith("ghcr.io/copilotkit/")) {
      return {
        service: "",
        env,
        image: normalizedImage,
        reason:
          "does not match canonical shape ^ghcr\\.io/copilotkit/[a-z0-9-]+@sha256:[0-9a-f]{64}$",
      };
    }
    if (normalizedImage.endsWith(":latest")) {
      return {
        service: "",
        env,
        image: normalizedImage,
        reason:
          "prod must be pinned to `@sha256:<digest>` (got `:latest`). Run `bin/railway promote` to pin from staging.",
      };
    }
    return {
      service: "",
      env,
      image: normalizedImage,
      reason:
        "does not match canonical prod shape ^ghcr\\.io/copilotkit/[a-z0-9-]+@sha256:[0-9a-f]{64}$",
    };
  }
  // Validate the repo portion (everything before `@sha256:`) matches.
  const repoPart = normalizedImage.split("@", 1)[0]; // "ghcr.io/copilotkit/<repo>"
  const expectedRepo = `ghcr.io/copilotkit/${repoName}`;
  if (repoPart !== expectedRepo) {
    return {
      service: "",
      env,
      image: normalizedImage,
      reason: `image repo name mismatches expected (expected exactly ${expectedRepo}@sha256:<digest>)`,
    };
  }
  return null;
}

/**
 * Coverage assertion — returns the names of SSOT services with
 * `gateValidated: true` that are NOT present in the Railway response
 * for the given env. A non-empty result means the gate should fail
 * (drift in the SSOT-vs-Railway direction: a service was deleted or
 * renamed on Railway without updating the SSOT).
 *
 * Pure / unit-testable. Caller (main()) is responsible for collecting
 * the set of seen SSOT-known service names from the Railway response.
 *
 * Note: `env` is accepted for symmetry and future per-env scoping,
 * but currently the gateValidated flag is env-independent so the
 * result does not depend on it. Result is sorted for stable output.
 */
export function findMissingServices(
  _env: EnvName,
  presentServiceNames: Set<string>,
): string[] {
  const missing: string[] = [];
  for (const [name, entry] of Object.entries(SERVICES)) {
    if (!entry.gateValidated) continue;
    if (!presentServiceNames.has(name)) missing.push(name);
  }
  return missing.sort();
}

/**
 * Coverage assertion — Railway → SSOT direction. Returns the names of
 * Railway services that are NOT present in the SSOT. A non-empty result
 * means the gate should fail (drift in the Railway→SSOT direction: an
 * out-of-band service was added to the Railway project without updating
 * the SSOT).
 *
 * Pure / unit-testable. Caller (main()) is responsible for collecting
 * the set of Railway-reported service names from the GraphQL response.
 *
 * Note: complements `findMissingServices` (SSOT→Railway direction); see
 * its docstring above. The two directions are NOT the same check — do
 * NOT collapse them.
 */
export function findUntrackedServices(
  railwayServiceNames: ReadonlySet<string>,
): string[] {
  const untracked: string[] = [];
  for (const name of railwayServiceNames) {
    const entry = SERVICES[name];
    // Any SSOT entry — gateIgnored or not — is known/accounted-for in
    // the Railway->SSOT direction. Only absence from the SSOT counts.
    if (entry) continue;
    untracked.push(name);
  }
  return untracked.sort();
}

export interface FailureSummaryInput {
  violations: Violation[];
  missingByEnv: Record<EnvName, string[]>;
  untracked: string[];
  checked: number;
  skipped: number;
}

export interface FailureSummaryOutput {
  shouldFail: boolean;
  lines: string[];
}

/**
 * Pure failure-summary builder. Takes the three classes of finding
 * the gate produces and returns the lines main() should print plus a
 * boolean indicating whether to exit non-zero. Extracted from main()
 * so it can be unit-tested without going through GraphQL.
 *
 * Three failure classes (all REFUSE — none are warnings):
 *   1. shape violations (Violation[])
 *   2. SSOT->Railway drift (gateValidated SSOT services missing on Railway)
 *   3. Railway->SSOT drift (Railway services not in the SSOT, NOT
 *      opted out via gateIgnore)
 */
export function summarizeFailures(
  input: FailureSummaryInput,
): FailureSummaryOutput {
  const { violations, missingByEnv, untracked, checked, skipped } = input;
  const totalMissing = missingByEnv.prod.length + missingByEnv.staging.length;
  const shouldFail =
    violations.length > 0 || totalMissing > 0 || untracked.length > 0;
  const lines: string[] = [];

  if (!shouldFail) return { shouldFail, lines };

  lines.push(
    `\n✗ Railway image-ref drift detected (${violations.length} violations across ${checked} env-scoped instances; ${totalMissing} missing services; ${untracked.length} untracked Railway services; ${skipped} skipped)\n`,
  );
  for (const v of violations) {
    lines.push(`  ✗ [${v.env}] ${v.service}`);
    lines.push(`    current:  ${v.image ?? "<unset>"}`);
    lines.push(`    reason:   ${v.reason}`);
  }
  for (const env of ["prod", "staging"] as const) {
    for (const name of missingByEnv[env]) {
      lines.push(`  ✗ [${env}] ${name}`);
      lines.push(`    current:  <missing from Railway>`);
      lines.push(
        `    reason:   gateValidated SSOT service has no serviceInstance in ${env} — was it deleted or renamed?`,
      );
    }
  }
  for (const name of untracked) {
    lines.push(`  ✗ [railway] ${name}`);
    lines.push(`    current:  <present on Railway, absent from SSOT>`);
    lines.push(
      `    reason:   Railway service "${name}" is not in the SSOT. Either add it to SERVICES in showcase/scripts/railway-envs.ts (preferred), or mark an existing entry with gateIgnore: true if it is deliberately unmanaged by WS4.`,
    );
  }
  lines.push(
    `\nFix via Railway dashboard, \`bin/railway pin\`, \`bin/railway promote\`, or \`showcase/scripts/redeploy-env.ts\`.\n`,
  );
  return { shouldFail, lines };
}

// ── Railway GraphQL plumbing ────────────────────────────────────────────

/**
 * Resolve the Railway bearer token for this run. Wraps the shared
 * `resolveRailwayToken` envelope and maps any RailwayTokenError onto
 * the script's exit-1 contract (operator/config error). The shared
 * helper never calls process.exit — exit-code mapping lives HERE.
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
    // sanitize: Cloudflare WAF blocks return multi-KB HTML pages —
    // strip angle brackets + control chars and cap at the shared
    // default to keep CI logs readable.
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

interface ProjectServicesWithInstances {
  // Railway returns project: null (no GraphQL `errors` block) when the
  // PROJECT_ID is wrong OR the token lacks access — type accordingly so
  // the null-check in main() is enforced by the compiler.
  project: {
    services: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          serviceInstances: {
            edges: Array<{
              node: {
                environmentId: string;
                source: { image: string | null } | null;
              };
            }>;
          };
        };
      }>;
    };
  } | null;
}

async function main(): Promise<void> {
  const data = await railwayGql<ProjectServicesWithInstances>(
    `query project($id: String!) {
      project(id: $id) {
        services {
          edges { node {
            id
            name
            serviceInstances {
              edges { node { environmentId source { image } } }
            }
          } }
        }
      }
    }`,
    { id: PROJECT_ID },
  );

  // Railway returns project: null with NO `errors` array when PROJECT_ID
  // is wrong or the token lacks access — without this guard, reading
  // `data.project.services` throws a confusing TypeError.
  if (data.project === null || data.project === undefined) {
    throw new Error(
      `Railway project ${PROJECT_ID} returned null — check PROJECT_ID and that the Railway token has access to this project.`,
    );
  }

  const violations: Violation[] = [];
  let checked = 0;
  let skipped = 0;
  // Per-env set of SSOT-known, gateValidated service names we actually
  // saw in the Railway response. Used post-loop for coverage assertion.
  const seenByEnv: Record<EnvName, Set<string>> = {
    prod: new Set<string>(),
    staging: new Set<string>(),
  };
  // Names Railway actually reported back, used post-loop for the
  // Railway -> SSOT coverage assertion (findUntrackedServices).
  const railwayReportedNames = new Set<string>();

  for (const edge of data.project.services.edges) {
    const svc = edge.node;
    railwayReportedNames.add(svc.name);
    const entry = SERVICES[svc.name];

    // Railway -> SSOT direction is handled post-loop via
    // findUntrackedServices(); do NOT log a warning here. An unknown
    // service that ALSO has a shape problem will surface in the
    // post-loop failure block under the "untracked" class, which is
    // the right shape (we can't validate shape without an expected
    // repo name, and there is no SSOT entry to derive one from).
    if (!entry) continue;

    // gateIgnore: deliberately unmanaged. Skip both shape validation
    // and Railway->SSOT membership reporting (the helper also honours
    // this flag for that direction).
    if (entry.gateIgnore) {
      skipped++;
      continue;
    }

    // Per-WS-C gate scope: only services explicitly marked
    // gateValidated. After WS-C lands the 5-service flip this is
    // every entry in SERVICES — the Phase-2 deferral is retired.
    if (!entry.gateValidated) {
      skipped++;
      continue;
    }

    for (const env of ["prod", "staging"] as const) {
      const envId = env === "prod" ? PRODUCTION_ENV_ID : STAGING_ENV_ID;
      const instance = svc.serviceInstances.edges.find(
        (e) => e.node.environmentId === envId,
      );
      // A gateValidated SSOT service with no serviceInstance for this
      // env is genuine drift; don't count it as "seen" so the coverage
      // assertion catches it.
      if (!instance) continue;
      seenByEnv[env].add(svc.name);

      const image = instance.node.source?.image ?? null;

      checked++;
      const repoName = repoNameFor(svc.name, env);
      const v = validateImage(image, { env, repoName });
      if (v) {
        violations.push({ ...v, service: svc.name });
      }
    }
  }

  // Coverage assertions:
  //   - SSOT->Railway: a gateValidated SSOT service that did not show
  //     up in the Railway response is drift.
  //   - Railway->SSOT: a Railway service that has no SSOT entry (and
  //     is not opted out via gateIgnore) is drift.
  const missingByEnv: Record<EnvName, string[]> = {
    prod: findMissingServices("prod", seenByEnv.prod),
    staging: findMissingServices("staging", seenByEnv.staging),
  };
  const untracked = findUntrackedServices(railwayReportedNames);

  const summary = summarizeFailures({
    violations,
    missingByEnv,
    untracked,
    checked,
    skipped,
  });

  if (summary.shouldFail) {
    for (const line of summary.lines) console.error(line);
    process.exit(1);
  }

  console.log(
    `✓ ${checked} env-scoped instances verified (${skipped} skipped)`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
