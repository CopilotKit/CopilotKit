#!/usr/bin/env npx tsx
/**
 * provision-starter-fleet.ts — Committed, reproducible Railway provisioner
 * for the "starter container fleet" in the showcase STAGING environment.
 *
 * Creates (or idempotently updates) one always-on Railway service per
 * starter template, pulling the per-starter image from GHCR:
 *
 *   service name : starter-<slug>          (RAW starter slug, e.g.
 *                                            starter-langgraph-js, NOT the
 *                                            remapped dashboard column slug)
 *   image        : ghcr.io/copilotkit/starter-<slug>:latest
 *   env          : STAGING ONLY (railway-envs STAGING_ENV_ID)
 *   sleep        : sleepApplication = false (always-on, so the starters are
 *                  staging-probed like every other managed showcase service)
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
 * showcase/harness/src/probes/helpers/starter-mapping.ts. That list is NOT
 * literally shared with the smoke matrix (showcase/tests/e2e/starter-smoke.spec.ts)
 * or the CI build matrix (.github/workflows/showcase_build.yml) — those are
 * INDEPENDENT lists. The drift test
 * (showcase/harness/src/probes/helpers/starter-mapping-drift.test.ts) keeps
 * STARTER_TO_COLUMN in lockstep with the smoke matrix + the on-disk column set
 * ONLY (it does NOT check showcase_build.yml — the CI build matrix is independent
 * and not covered by that test). This script derives its target list from
 * STARTER_TO_COLUMN, so the drift-synced map keeps the fleet aligned with the
 * smoke/column set.
 *
 * SSOT relationship (S2): the 12 starter-<slug> services are now FULL
 * railway-envs SSOT entries (SERVICES in showcase/scripts/railway-envs.ts),
 * gateValidated + ciBuilt exactly like a showcase-* agent. This script is NOT
 * a competing source of truth: it is the STAGING PROVISIONER, deriving its 12
 * targets from STARTER_TO_COLUMN (the canonical starter-slug map; the smoke
 * matrix and CI build matrix are INDEPENDENT lists, per the note above). The railway-envs SSOT owns the
 * image-ref gate + the cluster-promote closure (prod @sha256 pinning); this
 * script owns idempotent staging service creation. They are complementary, not
 * double-managing — the slug set is the single shared input, so they cannot
 * drift. The starter_smoke probe still auto-discovers starter-* services at
 * runtime (railway-services source, namePrefix "starter-") for verification.
 *
 * NOTE: prod pinning + image-ref drift for starters is handled by the
 * railway-envs gate (verify-railway-image-refs.ts) and bin/railway lint-prod,
 * NOT by this staging-only provisioner.
 *
 * IDEMPOTENT: a starter-* service that already exists in staging is UPDATED
 * (instance settings re-applied; a domain created only if none exists, and an
 * "already exists" rejection on re-create is absorbed as a no-op) rather than
 * duplicated or errored. The pinned image is always (re)deployed via
 * serviceInstanceRedeploy so it actually runs — serviceInstanceUpdate alone
 * only pins the image ref.
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
          // A transitional service can return a null serviceInstances
          // connection (or null .edges) — both fields are optional/nullable
          // so the drain loop can coalesce instead of throwing a TypeError
          // that would abort the entire fetch.
          serviceInstances?: {
            edges?: Array<{
              node: {
                environmentId: string;
                domains?: {
                  serviceDomains?: Array<{ domain: string }>;
                } | null;
              };
            }> | null;
          } | null;
        };
      }>;
      pageInfo?: {
        hasNextPage: boolean;
        endCursor?: string | null;
      } | null;
    };
  } | null;
}

interface ServiceCreateResult {
  serviceCreate: { id: string; name: string };
}

interface ServiceDomainResult {
  serviceDomainCreate: { domain: string };
}

/**
 * `serviceInstanceRedeploy` returns a Boolean! in Railway's schema — `true`
 * once the redeploy is enqueued. VERIFIED against the two in-repo consumers
 * that read this mutation's result:
 *   - showcase/scripts/redeploy-env.ts types it `serviceInstanceRedeploy?:
 *     boolean` and gates on `!== true`;
 *   - showcase/bin/railway (RestoreCommand P5) requires
 *     `redeployed["serviceInstanceRedeploy"]` truthy.
 * Both treat it as a bare boolean, and bin/railway's REDEPLOY_MUTATION selects
 * NO subfields on the result (confirming a scalar, not an object/deployment).
 */
interface ServiceInstanceRedeployResult {
  serviceInstanceRedeploy: boolean | null;
}

/**
 * `serviceInstanceUpdate` returns a Boolean! in Railway's schema — `true`
 * once the instance config (sleepApplication / healthcheck / image / region /
 * registryCredentials) is applied. Same precedent as serviceInstanceRedeploy
 * (redeploy-env.ts / bin/railway treat the scalar as a bare boolean). A
 * `false`/`null` return means the config was NOT applied — e.g. the service
 * would run WITHOUT the intended always-on/healthcheck config — so it must be
 * asserted, never discarded.
 */
interface ServiceInstanceUpdateResult {
  serviceInstanceUpdate: boolean | null;
}

/**
 * Uniform Railway-mutation-result guard: a single chokepoint so no mutation's
 * result can be silently discarded (the "mutation result not validated" defect
 * class). `ok` extracts the meaningful field from the result; when it is
 * falsy (empty string, false, null, undefined) we throw, naming the mutation
 * and service so the failure is forensic rather than a silent success.
 *
 * Returns the (now-verified) result for fluent use at the call site.
 */
function assertMutationOk<T>(
  result: T,
  ok: (r: T) => unknown,
  mutation: string,
  serviceName: string,
  serviceId: string,
  note = "mutation did not take effect; refusing to report success.",
): T {
  const value = ok(result);
  if (!value) {
    throw new Error(
      `${mutation} returned ${JSON.stringify(
        value,
      )} for ${serviceName} (${serviceId}) — ${note}`,
    );
  }
  return result;
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
  const byName = new Map<string, ExistingService>();
  // `project.services` is a Relay ServiceConnection that PAGE-LIMITS. The
  // showcase project holds ~27 SSOT + 12 starter services, comfortably more
  // than one page. A single un-paginated query returns a TRUNCATED snapshot —
  // a starter that lands on a later page then looks ABSENT, the provisioner
  // takes the CREATE path, and serviceCreate rejects with a non-transient
  // "already exists" (NOT retried) which ABORTS the whole run. So drain every
  // page via `pageInfo.hasNextPage`/`endCursor` (standard Relay cursor loop —
  // bin/railway's SERVICES_LIST_QUERY predates this hazard and is unpaginated,
  // so there is no in-repo precedent to mirror), accumulating into byName.
  let after: string | null = null;
  // Defensive upper bound so a malformed `pageInfo` (always hasNextPage with a
  // stuck cursor) can't spin forever — far above any realistic project size.
  for (let page = 0; page < 1000; page++) {
    const data: ProjectServicesResult = await gql<ProjectServicesResult>(
      `query project($id: String!, $after: String) {
        project(id: $id) {
          services(first: 100, after: $after) {
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
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: projectId, after },
    );

    if (!data.project) {
      throw new Error(
        `Railway project ${projectId} returned null — check PROJECT_ID and that the Railway token has access to this project.`,
      );
    }

    for (const edge of data.project.services.edges) {
      const svc = edge.node;
      // A transitional service can surface a null serviceInstances connection
      // (or null .edges); coalesce so an unguarded `.find` can't throw a
      // TypeError that aborts the entire fetch before any starter is touched.
      const stagingInstance = (svc.serviceInstances?.edges ?? []).find(
        (e) => e.node.environmentId === stagingEnvId,
      );
      const hasStagingDomain =
        (stagingInstance?.node.domains?.serviceDomains?.length ?? 0) > 0;
      byName.set(svc.name, { id: svc.id, hasStagingDomain });
    }

    const pageInfo = data.project.services.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) {
      return byName;
    }
    after = pageInfo.endCursor;
  }
  // Reaching the defensive page bound while pageInfo.hasNextPage is STILL true
  // means the snapshot is TRUNCATED — services on undrained pages look absent,
  // which would feed erroneous CREATE decisions (and a non-transient "already
  // exists" abort). Refuse to provision against a partial snapshot: fail loud
  // rather than return the truncated map.
  throw new Error(
    `fetchExistingServices drained ${byName.size} services across the page bound but Railway still reports more pages (hasNextPage) — refusing to provision against a truncated service snapshot.`,
  );
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
 * The Railway eventual-consistency error classes that warrant a retry: the
 * env-scoped serviceInstance is materialized asynchronously after
 * serviceCreate, so both serviceInstanceUpdate AND serviceDomainCreate /
 * serviceInstanceRedeploy issued too eagerly can race it. The instance is
 * surfaced either as "ServiceInstance not found" or (for the domain create)
 * as a generic "Service ... not found" while the instance is still settling.
 * NOTE: an "already exists" domain error is NON-transient and is handled
 * separately (caught as a benign no-op) — it must NOT match here.
 *
 * Railway INTERPOLATES the service id into the second form — the real message
 * is "Service <id> not found" (e.g. "Service abc-123 not found"), NOT the
 * contiguous "Service not found". So the pattern matches "Service" followed by
 * "not found" with the id in between; the `(Instance)?` alternation still
 * covers the literal "ServiceInstance not found" form. The bridge is `[^\n]*?`
 * (NOT `[\s\S]*?`) — the interpolated id never contains a newline, so keeping
 * the match SINGLE-LINE prevents a multi-error newline-joined GraphQL blob
 * from bridging an unrelated "Service ..." line to a "... not found" line and
 * mis-classifying a non-transient failure as the eventual-consistency signal.
 */
const TRANSIENT_ERROR_RE = /Service(Instance)?\b[^\n]*?not found/i;

/**
 * Retry a Railway mutation that can transiently fail while the env-scoped
 * instance is still materializing after serviceCreate. Re-throws
 * non-transient errors immediately and re-throws the last transient error
 * once the schedule is exhausted. The transient predicate is overridable
 * per-call so callers with a different eventual-consistency signature can
 * supply their own.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  isTransient: (msg: string) => boolean = (msg) => TRANSIENT_ERROR_RE.test(msg),
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Only retry the known eventual-consistency errors.
      if (!isTransient(msg)) throw e;
      if (attempt === RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  // Schedule exhausted on a transient error: wrap the rethrow with context
  // (how many retries, that it was transient) so the operator sees WHY the
  // run failed, preserving the original error as `cause`.
  const lastMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `Exhausted ${RETRY_DELAYS_MS.length} retries for transient Railway error: ${lastMsg}`,
    { cause: lastErr },
  );
}

/**
 * An "already exists"-class rejection. Two call sites converge on it rather
 * than abort, on a partial-failure re-run (the start-of-run snapshot missed
 * the resource due to Railway eventual consistency, or a prior run died
 * mid-fleet):
 *   - serviceDomainCreate: treat as the domain already existing (benign no-op);
 *   - serviceCreate: re-fetch the now-visible service by name and fall through
 *     to the UPDATE path instead of aborting the whole fleet.
 * This is NOT a transient/retryable error — matching it in the retry predicate
 * would waste the retry schedule on a permanent condition.
 */
const ALREADY_EXISTS_RE = /(already\s+exists|duplicate)/i;

export interface ProvisionRecord {
  slug: string;
  serviceName: string;
  image: string;
  serviceId: string;
  action: "created" | "updated";
  domain?: string;
  domainAction: "created" | "existing" | "skipped" | "would-create";
}

export interface ProvisionSummary {
  records: ProvisionRecord[];
}

/**
 * The idempotent provisioning core. For each target:
 *   - create the service (source.image = GHCR ref) if it does not exist,
 *     otherwise reuse the existing service id (UPDATE path);
 *   - serviceInstanceUpdate against the STAGING env with
 *     sleepApplication: false + healthcheckPath + region + (optional) GHCR
 *     registryCredentials — applied on BOTH the create and update paths so a
 *     re-run converges drifted settings;
 *   - serviceInstanceRedeploy so the pinned image ACTUALLY RUNS. A
 *     serviceCreate + serviceInstanceUpdate(source.image) only pins the image
 *     ref; it does NOT start a deployment. Railway's image auto-updates fire
 *     only when a NEW digest is pushed to the tag, so a freshly-provisioned
 *     service whose :latest digest already exists would sit with no running
 *     deployment (and the starter_smoke probe would never find it up) without
 *     this explicit redeploy. This mirrors the documented update+redeploy
 *     pattern in bin/railway (RestoreCommand / pin_and_verify) and the
 *     explicit serviceInstanceRedeploy that showcase_deploy.yml issues after
 *     every GHCR push (see showcase/RAILWAY.md). The update path re-asserts
 *     source.image too, so it also redeploys to run the (re-)pinned image.
 *   - serviceDomainCreate for the staging env, but ONLY when the service has
 *     no staging domain yet (so re-runs don't pile up domains). A
 *     serviceDomainCreate that rejects with an "already exists" error (the
 *     snapshot missed the domain due to eventual consistency, or a prior run
 *     died mid-fleet) is caught as a benign no-op so the re-run converges
 *     instead of aborting the remaining fleet.
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
      try {
        const created = await gql<ServiceCreateResult>(
          `mutation serviceCreate($input: ServiceCreateInput!) {
            serviceCreate(input: $input) { id name }
          }`,
          { input: createInput },
        );
        assertMutationOk(
          created,
          (r) => r.serviceCreate?.id,
          "serviceCreate",
          target.serviceName,
          "<creating>",
        );
        serviceId = created.serviceCreate.id;
        action = "created";
        log(`+ ${target.serviceName} created (${serviceId})`);
      } catch (e) {
        // A snapshot-miss (Railway eventual consistency) can make a service
        // look absent → CREATE path → a non-transient "already exists"
        // rejection. That must NOT abort the whole fleet: re-fetch the now-
        // visible service id by name and fall through to the UPDATE path so
        // the run converges. Any other error still fails loud.
        const msg = e instanceof Error ? e.message : String(e);
        if (!ALREADY_EXISTS_RE.test(msg)) throw e;
        const refetched = await fetchExistingServices(
          gql,
          projectId,
          stagingEnvId,
        );
        const found = refetched.get(target.serviceName);
        if (!found) {
          // The create said "already exists" but a re-fetch can't find it —
          // genuinely inconsistent; fail loud rather than guess.
          throw new Error(
            `serviceCreate for ${target.serviceName} rejected as already-existing, but a re-fetch could not find it by name — refusing to proceed against an inconsistent snapshot.`,
            { cause: e },
          );
        }
        serviceId = found.id;
        action = "updated";
        log(
          `↻ ${target.serviceName} already exists (re-fetched ${serviceId}) — updating: ${msg}`,
        );
      }
    }

    // Apply sleep + healthcheck + region (+ creds) against staging on BOTH
    // paths. The image source is also re-asserted on the update path so a
    // drifted existing service converges back to the canonical GHCR ref.
    const instanceInput: Record<string, unknown> = {
      source: { image: target.image },
      sleepApplication: false,
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
      const updated = await withRetry(
        () =>
          gql<ServiceInstanceUpdateResult>(
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
      // serviceInstanceUpdate returns Boolean! — a `false`/`null` return means
      // sleepApplication/healthcheck/image/creds were NOT applied (the service
      // would run WITHOUT the intended always-on/healthcheck config) while the
      // script reports success. Assert the result and only log "configured ..."
      // AFTER it is verified.
      assertMutationOk(
        updated,
        (r) => r.serviceInstanceUpdate,
        "serviceInstanceUpdate",
        target.serviceName,
        serviceId,
      );
      log(
        `  configured sleep=false, healthcheck=${STARTER_HEALTHCHECK_PATH}, region=${STARTER_REGION}${
          registryCredentials ? ", registry creds" : ""
        }`,
      );

      // Redeploy so the pinned image ACTUALLY RUNS. serviceInstanceUpdate
      // only pins source.image; without this the service has no running
      // deployment and starter_smoke would never find it up. Wrapped in
      // withRetry for the same instance-materialization race as the update.
      const redeployed = await withRetry(
        () =>
          gql<ServiceInstanceRedeployResult>(
            `mutation serviceInstanceRedeploy($serviceId: String!, $environmentId: String!) {
              serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
            }`,
            { serviceId, environmentId: stagingEnvId },
          ),
        sleepMs,
      );
      // serviceInstanceRedeploy returns Boolean! (see the result-type comment
      // for the verified contract + sources). A `false`/`null` return means
      // Railway did NOT enqueue a deployment, so the image would never run —
      // fail loud rather than report success. Routed through the same uniform
      // mutation-result guard as serviceCreate / serviceInstanceUpdate; any
      // truthy value is accepted defensively in case the contract ever widens.
      assertMutationOk(
        redeployed,
        (r) => r.serviceInstanceRedeploy,
        "serviceInstanceRedeploy",
        target.serviceName,
        serviceId,
        "image will not run.",
      );
      log(`  redeployed — image now running`);
    }

    // Domain: create only when none exists yet (idempotent).
    let domain: string | undefined;
    let domainAction: "created" | "existing" | "skipped" | "would-create";
    if (prior?.hasStagingDomain) {
      domainAction = "existing";
      log(`  staging domain already present — skipping create`);
    } else if (dryRun) {
      // Faithful preview: a real run WOULD create a domain here (the service
      // has none yet), so report "would-create" rather than the misleading
      // "skipped".
      domainAction = "would-create";
      log(`  domain: would create (none present)`);
    } else {
      try {
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
        // Assert the create actually yielded a domain — a null/empty domain
        // is a silent-success the script must not report as created.
        assertMutationOk(
          domainResult,
          (r) => r.serviceDomainCreate?.domain,
          "serviceDomainCreate",
          target.serviceName,
          serviceId,
        );
        domain = domainResult.serviceDomainCreate.domain;
        domainAction = "created";
        log(`  domain: https://${domain}`);
      } catch (e) {
        // Idempotent convergence on a partial-failure re-run: if the domain
        // already exists (the start-of-run snapshot missed it, or a prior run
        // died mid-fleet), Railway rejects the create with a non-transient
        // "already exists" error. That is benign — treat it as existing and
        // KEEP GOING rather than aborting the remaining fleet. Any other
        // error still aborts (fail loud).
        const msg = e instanceof Error ? e.message : String(e);
        if (!ALREADY_EXISTS_RE.test(msg)) throw e;
        domainAction = "existing";
        // Include the ACTUAL matched Railway message for a forensic trail —
        // so a re-run log shows exactly which "already exists" wording was
        // absorbed, not just a generic note.
        log(
          `  staging domain already exists (per Railway) — treating as no-op: ${msg}`,
        );
      }
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

/**
 * Resolve the Railway token, normalizing the typed RailwayTokenError into a
 * plain Error so main().catch owns the process exit (rather than a deep
 * process.exit(1) inside the GraphQL boundary). main() validates this UP
 * FRONT — before any provisioning — so a missing token fails fast instead of
 * mid-mutation.
 */
function resolveTokenOrThrow(): string {
  try {
    return resolveRailwayToken().token;
  } catch (e) {
    if (e instanceof RailwayTokenError) {
      throw new Error(e.message, { cause: e });
    }
    throw e;
  }
}

/** Build a live GraphQL caller bound to a single, already-resolved token. */
function makeLiveGql(token: string): RailwayGqlFn {
  return async function railwayGql<T = unknown>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
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

const USAGE = `Usage:
  npx tsx showcase/scripts/provision-starter-fleet.ts            Provision all 12 starter-* services in staging
  npx tsx showcase/scripts/provision-starter-fleet.ts --list     List starter-* services in staging
  npx tsx showcase/scripts/provision-starter-fleet.ts --dry-run  Plan only (no mutations)
`;

export interface ParsedArgs {
  help: boolean;
  list: boolean;
  dryRun: boolean;
}

/** The flags this script recognizes. */
const KNOWN_FLAGS = new Set(["--help", "--list", "--dry-run"]);

/**
 * Parse argv into the recognized flags, REJECTING any unrecognized argument.
 * Without this, a mistyped flag (e.g. `--dry-rn`) is silently ignored and —
 * because dryRun stays false — the script proceeds to REAL live provisioning,
 * the exact opposite of the operator's intent. Throws on any unknown arg so
 * main().catch aborts before any mutation.
 *
 * Exported pure for unit testing.
 */
export function parseArgs(args: string[]): ParsedArgs {
  for (const arg of args) {
    if (!KNOWN_FLAGS.has(arg)) {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  return {
    help: args.includes("--help"),
    list: args.includes("--list"),
    dryRun: args.includes("--dry-run"),
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  // Validate the Railway token UP FRONT — before any provisioning — so a
  // missing/unreadable token fails fast (and main().catch owns the exit)
  // rather than blowing up mid-mutation on the first GraphQL call.
  const token = resolveTokenOrThrow();
  const gql = makeLiveGql(token);

  if (parsed.list) {
    await listStarterServices(gql);
    return;
  }

  const dryRun = parsed.dryRun;
  const targets = deriveStarterTargets();

  // Validate registry credentials UP FRONT too (mirrors the existing
  // resolveRegistryCredentials validation) so a token-without-username
  // misconfig fails before any mutation. The throw propagates to
  // main().catch — no deep process.exit here.
  const registryCredentials = resolveRegistryCredentials();
  if (!registryCredentials) {
    if (dryRun) {
      console.warn(
        "\n  WARNING: GITHUB_TOKEN not set. Registry credentials will NOT be configured — Railway cannot pull the private GHCR starter images until creds are added.\n",
      );
    } else {
      // ABORT on the LIVE path: creating services that point at a PRIVATE
      // GHCR image with no pull credentials yields a perpetual
      // image-pull-backoff while the script reports "success". That is worse
      // than failing — fail loud up front. warn-and-continue is only
      // tolerable under --dry-run, where no service is actually created.
      throw new Error(
        "GITHUB_TOKEN is not set. The starter images are PRIVATE GHCR images; provisioning live services without registry credentials would leave every service in image-pull-backoff while reporting success. Set GITHUB_TOKEN (+ GHCR_USERNAME / GITHUB_ACTOR) and re-run, or use --dry-run to plan without mutations.",
      );
    }
  }

  console.log(
    `Provisioning ${targets.length} always-on starter-* services in STAGING (env ${STAGING_ENV_ID})${
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
