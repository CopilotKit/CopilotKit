#!/usr/bin/env npx tsx
/**
 * provision-starter-fleet.ts — Committed, reproducible Railway provisioner
 * for the SSOT-decoupled "starter container fleet" in the showcase STAGING
 * environment.
 *
 * Creates (or idempotently updates) one sleepable Railway service per
 * starter template, pulling the per-starter image from GHCR:
 *
 *   service name : starter-<slug>          (RAW starter slug, e.g.
 *                                            starter-langgraph-js, NOT the
 *                                            remapped dashboard column slug)
 *   image        : ghcr.io/copilotkit/starter-<slug>:latest
 *   env          : STAGING ONLY (railway-envs STAGING_ENV_ID)
 *   sleep        : sleepApplication = true (the whole point — sleepable)
 *   healthcheck  : "/"  (the starters' single deployable image EXPOSEs 3000
 *                  running the Next.js frontend; the frontend serves "/" and
 *                  "/api/copilotkit" but has NO "/api/health" route — that
 *                  path 404s and would wedge Railway healthchecks forever.
 *                  The agent's "/health" lives on the internal agent port
 *                  8123, which Railway does not expose. So "/" is the only
 *                  correct, reachable healthcheck for the exposed surface.)
 *   region       : us-west1 (matches every existing showcase service)
 *   GHCR creds   : registryCredentials from GITHUB_TOKEN + GHCR username
 *                  (same mechanism deploy-to-railway.ts uses)
 *   domain       : a generated Railway domain per service (serviceDomainCreate)
 *
 * The 12 starter slugs are the keys of STARTER_TO_COLUMN in
 * showcase/harness/src/probes/helpers/starter-mapping.ts — the single source
 * of truth shared with the smoke matrix (showcase/tests/e2e/starter-smoke.spec.ts)
 * and the CI build matrix (.github/workflows/showcase_build.yml). This script
 * derives its target list from that SSOT so the fleet can never drift from the
 * matrix.
 *
 * The fleet is intentionally DECOUPLED from the 27-service railway-envs SSOT:
 * starter-* services are auto-discovered at runtime by the starter_smoke probe
 * (railway-services source, namePrefix "starter-") and are NOT added to
 * SERVICES. PR #5254 already made verify-railway-image-refs.ts tolerate
 * starter-* names in BOTH drift directions, so provisioning these services
 * does NOT trip the CI image-ref gate / skip the showcase build.
 *
 * IDEMPOTENT: a starter-* service that already exists in staging is UPDATED
 * (instance settings re-applied; a domain created only if none exists) rather
 * than duplicated or errored.
 *
 * Usage:
 *   npx tsx showcase/scripts/provision-starter-fleet.ts            # provision all 12
 *   npx tsx showcase/scripts/provision-starter-fleet.ts --list     # list starter-* services in staging
 *   npx tsx showcase/scripts/provision-starter-fleet.ts --dry-run  # plan only, no mutations
 *
 * Requires: RAILWAY_TOKEN env var or ~/.railway/config.json, plus GITHUB_TOKEN
 * (+ GHCR_USERNAME or GITHUB_ACTOR) so the private GHCR images can be pulled.
 */

import { fileURLToPath } from "url";
import { STARTER_TO_COLUMN } from "../harness/src/probes/helpers/starter-mapping";
import { PROJECT_ID, STAGING_ENV_ID } from "./railway-envs";
import { RAILWAY_GRAPHQL_ENDPOINT } from "./lib/railway-graphql";
import { RailwayTokenError, resolveRailwayToken } from "./lib/railway-token";

const RAILWAY_API = RAILWAY_GRAPHQL_ENDPOINT;

/** Railway service-name prefix for the starter fleet (RAW starter slug). */
export const STARTER_FLEET_PREFIX = "starter-";

/**
 * The healthcheck path Railway probes against the exposed container port.
 * "/" — see the file header for why this is NOT "/api/health".
 */
export const STARTER_HEALTHCHECK_PATH = "/";

/** Region every existing showcase service runs in; match it. */
export const STARTER_REGION = "us-west1";

// ── Target derivation (from the starter-mapping SSOT) ───────────────────

export interface StarterTarget {
  /** RAW starter slug, e.g. "langgraph-js", "adk". */
  slug: string;
  /** Railway service name, e.g. "starter-langgraph-js". */
  serviceName: string;
  /** GHCR image ref, e.g. "ghcr.io/copilotkit/starter-langgraph-js:latest". */
  image: string;
}

/**
 * Derive the 12 provisioning targets from STARTER_TO_COLUMN (the SSOT). The
 * service name and image both use the RAW starter slug (the map KEY), never
 * the remapped dashboard column slug (the map VALUE). Sorted for stable,
 * reproducible output.
 *
 * Exported pure for unit testing.
 */
export function deriveStarterTargets(
  mapping: Readonly<Record<string, string>> = STARTER_TO_COLUMN,
): StarterTarget[] {
  return Object.keys(mapping)
    .sort()
    .map((slug) => ({
      slug,
      serviceName: `${STARTER_FLEET_PREFIX}${slug}`,
      image: `ghcr.io/copilotkit/${STARTER_FLEET_PREFIX}${slug}:latest`,
    }));
}

// ── GHCR registry credentials ───────────────────────────────────────────

export interface RegistryCredentials {
  username: string;
  password: string;
}

/**
 * Resolve GHCR registry credentials the same way deploy-to-railway.ts does:
 * GITHUB_TOKEN as the password, and GHCR_USERNAME (preferred) or GITHUB_ACTOR
 * (CI) as the username. Returns undefined when GITHUB_TOKEN is unset (caller
 * warns and proceeds without creds). THROWS when a token is present but no
 * username is available — fail loud rather than baking a personal handle in.
 *
 * Exported pure for unit testing.
 */
export function resolveRegistryCredentials(
  env: NodeJS.ProcessEnv = process.env,
): RegistryCredentials | undefined {
  const githubToken = env.GITHUB_TOKEN;
  if (!githubToken) return undefined;
  const ghcrUser = (env.GHCR_USERNAME || env.GITHUB_ACTOR || "").trim();
  if (!ghcrUser) {
    throw new Error(
      "GITHUB_TOKEN is set but no GHCR username is available. Set GHCR_USERNAME (or GITHUB_ACTOR in CI) to the username the token is issued to.",
    );
  }
  return { username: ghcrUser, password: githubToken };
}

// ── Injectable Railway GraphQL boundary ─────────────────────────────────

/** Minimal GraphQL caller signature — injected so the core is unit-testable. */
export type RailwayGqlFn = <T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
) => Promise<T>;

interface ProjectServicesResult {
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
                domains?: {
                  serviceDomains?: Array<{ domain: string }>;
                } | null;
              };
            }>;
          };
        };
      }>;
    };
  } | null;
}

interface ServiceCreateResult {
  serviceCreate: { id: string; name: string };
}

interface ServiceDomainResult {
  serviceDomainCreate: { domain: string };
}

/** Existing-service lookup result: id + whether it already has a staging domain. */
export interface ExistingService {
  id: string;
  hasStagingDomain: boolean;
}

/**
 * Fetch the project's services (with their staging-env domains) and index
 * them by name. Returns a map of serviceName -> ExistingService so the
 * provisioner can decide create-vs-update and skip redundant domain creation.
 *
 * Exported for unit testing against an injected RailwayGqlFn.
 */
export async function fetchExistingServices(
  gql: RailwayGqlFn,
  projectId: string,
  stagingEnvId: string,
): Promise<Map<string, ExistingService>> {
  const data = await gql<ProjectServicesResult>(
    `query project($id: String!) {
      project(id: $id) {
        services {
          edges { node {
            id
            name
            serviceInstances {
              edges { node {
                environmentId
                domains { serviceDomains { domain } }
              } }
            }
          } }
        }
      }
    }`,
    { id: projectId },
  );

  if (!data.project) {
    throw new Error(
      `Railway project ${projectId} returned null — check PROJECT_ID and that the Railway token has access to this project.`,
    );
  }

  const byName = new Map<string, ExistingService>();
  for (const edge of data.project.services.edges) {
    const svc = edge.node;
    const stagingInstance = svc.serviceInstances.edges.find(
      (e) => e.node.environmentId === stagingEnvId,
    );
    const hasStagingDomain =
      (stagingInstance?.node.domains?.serviceDomains?.length ?? 0) > 0;
    byName.set(svc.name, { id: svc.id, hasStagingDomain });
  }
  return byName;
}

export interface ProvisionOptions {
  gql: RailwayGqlFn;
  projectId: string;
  stagingEnvId: string;
  targets: StarterTarget[];
  registryCredentials?: RegistryCredentials;
  /** When true, no mutations are sent — plan only. */
  dryRun?: boolean;
  log?: (line: string) => void;
  /**
   * Sleep implementation between retries of the post-create
   * serviceInstanceUpdate / serviceDomainCreate (Railway materializes the
   * env-scoped instance asynchronously). Injected so tests don't actually
   * wait. Defaults to a real setTimeout-backed delay.
   */
  sleepMs?: (ms: number) => Promise<void>;
}

/** Default inter-retry delay schedule (ms). */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

/**
 * Retry a Railway mutation that can transiently fail with "ServiceInstance
 * not found" while the env-scoped instance is still materializing after
 * serviceCreate. Re-throws non-transient errors immediately and re-throws
 * the last transient error once the schedule is exhausted.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry the known eventual-consistency error.
      if (!/ServiceInstance not found/i.test(msg)) throw e;
      if (attempt === RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}

export interface ProvisionRecord {
  slug: string;
  serviceName: string;
  image: string;
  serviceId: string;
  action: "created" | "updated";
  domain?: string;
  domainAction: "created" | "existing" | "skipped";
}

export interface ProvisionSummary {
  records: ProvisionRecord[];
}

/**
 * The idempotent provisioning core. For each target:
 *   - create the service (source.image = GHCR ref) if it does not exist,
 *     otherwise reuse the existing service id (UPDATE path);
 *   - serviceInstanceUpdate against the STAGING env with
 *     sleepApplication: true + healthcheckPath + region + (optional) GHCR
 *     registryCredentials — applied on BOTH the create and update paths so a
 *     re-run converges drifted settings;
 *   - serviceDomainCreate for the staging env, but ONLY when the service has
 *     no staging domain yet (so re-runs don't pile up domains).
 *
 * Pure w.r.t. I/O: every Railway interaction goes through the injected `gql`.
 */
export async function provisionStarterFleet(
  opts: ProvisionOptions,
): Promise<ProvisionSummary> {
  const {
    gql,
    projectId,
    stagingEnvId,
    targets,
    registryCredentials,
    dryRun = false,
    log = () => {},
    sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  const existing = await fetchExistingServices(gql, projectId, stagingEnvId);
  const records: ProvisionRecord[] = [];

  for (const target of targets) {
    const prior = existing.get(target.serviceName);
    let serviceId: string;
    let action: "created" | "updated";

    if (prior) {
      serviceId = prior.id;
      action = "updated";
      log(`↻ ${target.serviceName} exists (${serviceId}) — updating`);
    } else if (dryRun) {
      serviceId = "<dry-run>";
      action = "created";
      log(`+ ${target.serviceName} would be created (${target.image})`);
    } else {
      // CRITICAL: pass `environmentId` so the new service instance is
      // scoped to STAGING only. Without it, Railway materializes the
      // instance in the project's DEFAULT (production) environment — which
      // would leak a prod instance for every starter. `registryCredentials`
      // is also supplied here so the staging instance can pull the private
      // GHCR image from birth (before the serviceInstanceUpdate below
      // re-asserts the rest of the config).
      const createInput: Record<string, unknown> = {
        projectId,
        environmentId: stagingEnvId,
        name: target.serviceName,
        source: { image: target.image },
      };
      if (registryCredentials) {
        createInput.registryCredentials = registryCredentials;
      }
      const created = await gql<ServiceCreateResult>(
        `mutation serviceCreate($input: ServiceCreateInput!) {
          serviceCreate(input: $input) { id name }
        }`,
        { input: createInput },
      );
      serviceId = created.serviceCreate.id;
      action = "created";
      log(`+ ${target.serviceName} created (${serviceId})`);
    }

    // Apply sleep + healthcheck + region (+ creds) against staging on BOTH
    // paths. The image source is also re-asserted on the update path so a
    // drifted existing service converges back to the canonical GHCR ref.
    const instanceInput: Record<string, unknown> = {
      source: { image: target.image },
      sleepApplication: true,
      healthcheckPath: STARTER_HEALTHCHECK_PATH,
      region: STARTER_REGION,
    };
    if (registryCredentials) {
      instanceInput.registryCredentials = registryCredentials;
    }

    if (!dryRun && serviceId !== "<dry-run>") {
      // Railway materializes the env-scoped serviceInstance asynchronously
      // after serviceCreate; a serviceInstanceUpdate issued too eagerly can
      // race it ("ServiceInstance not found"). Retry briefly so a fresh
      // create converges. Existing services (update path) hit this on the
      // first try.
      await withRetry(
        () =>
          gql(
            `mutation serviceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
              serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
            }`,
            {
              serviceId,
              environmentId: stagingEnvId,
              input: instanceInput,
            },
          ),
        sleepMs,
      );
      log(
        `  configured sleep=true, healthcheck=${STARTER_HEALTHCHECK_PATH}, region=${STARTER_REGION}${
          registryCredentials ? ", registry creds" : ""
        }`,
      );
    }

    // Domain: create only when none exists yet (idempotent).
    let domain: string | undefined;
    let domainAction: "created" | "existing" | "skipped";
    if (prior?.hasStagingDomain) {
      domainAction = "existing";
      log(`  staging domain already present — skipping create`);
    } else if (dryRun) {
      domainAction = "skipped";
    } else {
      const domainResult = await withRetry(
        () =>
          gql<ServiceDomainResult>(
            `mutation serviceDomainCreate($input: ServiceDomainCreateInput!) {
              serviceDomainCreate(input: $input) { domain }
            }`,
            {
              input: { serviceId, environmentId: stagingEnvId },
            },
          ),
        sleepMs,
      );
      domain = domainResult.serviceDomainCreate.domain;
      domainAction = "created";
      log(`  domain: https://${domain}`);
    }

    records.push({
      slug: target.slug,
      serviceName: target.serviceName,
      image: target.image,
      serviceId,
      action,
      domain,
      domainAction,
    });
  }

  return { records };
}

// ── Live GraphQL caller ─────────────────────────────────────────────────

let cachedToken: string | undefined;
function getToken(): string {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = resolveRailwayToken().token;
    return cachedToken;
  } catch (e) {
    if (e instanceof RailwayTokenError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}

function makeLiveGql(): RailwayGqlFn {
  return async function railwayGql<T = unknown>(
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
      const text = await res.text();
      throw new Error(`Railway API error: ${res.status} ${text}`);
    }
    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(
        `Railway GraphQL errors:\n${json.errors
          .map((e) => `  - ${e.message}`)
          .join("\n")}`,
      );
    }
    return json.data as T;
  };
}

// ── Subcommands ─────────────────────────────────────────────────────────

async function listStarterServices(gql: RailwayGqlFn): Promise<void> {
  const existing = await fetchExistingServices(gql, PROJECT_ID, STAGING_ENV_ID);
  const starters = [...existing.entries()]
    .filter(([name]) => name.startsWith(STARTER_FLEET_PREFIX))
    .sort(([a], [b]) => a.localeCompare(b));
  console.log(`Starter-fleet services in staging (${starters.length}):\n`);
  for (const [name, svc] of starters) {
    console.log(
      `  ${name.padEnd(40)} ${svc.id}  ${
        svc.hasStagingDomain ? "[domain]" : "[no domain]"
      }`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    console.log(`Usage:
  npx tsx showcase/scripts/provision-starter-fleet.ts            Provision all 12 starter-* services in staging
  npx tsx showcase/scripts/provision-starter-fleet.ts --list     List starter-* services in staging
  npx tsx showcase/scripts/provision-starter-fleet.ts --dry-run  Plan only (no mutations)
`);
    process.exit(0);
  }

  const gql = makeLiveGql();

  if (args.includes("--list")) {
    await listStarterServices(gql);
    return;
  }

  const dryRun = args.includes("--dry-run");
  const targets = deriveStarterTargets();

  let registryCredentials: RegistryCredentials | undefined;
  try {
    registryCredentials = resolveRegistryCredentials();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  if (!registryCredentials) {
    console.warn(
      "\n  WARNING: GITHUB_TOKEN not set. Registry credentials will NOT be configured — Railway cannot pull the private GHCR starter images until creds are added.\n",
    );
  }

  console.log(
    `Provisioning ${targets.length} sleepable starter-* services in STAGING (env ${STAGING_ENV_ID})${
      dryRun ? " [DRY RUN]" : ""
    }\n`,
  );

  const summary = await provisionStarterFleet({
    gql,
    projectId: PROJECT_ID,
    stagingEnvId: STAGING_ENV_ID,
    targets,
    registryCredentials,
    dryRun,
    log: (line) => console.log(line),
  });

  console.log(`\nDone. ${summary.records.length} services processed:\n`);
  for (const r of summary.records) {
    console.log(
      `  ${r.serviceName.padEnd(40)} ${r.serviceId}  (${r.action}${
        r.domain ? `, https://${r.domain}` : `, domain:${r.domainAction}`
      })`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
