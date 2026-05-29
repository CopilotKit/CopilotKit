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

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  PRODUCTION_ENV_ID,
  PROJECT_ID,
  SERVICES,
  STAGING_ENV_ID,
  repoNameFor,
} from "./railway-envs";
import type { EnvName } from "./railway-envs";
import { RAILWAY_GRAPHQL_ENDPOINT } from "./lib/railway-graphql";
import { resolveRailwayTokenFromConfig } from "./lib/railway-token";

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

// ── Railway GraphQL plumbing ────────────────────────────────────────────

function getToken(): string {
  if (process.env.RAILWAY_TOKEN) return process.env.RAILWAY_TOKEN;
  const home = process.env.HOME;
  if (!home) {
    console.error(
      "No Railway token found. RAILWAY_TOKEN is unset and $HOME is unset so ~/.railway/config.json cannot be located.",
    );
    process.exit(1);
  }
  const configPath = path.join(home, ".railway", "config.json");
  if (fs.existsSync(configPath)) {
    let config: unknown;
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Malformed ~/.railway/config.json: ${msg}`);
      process.exit(1);
    }
    const token = resolveRailwayTokenFromConfig(
      config as Parameters<typeof resolveRailwayTokenFromConfig>[0],
    );
    if (typeof token === "string" && token.length > 0) return token;
  }
  console.error(
    "No Railway token found. Set RAILWAY_TOKEN or run `railway login`.",
  );
  process.exit(1);
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
    throw new Error(`Railway API error: ${res.status} ${await res.text()}`);
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
  };
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

  const violations: Violation[] = [];
  let checked = 0;
  let skipped = 0;
  // Per-env set of SSOT-known, gateValidated service names we actually
  // saw in the Railway response. Used post-loop for coverage assertion.
  const seenByEnv: Record<EnvName, Set<string>> = {
    prod: new Set<string>(),
    staging: new Set<string>(),
  };

  for (const edge of data.project.services.edges) {
    const svc = edge.node;
    const entry = SERVICES[svc.name];

    // Unknown-service policy (WS4): log a warning and keep the gate
    // green. Rationale: a NEW Railway service that we haven't added to
    // the SSOT yet is operator drift, not image-ref corruption — the
    // image-ref gate is the wrong place to fail. (A separate "SSOT
    // parity" check is the right shape if we ever want to fail on
    // drift in that direction; that's out of WS4 scope.)
    if (!entry) {
      console.warn(
        `⚠ Skipping unknown Railway service "${svc.name}" — add it to railway-envs.ts SERVICES if it should be verified.`,
      );
      continue;
    }

    // Per-WS4 gate scope: only services explicitly marked
    // gateValidated. The historic gate filtered to `showcase-*`-prefix
    // services; WS4 inherits that scope plus aimock + pocketbase +
    // webhooks (set on the SSOT entry). dashboard/docs/dojo/harness/
    // shell are deferred to Phase 2.
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

  // Coverage assertion: a gateValidated SSOT service that did not
  // show up in the Railway response (deleted/renamed/missing instance
  // in that env) is drift. Fail loudly through the same path as a
  // shape violation.
  const missingByEnv: Record<EnvName, string[]> = {
    prod: findMissingServices("prod", seenByEnv.prod),
    staging: findMissingServices("staging", seenByEnv.staging),
  };
  const totalMissing = missingByEnv.prod.length + missingByEnv.staging.length;

  if (violations.length > 0 || totalMissing > 0) {
    console.error(
      `\n✗ Railway image-ref drift detected (${violations.length} violations across ${checked} env-scoped instances; ${totalMissing} missing services; ${skipped} skipped)\n`,
    );
    for (const v of violations) {
      console.error(`  ✗ [${v.env}] ${v.service}`);
      console.error(`    current:  ${v.image ?? "<unset>"}`);
      console.error(`    reason:   ${v.reason}`);
    }
    for (const env of ["prod", "staging"] as const) {
      for (const name of missingByEnv[env]) {
        console.error(`  ✗ [${env}] ${name}`);
        console.error(`    current:  <missing from Railway>`);
        console.error(
          `    reason:   gateValidated SSOT service has no serviceInstance in ${env} — was it deleted or renamed?`,
        );
      }
    }
    console.error(
      `\nFix via Railway dashboard, \`bin/railway pin\`, \`bin/railway promote\`, or \`showcase/scripts/redeploy-env.ts\`.\n`,
    );
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
