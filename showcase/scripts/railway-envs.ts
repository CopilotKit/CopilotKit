/**
 * railway-envs.ts — Single source of truth for Railway IDs used by all
 * TypeScript showcase tooling. Only the PROJECT_ID and the two env IDs
 * (PRODUCTION_ENV_ID / STAGING_ENV_ID) are also hardcoded in
 * `showcase/bin/railway` (Ruby) — if those three drift, prefer this file
 * and reconcile bin/railway by hand. Per-service data is NOT mirrored by
 * hand: the Ruby side consumes it via `railway-envs.generated.json`
 * (see ServiceEntry.legacyJsonCompat).
 *
 * - PROJECT_ID is the CopilotKit Showcase Railway project.
 * - ENV_IDS maps human env names (and common synonyms) to Railway env IDs.
 *   (bin/railway's Ruby ENV_IDS additionally accepts the "stage" spelling —
 *   a Ruby-side-only synonym not mirrored here; add it to BOTH registries'
 *   tooling deliberately if the divergence ever needs reconciling.)
 * - SERVICES is the per-service map of serviceId + a per-env `environments`
 *   record. Each environment carries its own serviceInstance ID, public
 *   domain (optional — domainless workers omit it), probe flag (optional,
 *   defaults true), and GHCR repo-name override (optional).
 *
 * Service-instance IDs are env-scoped, so prod and staging IDs differ for
 * the same service. Use instanceIdFor(serviceName, env) to get the right one.
 *
 * SCHEMA (Option C — unified env map): a service's per-env data lives under
 * `environments[envName]`, keyed by the SAME env names the rest of the
 * tooling uses ("prod" / "staging"). A service that exists in only one env
 * (e.g. a staging-only worker) simply omits the other key — there is no
 * placeholder ID. The single env-independent `probeDriver` is hoisted to the
 * entry (it never differed per env). `EnvName` is an OPEN string so future
 * env names (preview, canary, …) need only a registry entry, not a type
 * widening — accessors resolve any registered env name.
 */

export const PROJECT_ID = "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479";

export const PRODUCTION_ENV_ID = "b14919f4-6417-429f-848d-c6ae2201e04f";
export const STAGING_ENV_ID = "8edfef02-ea09-4a20-8689-261f21cc2849";

/**
 * Env name. OPEN string (not a closed union) so the SSOT can grow new env
 * names without a type change; the per-env-id registry below is what makes
 * an env name resolvable. Today the only populated env names are "prod" and
 * "staging", but accessors index `environments[env]` generically.
 */
export type EnvName = string;

// Accept common synonyms ("production", "prod", "staging") and normalize.
export const ENV_IDS: Record<string, string> = {
  prod: PRODUCTION_ENV_ID,
  production: PRODUCTION_ENV_ID,
  staging: STAGING_ENV_ID,
};

/**
 * Canonical env-name → Railway env-id registry. Keyed by the env names used
 * as `environments` keys (NOT the synonyms). This is the contract for
 * turning an arbitrary registered env name into its Railway env id — the
 * redeploy path resolves env ids through it. Extend this (and add the
 * env to a service's `environments`) to introduce a new env name.
 */
export const ENV_ID_BY_NAME: Record<string, string> = {
  prod: PRODUCTION_ENV_ID,
  staging: STAGING_ENV_ID,
};

/**
 * Resolve a human-supplied env spelling (case-insensitive, whitespace
 * tolerated) to the canonical `{ env, envId }` pair.
 *
 * Derived ENTIRELY from the two registries above so there is ONE authority
 * for env names: ENV_IDS supplies the accepted spellings (synonyms), and
 * the canonical name is whichever ENV_ID_BY_NAME key carries the same
 * env-id. Registering a new env (a canonical entry in ENV_ID_BY_NAME plus
 * at least its own spelling in ENV_IDS) makes it resolvable here with no
 * code change — the open-env contract.
 *
 * THROWS on an unknown spelling, and THROWS on a mis-wired registry (an
 * ENV_IDS spelling whose env-id has no canonical ENV_ID_BY_NAME name).
 */
export function resolveEnv(name: string): { env: EnvName; envId: string } {
  const lower = name.trim().toLowerCase();
  // Own-key lookup: a bare `ENV_IDS[lower]` truthiness check would resolve
  // inherited Object.prototype keys (e.g. "constructor") to truthy non-IDs.
  if (!Object.hasOwn(ENV_IDS, lower)) {
    throw new Error(
      `Unknown env "${name}". Use one of: ${Object.keys(ENV_IDS).join(", ")}.`,
    );
  }
  const envId = ENV_IDS[lower];
  // Canonical name = the ENV_ID_BY_NAME key carrying this env-id. Computed
  // per call (the registry is tiny) so a runtime-registered env resolves
  // without a rebuild step.
  const env = Object.keys(ENV_ID_BY_NAME).find(
    (n) => ENV_ID_BY_NAME[n] === envId,
  );
  if (env === undefined) {
    throw new Error(
      `Env spelling "${lower}" (ENV_IDS) maps to env-id "${envId}", which has no canonical name in ENV_ID_BY_NAME — register the canonical env name there.`,
    );
  }
  return { env, envId };
}

/**
 * The probe driver selects which feature-level verifier `verify-deploy.ts`
 * runs against a service's URL. "200 ≠ healthy": every driver does more
 * than a naked GET. See showcase/scripts/verify-deploy.ts for the per-driver
 * implementation; the SSOT only names the driver here.
 *
 * - "shell" / "docs" / "dashboard" / "dojo" — Next.js shells: load the page
 *   and assert a known DOM string plus a known network call.
 * - "harness" / "eval" — synthetic e2e fixture against the service's API.
 * - "aimock" — fixture replay with deterministic-response drift check.
 * - "pocketbase" — admin login + known collection list.
 * - "webhooks" — synthetic event POST and downstream confirmation.
 * - "agent" — generic agent backend (the showcase-* integration services);
 *   feature-level fixture call into the integration's /api endpoint.
 * - "starter" — the starter-template container fleet (`starter-<slug>`).
 *   Verified by the verify-deploy baseline driver (deployment-SUCCESS +
 *   HTTP 200 on `/`) in `verify-deploy.drivers.starter.ts`, exactly like the
 *   Next.js shells — the starters EXPOSE only their Next.js frontend (serving
 *   `/` + `/api/copilotkit`, NO `/api/health`), so `/` is the only correct
 *   healthcheck. Starters are always-on + staging-probed, so they enter the
 *   verify-deploy staging matrix like every other managed showcase service.
 *   (They are ALSO covered by the harness `starter_smoke` axis — railway-
 *   services source, namePrefix "starter-", writing `starter:<column-slug>/
 *   <level>` rows — which is orthogonal to the baseline liveness probe here.)
 */
export type ProbeDriver =
  | "shell"
  | "harness"
  | "eval"
  | "aimock"
  | "pocketbase"
  | "webhooks"
  | "dojo"
  | "docs"
  | "dashboard"
  | "agent"
  | "starter";

/**
 * Provisioning configuration for the `harness-workers` pool fleet. Carried on
 * `ServiceEntry.workerProvisioning` and ONLY populated for `harness-workers`.
 *
 * The worker model is strictly 1-worker-per-replica: Railway runs ONE worker
 * process per replica container (keyed on HOSTNAME), so the REAL live worker
 * count equals the EFFECTIVE replica count. `HARNESS_POOL_COUNT` is the
 * control-plane's informational "expected worker count" hint — it does NOT fork
 * additional workers per replica and MUST NOT be treated as a multiplier or fork
 * factor. The authoritative concurrency knob per worker is
 * `BROWSER_POOL_MAX_CONTEXTS`.
 *
 * EFFECTIVE REPLICA COUNT — `multiRegionConfig.<region>.numReplicas`, NOT the
 * top-level `numReplicas`. The harness-workers service is single-region
 * (us-west2), and Railway derives the LIVE running replica count from the
 * per-region `multiRegionConfig.us-west2.numReplicas` field. The top-level
 * `numReplicas` is the legacy/aggregate knob; on a multiRegion service it is
 * Railway-maintained to mirror the region sum but it is NOT the field the
 * deploy honors. The SSOT therefore models `multiRegionConfig.us-west2.
 * numReplicas` as the authoritative `effectiveReplicas` and keeps the
 * top-level `numReplicas` only as a documented mirror. Verified live
 * 2026-06-26 via the Railway GraphQL `environment.config` staged-config read:
 * BOTH envs carry `deploy.multiRegionConfig = {"us-west2":{"numReplicas":6}}`.
 *
 * This is a DECLARE-AND-VERIFY record. The tooling (`emit-railway-envs-json.ts`,
 * `bin/railway`) is VERIFY-ONLY with respect to the replica count — it does not
 * write replica counts to Railway. Applying a replica-count change is a MANUAL
 * operation (Railway Dashboard > Service > Settings > Replicas, which edits the
 * per-region `multiRegionConfig.us-west2.numReplicas`, or the Railway GraphQL
 * API). See `showcase/RAILWAY.md` for the manual procedure.
 */
export interface WorkerProvisioning {
  /**
   * EFFECTIVE replica count — the AUTHORITATIVE worker-count field. This is the
   * `multiRegionConfig.us-west2.numReplicas` value Railway actually uses to
   * derive the LIVE running replica count for this single-region (us-west2)
   * service. The drift gate watches THIS field because it is the one that
   * drives reality; the top-level `numReplicas` mirror below does NOT (Railway
   * keeps it in sync as an aggregate, but the deploy honors the per-region
   * config). Strictly 1:1 with live worker processes — each replica runs
   * exactly ONE worker process (keyed on HOSTNAME). `HARNESS_POOL_COUNT` is
   * informational only.
   */
  effectiveReplicas: number;
  /**
   * Top-level Railway `numReplicas` field for this env. Retained as a
   * DOCUMENTED MIRROR of `effectiveReplicas` (Railway keeps it equal to the
   * region sum on a multiRegion service), NOT as an authoritative knob — the
   * deploy honors `multiRegionConfig.<region>.numReplicas` (`effectiveReplicas`).
   * Kept here so the SSOT records both and makes the effective-vs-mirror
   * distinction explicit. For harness-workers (single region) it always equals
   * `effectiveReplicas`.
   */
  numReplicas: number;
  /**
   * Per-worker in-process concurrency budget: the `BROWSER_POOL_MAX_CONTEXTS`
   * env var that caps how many Playwright browser contexts each worker may hold
   * open simultaneously. NOT a per-fleet total; the fleet-wide budget is
   * `effectiveReplicas × BROWSER_POOL_MAX_CONTEXTS`.
   */
  BROWSER_POOL_MAX_CONTEXTS: number;
  /**
   * INFORMATIONAL ONLY — the `HARNESS_POOL_COUNT` env var forwarded to each
   * worker as a control-plane "expected worker count" hint. The worker code
   * does NOT fork additional processes per pool count; it runs exactly one
   * process per replica. The authoritative concurrency knob is
   * `BROWSER_POOL_MAX_CONTEXTS`. This field is recorded here purely for
   * operational visibility / config-audit purposes.
   */
  HARNESS_POOL_COUNT?: number;
  /**
   * DEPLOY-ROLLOVER CAPACITY FLOOR (seconds) — the Railway
   * `serviceInstance.overlapSeconds` setting (env mirror
   * `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`). Railway keeps the OLD deployment
   * serving for this many seconds after the NEW deployment goes Active, so the
   * live worker count never dips during a rollover (no staleness dip while new
   * workers boot, register on the roster, and start claiming). This is PURE
   * RAILWAY CONFIG — there is no custom rolling-restart code; the mechanism is
   * the service setting alone. Composes with the layer-(b) graceful drain
   * (`DEFAULT_WORKER_DRAIN_GRACE_MS`) and the layer-(a) reaper backstop. See
   * `showcase/RAILWAY.md` "Deploy rollover" for the rationale and how to apply
   * it (GraphQL `serviceInstanceUpdate` / dashboard). DECLARE-AND-VERIFY: the
   * tooling is verify-only with respect to this field; applying it is a manual
   * Railway operation.
   */
  overlapSeconds?: number;
  /**
   * GRACEFUL-DRAIN WINDOW (seconds) — the Railway
   * `serviceInstance.drainingSeconds` setting (env mirror
   * `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`): the SIGTERM→SIGKILL window the
   * platform grants a draining worker before hard-killing it. Sized to HOST the
   * shipped composed worker-drain budget (layer b): the 3s deregister cap
   * (`DRAIN_DEREGISTER_TIMEOUT_MS`) + the 90s finish-and-report grace
   * (`DEFAULT_WORKER_DRAIN_GRACE_MS`) + the small serial teardown remainder, all
   * of which must fit under `PLATFORM_STOP_GRACE_MS` (180s). Keeping this ≥
   * `PLATFORM_STOP_GRACE_MS` lets a worker finish and report its in-flight cell
   * before the kill instead of having the drain cut short. PURE RAILWAY CONFIG
   * (no custom code). See `showcase/RAILWAY.md` "Deploy rollover" + the
   * `PLATFORM_STOP_GRACE_MS` doc in `worker-loop.ts` (the C3 requirement). If the
   * layer-(b) grace is retuned, raise this in lockstep.
   */
  drainingSeconds?: number;
}

/**
 * Per-env configuration for a service. One of these lives under each key of
 * `ServiceEntry.environments`. A service that exists in only one env has a
 * single key here (no placeholder for the missing env).
 *
 * - `instanceId` — the env-scoped Railway serviceInstance ID. Always set.
 * - `domain` — public host (no scheme) for this env. OPTIONAL: domainless
 *   workers (queue consumers with no HTTP surface) omit it. `domainFor`
 *   throws when asked for a missing domain so the verify probe fails loud
 *   rather than silently probing "".
 * - `probe` — whether `verify-deploy --env <env>` probes this service in
 *   this env. OPTIONAL; defaults to `true` (the historic default for every
 *   service that exists in an env). Domainless workers set `probe: false`.
 * - `repoName` — GHCR repo-name override for this env. OPTIONAL. When unset,
 *   the gate expects `ghcr.io/copilotkit/<serviceName>:<tag>`; when set, it
 *   uses `ghcr.io/copilotkit/<repoName>:<tag>` for THIS env only.
 * - `healthcheckPath` — Railway HTTP healthcheck path for this env (the path
 *   Railway probes to mark a deploy healthy). OPTIONAL; OMITTED ⇒ "do not
 *   assert" (Railway default / null — TCP-port liveness, no HTTP path). This
 *   is the SSOT the promote pin re-asserts on every promote so a prod
 *   instance whose healthcheckPath silently went null (the aimock incident)
 *   self-heals to the tracked value. MUST encode the LIVE Railway value
 *   verbatim per env — a wrong path 404s and WEDGES the deploy forever. A
 *   live-null service OMITS this field entirely; it is NEVER written as `/`
 *   or `/api/health` (and the pin mutation OMITS the key when absent rather
 *   than sending `null`, which would actively CLEAR it).
 */
export interface EnvironmentConfig {
  /** env-scoped Railway serviceInstance ID. */
  instanceId: string;
  /** Public host (no scheme). Omitted for domainless workers. */
  domain?: string;
  /**
   * Env-scoped PRIVATE Railway networking host (no scheme), e.g.
   * `showcase-aimock.railway.internal`. Railway bills traffic to the public
   * `*.up.railway.app` `domain` as egress even intra-project, but private
   * `*.railway.internal` networking is FREE and env-scoped (staging resolves
   * to the staging instance, prod to prod). When present, cross-service
   * serviceRefs resolve to THIS host (via `ssot_target_host` preferring it)
   * so the ~20 demo backends reach aimock over free private networking
   * instead of billed public egress. The public `domain` is KEPT for health
   * probes / external reachability. Same private DNS name in BOTH envs —
   * env-scoping (not the name) provides the staging/prod isolation.
   * OPTIONAL; omitted ⇒ serviceRefs fall back to the public `domain`.
   */
  internalDomain?: string;
  /** Probe this env in verify-deploy? Defaults to true when omitted. */
  probe?: boolean;
  /** Per-env GHCR repo-name override. Defaults to the service name. */
  repoName?: string;
  /**
   * Railway HTTP healthcheck path for this env. OPTIONAL; omitted ⇒ do not
   * assert (Railway default / null). Encode the LIVE value verbatim.
   */
  healthcheckPath?: string;
}

export interface ServiceEntry {
  /** Railway service ID (env-independent). */
  serviceId: string;
  /**
   * Per-env configuration, keyed by env name ("prod" / "staging" / …).
   * A service present in only one env carries only that key.
   */
  environments: Record<string, EnvironmentConfig>;
  /**
   * Feature-level verify-deploy driver for this service (env-independent —
   * it never differed per env). See ProbeDriver.
   */
  probeDriver: ProbeDriver;
  /**
   * True iff this service is built and pushed by `showcase_build.yml`.
   * webhooks is a first-party GHCR image but is built by its own repo's
   * release workflow — it MUST NOT be touched by the showcase build's
   * default staging redeploy scope. (pocketbase IS showcase-CI-built:
   * its matrix slot is gated to `showcase/pocketbase/**` changes.)
   */
  ciBuilt: boolean;
  /**
   * True iff `verify-railway-image-refs.ts` validates this service's
   * image refs. As of WS-C completion this is `true` for every service
   * in `SERVICES` except the `gateIgnore` `harness-workers` entry — the
   * historic Phase-2 deferral on dashboard, docs,
   * dojo, shell, and harness has been retired. New services added to
   * the SSOT MUST land with `gateValidated: true` (and a per-env
   * `repoName` if the Railway service name does not match the GHCR repo
   * name); use the optional `gateIgnore: true` field only for
   * deliberately-untracked third-party / domainless / single-env services.
   */
  gateValidated: boolean;
  /**
   * SSOT key of the CI-built service whose GHCR image this service RUNS.
   *
   * Models explicit image consumption for services that share another
   * service's image instead of having their own build slot (e.g.
   * `harness-workers` runs the same `showcase-harness` image as the
   * `harness` scheduler). `redeploy-env.ts` expands the redeploy scope
   * so a rebuilt image redeploys ALL its consumers — without this, a
   * main-merge rebuild of `showcase-harness:latest` only bounced the
   * scheduler and the workers silently kept the stale image.
   *
   * Constraints (enforced fail-loud at module load by
   * `assertImageConsumersValid`):
   *   - must point at an existing SSOT key;
   *   - the target must be `ciBuilt: true` (consuming a non-CI-built
   *     image can never put the consumer in the CI redeploy scope);
   *   - the consumer itself must NOT be `ciBuilt` (a build slot is its
   *     own image producer — no consumer-of-consumer chains);
   *   - the consumer's declared `environments` must be a NON-EMPTY subset
   *     of its `imageOf` producer's environments (a consumer env the
   *     producer never builds for would run a never-rebuilt image there,
   *     and a consumer with zero declared envs would never be redeployed
   *     in any env — both are rejected at module load).
   *
   * The expansion is env-aware: a consumer only enters an env's redeploy
   * scope if it declares that env (the staging-only worker never enters
   * the prod scope). Omit for any service with its own build slot or a
   * pinned/out-of-band image that must NOT follow rebuilds.
   */
  imageOf?: string;
  /**
   * Opt-out flag for the image-ref gate. When `true`, the gate ignores
   * this service entirely in BOTH the SSOT→Railway direction (no
   * "missing from Railway" failure if absent) AND the Railway→SSOT
   * direction (no "untracked Railway service" failure if Railway has
   * a service with this name that is not WS4-managed). Default: false.
   *
   * Intentionally narrow: this exists for deliberately-untracked
   * third-party relays, domainless workers, or single-env services. The
   * default for every WS4-managed service is `false` (omitted).
   */
  gateIgnore?: boolean;
  /**
   * Promote ordering tier for the equivalence-gated cluster promote
   * (`computePromoteClosure`). Lower tiers pin+verify BEFORE higher tiers,
   * and a tier gates its dependents (a stale aimock/harness under fresh
   * integrations = a non-equivalent prod):
   *   - 0 — shared infra the whole cluster runs against (`aimock`,
   *     `pocketbase`, `webhooks`);
   *   - 1 — the verification control plane + dashboard
   *     (`harness`, `harness-workers`, `dashboard`), ALWAYS pulled into an
   *     equivalence-gated promote so the post-promote re-sweep + dashboard
   *     read run against the just-promoted harness/PB;
   *   - 2 — integrations and shells (the leaf set an operator names).
   * OPTIONAL: defaults to 2 when omitted (the leaf default). This field is
   * promote-only — it does NOT affect the staging redeploy scope.
   */
  promoteTier?: 0 | 1 | 2;
  /**
   * STANDALONE service: a leaf that neither depends on anything nor gates on
   * anything. When set, `computePromoteClosure` (and the resolve-promote-targets
   * jq mirror) (a) do NOT pull the always-on Tier-1 verification set into a
   * promote whose REQUESTED set is entirely standalone — so promoting it alone
   * promotes ONLY itself, not the whole control plane — and (b) the promote
   * fleet runner attempts it UNGATED and never records it NOT-ATTEMPTED because
   * an unrelated service failed. Use for self-contained services with no runtime
   * dependency on the equivalence control plane (e.g. the `docs` shell). A
   * standalone service must therefore declare no `runtimeDeps`. OPTIONAL;
   * omitted = false (the normal tier-gated leaf).
   */
  standalone?: boolean;
  /**
   * SSOT keys this service needs PRESENT-AND-CURRENT in the target env for
   * its own promote to be meaningful — the transitive runtime dependencies
   * `computePromoteClosure` pulls into the promote closure. Distinct from
   * `imageOf` (image-sharing for the redeploy scope): `runtimeDeps` models
   * "this service talks to that service at runtime", e.g. each `agent`
   * integration → `["aimock"]` (it routes LLM traffic at the env-local
   * aimock) and the `dashboard` → `["pocketbase","harness"]` (it reads the
   * PB rows the harness writes). OPTIONAL; omitted = no runtime deps. Every
   * entry must be an existing SSOT key (enforced by `assertClosureValid`).
   */
  runtimeDeps?: string[];
  /**
   * Cross-service env-var references this service carries in the target env
   * — an env var (`key`) whose VALUE must point at another SSOT service's
   * (`target`) env-LOCAL host (prod→prod, staging→staging). e.g. an agent's
   * `OPENAI_BASE_URL` must resolve to the env's own aimock, never the other
   * env's. The Stage-2 Ruby preflight (U5) ASSERTS these (REFUSE on
   * mismatch — the `ms-agent-dotnet` cross-env class); it never copies a
   * value. OPTIONAL; omitted = no service refs. Every `target` must be an
   * existing SSOT key (enforced by `assertClosureValid`).
   */
  serviceRefs?: { key: string; target: string }[];
  /**
   * Ruby/jq-BOUNDARY COMPATIBILITY SHIM — read ONLY by
   * `emit-railway-envs-json.ts`, never by any TS accessor.
   *
   * The generated `railway-envs.generated.json` is consumed by
   * `showcase/bin/railway` (Ruby) and workflow jq, which still expect the
   * legacy per-service shape `{ prodInstanceId, stagingInstanceId,
   * domains:{prod,staging}, probe:{prod,staging,driver}, … }` — every
   * service MUST carry BOTH env keys with non-null values. Domainless /
   * single-env workers in the env-map schema legitimately omit a domain
   * (and the worker omits its prod env entirely), which would otherwise
   * change the emitted JSON. To keep the JSON BYTE-IDENTICAL across the
   * refactor (so Ruby + jq + the parity test see no diff), the emitter
   * fills the gaps from this shim:
   *   - `prodInstanceId` for a service with no `prod` env  → `serviceId`
   *     (the legacy non-functional placeholder; never dereferenced because
   *     the service is staging-only with probe disabled).
   *   - a missing per-env `domain` → the value provided here (the legacy
   *     borrowed control-plane host). bin/railway's EXPECTED_DOMAINS
   *     derivation FILTERS OUT `*.up.railway.app` hosts (only public
   *     domains enter its domain checks), and resolve-verify-matrix
   *     filters on `probe.staging===true`, so neither consumer ever
   *     dereferences these placeholder hosts — they exist only to
   *     preserve the JSON shape.
   *
   * Omit this field for any normal (dual-env, domain-bearing) service.
   */
  legacyJsonCompat?: {
    domains?: { prod?: string; staging?: string };
    /**
     * Legacy per-env `repoNameOverride` values for an env that the env-map
     * schema omits (a single-env worker's absent env still carried a
     * placeholder repoName in the legacy JSON). The emitter merges these
     * UNDER the real per-env `repoName` values (real wins) so the emitted
     * `repoNameOverride` object stays byte-identical.
     */
    repoNameOverride?: { prod?: string; staging?: string };
  };
  /**
   * Harness-worker fleet provisioning record. ONLY populated on the
   * `harness-workers` entry — all other services omit this field.
   *
   * These values match CURRENT LIVE REALITY as of 2026-06-26, VERIFIED via the
   * Railway GraphQL `environment.config` staged-config read (both envs carry
   * `deploy.multiRegionConfig = {"us-west2":{"numReplicas":6}}`):
   *   prod:    effectiveReplicas=6, numReplicas(mirror)=6, BROWSER_POOL_MAX_CONTEXTS=40
   *   staging: effectiveReplicas=6, numReplicas(mirror)=6, BROWSER_POOL_MAX_CONTEXTS=40
   *
   * EFFECTIVE FIELD: `effectiveReplicas` models `multiRegionConfig.us-west2.
   * numReplicas` — the field Railway actually honors for this single-region
   * service. The top-level `numReplicas` is a documented mirror only. The drift
   * gate asserts `effectiveReplicas`.
   *
   * PROD/STAGING PARITY ACHIEVED: B-reconcile scaled prod harness-workers to 6
   * replicas (both the top-level field AND `multiRegionConfig.us-west2.
   * numReplicas`) to match staging (6). Prod and staging are now at parity
   * (6/6). The earlier prod=3 state and the staging config-field-vs-live drift
   * (config=2 / live=6) are both RESOLVED: the live staged config now reads 6
   * in both envs, verified above.
   *
   * See the `WorkerProvisioning` interface (above) for the 1-worker-per-replica
   * model, the effective-vs-mirror replica distinction, and HARNESS_POOL_COUNT
   * informational semantics.
   */
  workerProvisioning?: {
    prod: WorkerProvisioning;
    staging: WorkerProvisioning;
  };
}

/**
 * Canonical per-service ID map. Keys are the EXACT Railway service names
 * (`showcase-*` for integrations; bare names for infra services).
 *
 * Resolved 2026-05-28 via Railway GraphQL
 * `project($id).services.edges[].serviceInstances.edges[]`.
 *
 * `dispatchName` (when set) is the EXACT `dispatch_name` value used by
 * `.github/workflows/showcase_build.yml`'s `ALL_SERVICES` matrix entry
 * for this service. The redeploy script uses it to convert the matrix
 * output (which carries dispatch_names) back into SSOT keys.
 */
export const SERVICES: Record<
  string,
  ServiceEntry & { dispatchName?: string }
> = {
  aimock: {
    serviceId: "0fa0435d-8a66-46f0-84fd-e4250b580013",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "showcase-aimock",
    probeDriver: "aimock",
    // Tier-0 shared infra: every agent integration routes its LLM traffic at
    // the env-local aimock, so aimock pins+verifies before any tier-1/2.
    promoteTier: 0,
    // Aimock runs the `showcase-aimock` wrapper image in BOTH envs.
    // The wrapper (built from `showcase/aimock/Dockerfile`) bakes the
    // showcase fixture tree into base aimock and is the permanent,
    // canonical aimock image — it is the only aimock image CI builds.
    // Prod is digest-pinned (`@sha256:<digest>`, promote-only); staging
    // floats `:latest`. Both envs override to the same `showcase-aimock`
    // GHCR repo; there is no migration to the unwrapped `aimock` repo.
    environments: {
      prod: {
        instanceId: "5801d8be-5ad9-4eff-9c9c-7be61d9a023e",
        healthcheckPath: "/health",
        domain: "showcase-aimock-production.up.railway.app",
        // Private env-scoped host the ~20 demo backends route LLM traffic
        // at (FREE intra-env networking; the public `domain` above is
        // billed egress and kept only for health probes). aimock binds
        // 0.0.0.0:4010; serviceRefs resolve to `http://<this>:4010`.
        internalDomain: "showcase-aimock.railway.internal",
        probe: true,
        repoName: "showcase-aimock",
      },
      staging: {
        instanceId: "9f260dfd-d9d4-43e9-98fe-49696f87fe50",
        healthcheckPath: "/health",
        domain: "aimock-staging.up.railway.app",
        // Same private DNS name as prod — Railway env-scopes the resolution
        // (staging → staging aimock instance), so demo backends stay
        // env-local without a per-env host string.
        internalDomain: "showcase-aimock.railway.internal",
        probe: true,
        repoName: "showcase-aimock",
      },
    },
  },
  dashboard: {
    serviceId: "4d5dfd74-be61-40b2-8564-b53b7dd4c15b",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "shell-dashboard",
    probeDriver: "dashboard",
    // Tier-1 verification surface: the dashboard reads the PB rows the
    // harness writes, so an equivalence-gated promote always pulls it in.
    promoteTier: 1,
    // Runtime deps: it reads pocketbase rows produced by the harness sweep.
    runtimeDeps: ["pocketbase", "harness"],
    // Railway service name is `dashboard`; GHCR repo is
    // `showcase-shell-dashboard`. Same override for both envs:
    // staging :latest, prod @sha256 — uniform across all services.
    environments: {
      prod: {
        instanceId: "e68f98fa-b2ef-41cc-82f6-2ed6f9533bf3",
        domain: "dashboard.showcase.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell-dashboard",
      },
      staging: {
        instanceId: "aea7332e-17a0-4fab-921c-ed5baad2a6f2",
        domain: "dashboard.showcase.staging.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell-dashboard",
      },
    },
  },
  docs: {
    serviceId: "7badfb8d-4228-414c-9145-b4026803714f",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "shell-docs",
    probeDriver: "docs",
    // Standalone: the docs shell is self-contained — it has no runtime
    // dependency on the equivalence control plane, so a `docs` promote must
    // promote ONLY docs (never drag in the Tier-1 harness/aimock set) and must
    // never be gated by an unrelated service's failure (e.g. a harness P6
    // env-divergence WARN-refusal must not block docs).
    standalone: true,
    // Railway service name is `docs`; GHCR repo is `showcase-shell-docs`.
    environments: {
      prod: {
        instanceId: "b15564fc-f832-49b3-82df-fd36f298fe96",
        domain: "docs.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell-docs",
      },
      staging: {
        instanceId: "d5caa51d-73ee-4669-bfea-d87bf1488b02",
        domain: "docs.staging.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell-docs",
      },
    },
  },
  dojo: {
    serviceId: "7ad1ece7-2228-49cd-8a78-bddf30322907",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "shell-dojo",
    probeDriver: "dojo",
    // Railway service name is `dojo`; GHCR repo is `showcase-shell-dojo`.
    environments: {
      prod: {
        instanceId: "2ee4f2aa-11ec-4426-9a4a-41a1ad04f16d",
        domain: "dojo.showcase.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell-dojo",
      },
      staging: {
        instanceId: "1284d717-0ff5-432c-9326-fab12661df61",
        domain: "dojo.showcase.staging.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell-dojo",
      },
    },
  },
  harness: {
    serviceId: "3a14bfed-0537-4d71-897b-7c593dca161d",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "showcase-harness",
    probeDriver: "harness",
    // Tier-1 verification control plane: the post-promote re-sweep runs on
    // the just-promoted harness, so it pins+verifies before tier-2.
    promoteTier: 1,
    // Railway service name is `harness`; GHCR repo is `showcase-harness`.
    // ciBuilt: true, gateValidated: true — uniform with the rest of
    // the CI-built integrations now that WS-C has flipped the five.
    environments: {
      prod: {
        instanceId: "05fbcdf2-8a50-4b71-b4f6-c92c4b17e626",
        healthcheckPath: "/health",
        domain: "showcase-harness-production.up.railway.app",
        probe: true,
        repoName: "showcase-harness",
      },
      staging: {
        instanceId: "0811f68f-fac4-440e-a350-3a7ca5855b80",
        healthcheckPath: "/health",
        domain: "harness-staging-2ee4.up.railway.app",
        probe: true,
        repoName: "showcase-harness",
      },
    },
  },
  // SSOT key MUST equal the EXACT Railway service name. The Railway service
  // is `harness-workers` (PLURAL) — the image-ref gate matches SSOT keys to
  // Railway service names verbatim, so the key here is `harness-workers`,
  // not `showcase-harness-worker`.
  "harness-workers": {
    serviceId: "c2aa8a0b-350e-4b76-8541-3012dfac41d0",
    // Pool-fleet worker. Workers run in BOTH staging and prod: the prod worker
    // is live on Railway (deployed 2026-06-19, HARNESS_ROLE=worker, pool
    // count 2) and is now BACKFILLED as a `prod` env entry below (real
    // serviceInstance ID `7c48ee43-…`). ciBuilt:false because the worker has
    // no build slot of its own — but `imageOf: "harness"` (below) puts it in
    // the redeploy scope of BOTH envs whenever the shared showcase-harness
    // image is rebuilt. Before this backfill the entry modeled only staging,
    // so the env-aware `imageOf` expansion (redeploy-env.ts:278) SILENTLY
    // SKIPPED the prod worker on a `showcase-harness:latest` rebuild — the
    // prod worker kept its stale 2026-06-19 image (a 1-demo `registry.json`
    // for `ms-agent-harness-dotnet` → missing `UI` badge → D0). Declaring the
    // prod env here closes that gap: a rebuild now bounces the prod worker too.
    ciBuilt: false,
    // gateValidated: true — the worker is now a modeled dual-env service, so
    // the image-ref gate validates its `showcase-harness` image refs in both
    // envs (findMissingServices checks gateValidated:true entries; both env
    // entries carry an explicit `repoName: "showcase-harness"`). gateIgnore is
    // dropped: the SSOT now fully models the live Railway service in both envs,
    // so neither the SSOT→Railway nor the Railway→SSOT gate direction needs an
    // opt-out.
    gateValidated: true,
    probeDriver: "harness",
    // Tier-1 verification fleet. With the prod env declared below,
    // computePromoteClosure now promotes the prod worker alongside the
    // harness control-plane (rather than recording it skipped-with-reason).
    promoteTier: 1,
    // The worker runs the SAME `showcase-harness` GHCR image that the
    // existing `harness` (control-plane) service runs — it is NOT a
    // separately-built image. The single `showcase-harness` build slot in
    // showcase_build.yml produces the image both services consume; there is
    // no `harness-workers` build slot. Hence ciBuilt:false, with the
    // consumption modeled explicitly via imageOf so the redeploy after a
    // successful `showcase-harness` build bounces the worker in EVERY env it
    // declares (it used to be silently skipped in prod, leaving it on the
    // stale image). The per-env repoName override points at `showcase-harness`
    // so the image-ref shape resolves correctly.
    imageOf: "harness",
    //
    // No public domain (queue worker, not HTTP-exposed) and probe disabled in
    // both envs: verify-deploy skips probe:false services, and the schema does
    // not require a domain, so we OMIT it rather than point at a borrowed host.
    environments: {
      prod: {
        instanceId: "7c48ee43-6df4-457b-b977-10f1f1ac1680",
        healthcheckPath: "/health",
        probe: false,
        repoName: "showcase-harness",
      },
      staging: {
        instanceId: "362c1e37-5f40-45f2-ac7b-0e5adac565f8",
        healthcheckPath: "/health",
        probe: false,
        repoName: "showcase-harness",
      },
    },
    // Ruby/jq JSON-shape compat (see ServiceEntry.legacyJsonCompat). The prod
    // env is now real, so its prodInstanceId/repoName come straight from the
    // env map; the only remaining compat shim is the borrowed control-plane
    // hosts for the domainless worker's `domains{}` block (probe:false in both
    // envs, so these hosts are never dereferenced at runtime — they exist only
    // to keep the generated JSON's `domains` shape byte-stable). Not read by TS.
    legacyJsonCompat: {
      domains: {
        prod: "showcase-harness-production.up.railway.app",
        staging: "harness-staging-2ee4.up.railway.app",
      },
    },
    // Worker-fleet provisioning (SSOT). Values = CURRENT LIVE REALITY (2026-06-26),
    // verified via the Railway GraphQL environment.config staged-config read.
    // 1-worker-per-replica model: the EFFECTIVE replica count IS the worker count
    // (strictly 1:1). The authoritative field is `effectiveReplicas` =
    // multiRegionConfig.us-west2.numReplicas — the value Railway honors. The
    // top-level `numReplicas` is a documented mirror only (always equal here,
    // single-region). HARNESS_POOL_COUNT is INFORMATIONAL ONLY — it does NOT
    // fork workers. Per-worker concurrency knob is BROWSER_POOL_MAX_CONTEXTS.
    //
    // PARITY ACHIEVED (B-reconcile): prod was scaled 3 → 6 to match staging, in
    // BOTH the top-level numReplicas and multiRegionConfig.us-west2.numReplicas.
    // Live staged config now reads {"us-west2":{"numReplicas":6}} in both envs.
    //   prod:    effectiveReplicas=6 → 6 live workers.
    //   staging: effectiveReplicas=6 → 6 live workers.
    // The earlier staging config-field-vs-live drift (config=2 / live=6) is also
    // resolved: the staged config field now reads 6.
    workerProvisioning: {
      prod: {
        // EFFECTIVE = multiRegionConfig.us-west2.numReplicas (Railway honors this).
        effectiveReplicas: 6,
        // Top-level mirror (equal, single-region).
        numReplicas: 6,
        BROWSER_POOL_MAX_CONTEXTS: 40,
        // INFORMATIONAL ONLY — not a fork factor.
        HARNESS_POOL_COUNT: 3,
        // DEPLOY ROLLOVER (layer c) — pure Railway config, no rolling-restart code.
        // overlap=45s holds the capacity floor (old deployment serves until new
        // workers register+claim); draining=180s ≥ PLATFORM_STOP_GRACE_MS so the
        // 3s+90s composed worker-drain (layer b) completes before SIGKILL. See
        // showcase/RAILWAY.md "Deploy rollover".
        overlapSeconds: 45,
        drainingSeconds: 180,
      },
      staging: {
        // EFFECTIVE = multiRegionConfig.us-west2.numReplicas (Railway honors this).
        effectiveReplicas: 6,
        // Top-level mirror (equal, single-region).
        numReplicas: 6,
        BROWSER_POOL_MAX_CONTEXTS: 40,
        // INFORMATIONAL ONLY — not a fork factor. Live staging value is 2
        // (verified via the variables read); it does not gate the worker count.
        HARNESS_POOL_COUNT: 2,
        // DEPLOY ROLLOVER (layer c) — pure Railway config, no rolling-restart code.
        // overlap=45s holds the capacity floor (old deployment serves until new
        // workers register+claim); draining=180s ≥ PLATFORM_STOP_GRACE_MS so the
        // 3s+90s composed worker-drain (layer b) completes before SIGKILL. See
        // showcase/RAILWAY.md "Deploy rollover".
        overlapSeconds: 45,
        drainingSeconds: 180,
      },
    },
  },
  pocketbase: {
    serviceId: "ba11e854-d695-4738-9a45-2b0776788824",
    // pocketbase is a first-party ghcr.io/copilotkit/ image whose GHCR
    // repo name is `showcase-pocketbase` (NOT `pocketbase`). It is now
    // built+pushed by showcase_build.yml (the `pocketbase` matrix slot,
    // gated to `showcase/pocketbase/**` changes) so PB hook + migration
    // changes ship via CI instead of an ad-hoc manual build. ciBuilt:true
    // also puts it in the default staging-redeploy scope, but the build's
    // redeploy step only touches the matrix∩build-success intersection,
    // so pocketbase only redeploys when its own files change.
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "showcase-pocketbase",
    probeDriver: "pocketbase",
    // Tier-0 shared infra: the verification control plane (harness) writes
    // its sweep rows here, so PB pins+verifies before tier-1.
    promoteTier: 0,
    environments: {
      prod: {
        instanceId: "1ee376e2-13f2-4464-801e-d0aa0bf76532",
        domain: "showcase-pocketbase-production.up.railway.app",
        probe: true,
        repoName: "showcase-pocketbase",
      },
      staging: {
        instanceId: "0bc7db7b-5a43-4b33-af46-d07fb53c8610",
        domain: "pocketbase-staging-eec0.up.railway.app",
        probe: true,
        repoName: "showcase-pocketbase",
      },
    },
  },
  shell: {
    serviceId: "40eea0da-6071-4ea8-bdb9-39afb19225ec",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "shell",
    probeDriver: "shell",
    // Railway service name is `shell`; GHCR repo is `showcase-shell`.
    environments: {
      prod: {
        instanceId: "01614ccf-e109-4b30-b41b-7c5551c0a34c",
        healthcheckPath: "/",
        domain: "showcase.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell",
      },
      staging: {
        instanceId: "25b7de41-188c-4f2e-ac07-538212eaeb91",
        healthcheckPath: "/",
        domain: "showcase.staging.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell",
      },
    },
  },
  "showcase-ag2": {
    serviceId: "4a37481b-f264-4eb7-a9cd-0a9ebb9ac05c",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "ag2",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "de571c97-03fd-486b-8a54-9767a4a53f95",
        healthcheckPath: "/api/health",
        domain: "showcase-ag2-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "ecaf81b3-93a8-4862-92b6-04a016b634ed",
        healthcheckPath: "/api/health",
        domain: "showcase-ag2-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-agno": {
    serviceId: "32cab80b-e329-45bd-9c73-c4e1ddc94305",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "agno",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "026d12fb-2844-42af-8f92-b47bc8a06bc8",
        healthcheckPath: "/api/health",
        domain: "showcase-agno-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "68964ab6-75ca-4095-a64a-52cacfb684f5",
        healthcheckPath: "/api/health",
        domain: "showcase-agno-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-built-in-agent": {
    serviceId: "f4f8371a-bc46-45b2-b6d4-9c9af608bdbf",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "built-in-agent",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "40018ef7-1ed1-4979-b80c-9c2d957b6d88",
        healthcheckPath: "/api/health",
        domain: "showcase-built-in-agent-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "b89ae7b3-01cc-4ed4-aca6-23aaa63cd59e",
        healthcheckPath: "/api/health",
        domain: "showcase-built-in-agent-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-claude-sdk-python": {
    serviceId: "b122ab65-9854-4cb2-a68e-b50ff13f7481",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "claude-sdk-python",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The service-refs are ASSERTED prod→prod by the Stage-2
    // Ruby preflight (never copied). The claude-sdk agent SDK reads
    // ANTHROPIC_BASE_URL (see src/agents/claude_agent_sdk_adapter.py and the
    // aimock-wiring probe's claude-sdk pattern), so it must be pinned at aimock
    // alongside OPENAI_BASE_URL — otherwise a drifted ANTHROPIC_BASE_URL would
    // silently bypass aimock and hit the real Anthropic API (non-deterministic
    // results that look like flapping). This is SSOT hygiene: the var is
    // already set correctly on the live service; declaring the ref makes the
    // preflight assert it and refuse a cross-env leak.
    runtimeDeps: ["aimock"],
    serviceRefs: [
      { key: "OPENAI_BASE_URL", target: "aimock" },
      { key: "ANTHROPIC_BASE_URL", target: "aimock" },
    ],
    environments: {
      prod: {
        instanceId: "bb18caaf-9a3e-4fdd-85ec-562fd82a3a89",
        healthcheckPath: "/api/health",
        domain: "showcase-claude-sdk-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "1ef25aec-5fbd-40b9-8685-57c2681bd45d",
        healthcheckPath: "/api/health",
        domain: "showcase-claude-sdk-python-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-claude-sdk-typescript": {
    serviceId: "18a98727-5700-44aa-b497-b60795dbbd6a",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "claude-sdk-typescript",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "bee425e4-9661-4a88-8888-922b8cd4b61d",
        healthcheckPath: "/api/health",
        domain: "showcase-claude-sdk-typescript-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "92305747-2f55-4122-aad4-882e989558ab",
        healthcheckPath: "/api/health",
        domain: "showcase-claude-sdk-typescript-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-crewai-crews": {
    serviceId: "0e9c284d-8d87-4fcf-9f82-6b704d7e4bd4",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "crewai-crews",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "3dab0cc3-cab1-4579-b772-947268088514",
        healthcheckPath: "/api/health",
        domain: "showcase-crewai-crews-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "88c2a14f-435b-499e-a811-ee4f4be18fd8",
        healthcheckPath: "/api/health",
        domain: "showcase-crewai-crews-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-google-adk": {
    serviceId: "87f60507-5a3d-4b8a-9e23-2b1de85d939c",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "google-adk",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "7b2da5db-87d2-40ad-a3d9-b2d7a5485a22",
        healthcheckPath: "/api/health",
        domain: "showcase-google-adk-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "7efe2fa0-fa78-4585-bc4c-6d39c326e6d1",
        healthcheckPath: "/api/health",
        domain: "showcase-google-adk-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-langgraph-fastapi": {
    serviceId: "06cccb5c-59f4-46b5-8adc-7113e77011a4",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "langgraph-fastapi",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "105b7e01-acd0-48e2-9a09-541e2103e8d2",
        healthcheckPath: "/api/health",
        domain: "showcase-langgraph-fastapi-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "7899afe0-141b-4217-8dbb-5907813231dc",
        healthcheckPath: "/api/health",
        domain: "showcase-langgraph-fastapi-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-langgraph-python": {
    serviceId: "90d03214-4569-41b0-b4c1-6438a8a7b203",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "langgraph-python",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "aec504f7-63d7-4ea6-9d50-601b00d2ae80",
        healthcheckPath: "/api/health",
        domain: "showcase-langgraph-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "04d29664-a776-4670-9db3-b1d18bce1669",
        healthcheckPath: "/api/health",
        domain: "showcase-langgraph-python-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-langgraph-typescript": {
    serviceId: "66246d3b-a18e-46f0-be51-5f3ff7a36e5a",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "langgraph-typescript",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "f53e9fdc-7c3e-4dfd-9fa8-d7241fd55bb8",
        healthcheckPath: "/api/health",
        domain: "showcase-langgraph-typescript-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "481ab37f-da8a-4015-bd88-2b28d9eb261a",
        healthcheckPath: "/api/health",
        domain: "showcase-langgraph-typescript-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-langroid": {
    serviceId: "6dd9cb0a-66cc-46f1-972e-7cd74756157d",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "langroid",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "6b5e20b5-8f8e-4ec3-9288-7a41122e42e5",
        healthcheckPath: "/api/health",
        domain: "showcase-langroid-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "a213f7d9-2117-4944-988b-05e68d819dd5",
        healthcheckPath: "/api/health",
        domain: "showcase-langroid-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-llamaindex": {
    serviceId: "285386e8-492d-4cb8-b632-0a7d4607378f",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "llamaindex",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "b778856e-9f90-4136-9415-fb2b41173f8d",
        healthcheckPath: "/api/health",
        domain: "showcase-llamaindex-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "17899ea7-355c-43f2-a152-28cb0b7fa864",
        healthcheckPath: "/api/health",
        domain: "showcase-llamaindex-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-mastra": {
    serviceId: "d7979eb7-2405-4aab-ad21-438f4a1b08af",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "mastra",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "eaeddd9c-8b75-426f-b033-0fd935cbf6ef",
        healthcheckPath: "/api/health",
        domain: "showcase-mastra-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "eec22411-aab5-47a1-8f5b-d097e233d7f8",
        healthcheckPath: "/api/health",
        domain: "showcase-mastra-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-ms-agent-dotnet": {
    serviceId: "beeb2dd6-87a4-4599-aa07-0578f7bd6519",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "ms-agent-dotnet",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "93ca0edf-7b59-4de4-b1fd-3412bb07bc6a",
        healthcheckPath: "/api/health",
        domain: "showcase-ms-agent-dotnet-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "9826bc58-c472-41e6-b050-29249d4b2a52",
        healthcheckPath: "/api/health",
        domain: "showcase-ms-agent-dotnet-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-ms-agent-harness-dotnet": {
    serviceId: "6343d7f9-6c3f-4c8d-9a6e-79f03d2f1e37",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "ms-agent-harness-dotnet",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "8f91ebc6-95c0-4433-b1f7-657ff49c2d59",
        healthcheckPath: "/api/health",
        domain: "showcase-ms-agent-harness-dotnet-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "6b0fe181-9156-4a40-9e44-90befe09833a",
        healthcheckPath: "/api/health",
        domain: "showcase-ms-agent-harness-dotnet-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-ms-agent-python": {
    serviceId: "655db75a-af8d-427d-a4f9-441570ae5003",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "ms-agent-python",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "323ed911-4d28-45ab-8fc0-7d151828b938",
        healthcheckPath: "/api/health",
        domain: "showcase-ms-agent-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "741725ce-5fa1-4327-aff5-53dcc000c29c",
        healthcheckPath: "/api/health",
        domain: "showcase-ms-agent-python-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-pydantic-ai": {
    serviceId: "0a106173-2282-4887-a994-0ca276a99d69",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "pydantic-ai",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "192cd647-6824-4f01-937a-1da675d83805",
        healthcheckPath: "/api/health",
        domain: "showcase-pydantic-ai-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "6edf5ca5-6a56-4d28-92c3-2a3360c735db",
        healthcheckPath: "/api/health",
        domain: "showcase-pydantic-ai-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-spring-ai": {
    serviceId: "eed5d041-91be-4282-b414-beea00843401",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "spring-ai",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "2fbf1db2-5e51-44c9-983c-3f2242d95c61",
        healthcheckPath: "/api/health",
        domain: "showcase-spring-ai-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "189ac76f-bd77-45c0-9c45-3853dae763cc",
        healthcheckPath: "/api/health",
        domain: "showcase-spring-ai-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "showcase-strands": {
    serviceId: "92e1cfad-ad53-403f-ab2b-5ab380832232",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "strands",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "2123c71b-9385-443c-a1c3-bcf4b1669eeb",
        healthcheckPath: "/api/health",
        domain: "showcase-strands-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "f8a9d2ed-50ec-4f06-85d6-230baced8471",
        healthcheckPath: "/api/health",
        domain: "showcase-strands-staging.up.railway.app",
        probe: true,
      },
    },
  },
  // The TypeScript sibling of `showcase-strands`. Now provisioned in BOTH
  // staging and prod (dual-env `showcase-strands` shape): the prod
  // serviceInstance was created + deployed + health-verified, so the entry
  // declares a real `prod` env, gateValidated:true (verify-railway-image-refs
  // validates both drift directions), gateIgnore dropped, and the
  // legacyJsonCompat prod-domain placeholder removed.
  "showcase-strands-typescript": {
    serviceId: "d6f47c8c-a0a1-4dbe-991c-50f8463fd68d",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "strands-typescript",
    probeDriver: "agent",
    // Tier-2 leaf (default). Runtime dep: the agent routes its LLM traffic
    // at the env-local aimock, so a cluster promote pulls aimock (tier-0)
    // into the closure. The OPENAI_BASE_URL service-ref is ASSERTED prod→prod
    // by the Stage-2 Ruby preflight (never copied).
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "8a50728e-6119-43c4-b59c-d9535b6717a4",
        healthcheckPath: "/api/health",
        domain: "showcase-strands-typescript-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "3f917b9f-c3f0-4d8b-96ca-7f455e06b5ba",
        healthcheckPath: "/api/health",
        domain: "showcase-strands-typescript-staging.up.railway.app",
        probe: true,
      },
    },
  },
  // ───────────────────────── starter-* container fleet ─────────────────────
  // The 12 starter-template containers (ghcr.io/copilotkit/starter-<slug>),
  // live in BOTH staging and prod. Folded into the cluster-promote SSOT (S1)
  // and brought UNDER THE GATE (S2) so they receive the SAME
  // dependency-/env-/verification-complete + pinned-prod treatment as the
  // showcase-* demos — one whole cluster, no carve-out. The SSOT key === the
  // Railway service name === `starter-<RAW starter slug>`, where the RAW slug
  // is a BARE key of STARTER_TO_COLUMN (e.g. `adk`, so the SSOT key is
  // `starter-adk`) in harness/src/probes/helpers/starter-mapping.ts — NOT the
  // remapped dashboard column slug.
  //
  // S2 SCOPE — these entries are now FULLY gate-managed, identical to a
  // showcase-* agent:
  //   - ciBuilt:true     → built+pushed by showcase_build.yml's `build-starters`
  //                        job to `ghcr.io/copilotkit/starter-<slug>:latest`
  //                        (the starter matrix `.image` === `starter-<slug>` ===
  //                        this SSOT key). In the CI_BUILT_SERVICES redeploy
  //                        scope. `dispatchName` === the SSOT key because the
  //                        starter workflow_dispatch choice value is the bare
  //                        `starter-<slug>` (assertDispatchNamesUnique permits a
  //                        dispatchName equal to its OWN key).
  //   - gateValidated:true / gateIgnore unset → verify-railway-image-refs.ts
  //                        validates the canonical image shape (prod @sha256,
  //                        staging :latest) and BOTH drift directions, exactly
  //                        like showcase-*. No `repoName` override: the Railway
  //                        service name already equals the GHCR repo name
  //                        (`starter-<slug>`), so the gate's default
  //                        `ghcr.io/copilotkit/<serviceName>` is correct.
  //   - bin/railway lint-prod now COVERS these prod services (asserts they are
  //                        @sha256-pinned).
  //
  // probeDriver "starter": the starters are verified by the verify-deploy
  // baseline driver (deployment-SUCCESS + HTTP 200 on `/`) in
  // verify-deploy.drivers.starter.ts, exactly like the Next.js shells. They
  // are always-on + staging-probed (prod probe ON and staging probe ON), so
  // resolve-verify-matrix routes them through the verify-deploy staging matrix
  // (which filters on probe.staging===true) like every other managed showcase
  // service. The starters are ALSO auto-discovered by the harness
  // `starter_smoke` axis (railway-services source, namePrefix "starter-",
  // writing `starter:<column-slug>/<level>` rows) — orthogonal to the baseline
  // liveness probe here. The "starter" ProbeDriver is the contract field the
  // dispatch switch keys on to route a starter target to probeStarter.
  //
  // runtimeDeps/serviceRefs mirror the showcase-* agents: each starter routes
  // its LLM traffic at the env-local aimock (tier-0), so a cluster promote
  // pulls aimock into the closure and the OPENAI_BASE_URL ref is ASSERTED
  // prod→prod by the Stage-2 Ruby preflight (never copied).
  "starter-adk": {
    serviceId: "37691009-c0b2-4af7-8960-9f0b3f0a6be3",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-adk",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "cb23cae4-9555-4ddd-8a62-f1aa1ff72c67",
        healthcheckPath: "/",
        domain: "starter-adk-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "208a160a-0d7d-44b2-a94d-39e13b24e21a",
        healthcheckPath: "/",
        domain: "starter-adk-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-agno": {
    serviceId: "5ab3c37e-18a5-44e5-8329-26243dd98da8",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-agno",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "2f58513b-5fe4-4b09-a28f-93d4caa277b5",
        healthcheckPath: "/",
        domain: "starter-agno-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "9944eb97-7f58-47f8-a49d-65603e209609",
        healthcheckPath: "/",
        domain: "starter-agno-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-crewai-crews": {
    serviceId: "2a9a4230-e6cd-4c1d-92a5-36e5c624371a",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-crewai-crews",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "1a3e24cb-0752-45c8-b4a2-0c6096899875",
        healthcheckPath: "/",
        domain: "starter-crewai-crews-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "820895fb-f65c-4834-a07d-d454035d39c4",
        healthcheckPath: "/",
        domain: "starter-crewai-crews-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-langgraph-fastapi": {
    serviceId: "6ae57213-52ea-4fea-b4a0-7bc304cbc80e",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-langgraph-fastapi",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "0679bc18-e9af-40c6-bc17-0b5eb2cd7bec",
        healthcheckPath: "/",
        domain: "starter-langgraph-fastapi-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "5f10e976-e121-48a5-bc18-2619798f2f10",
        healthcheckPath: "/",
        domain: "starter-langgraph-fastapi-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-langgraph-js": {
    serviceId: "d044c3e5-bb27-4d5e-a2bf-e3b382981372",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-langgraph-js",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "50a2205b-8768-4765-b7a1-21941c105051",
        healthcheckPath: "/",
        domain: "starter-langgraph-js-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "43db83fe-fafb-445b-a19a-51bb086c71b9",
        healthcheckPath: "/",
        domain: "starter-langgraph-js-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-langgraph-python": {
    serviceId: "10dca514-7c8f-4a32-9708-9f29a944da36",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-langgraph-python",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "24dad599-576a-4154-a621-c3af40629a8f",
        healthcheckPath: "/",
        domain: "starter-langgraph-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "58105e79-4020-4692-8749-c1a63ab63f2c",
        healthcheckPath: "/",
        domain: "starter-langgraph-python-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-llamaindex": {
    serviceId: "3255b27f-ea84-44b7-b587-b1687b409363",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-llamaindex",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "c119f40b-dc71-4734-9716-c1085754b085",
        healthcheckPath: "/",
        domain: "starter-llamaindex-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "44446803-0505-456a-b0c4-01fe82fb3832",
        healthcheckPath: "/",
        domain: "starter-llamaindex-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-mastra": {
    serviceId: "6548403e-3fee-4443-9d59-d8b041a3d43a",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-mastra",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "c6fba6d8-8dde-442b-948f-560bf25fa2f1",
        healthcheckPath: "/",
        domain: "starter-mastra-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "b246e52d-52d8-4015-bb06-89bd09d54f8f",
        healthcheckPath: "/",
        domain: "starter-mastra-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-ms-agent-framework-dotnet": {
    serviceId: "1b4c5296-97f6-463d-90af-6e04d7919957",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-ms-agent-framework-dotnet",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "993237a4-9ee7-47b2-a5be-267e247c1409",
        healthcheckPath: "/",
        domain: "starter-ms-agent-framework-dotnet-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "6684c246-e8fd-45a7-86e4-c529a439976f",
        healthcheckPath: "/",
        domain: "starter-ms-agent-framework-dotnet-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-ms-agent-framework-python": {
    serviceId: "225d0a06-d1cd-4b82-ae9c-2d1e8ecbaf86",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-ms-agent-framework-python",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "aa934881-340a-4fb7-8b39-9cb0a6f372b2",
        healthcheckPath: "/",
        domain: "starter-ms-agent-framework-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "a162348a-f768-4c3f-815c-f617819f64e6",
        healthcheckPath: "/",
        domain: "starter-ms-agent-framework-python-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-pydantic-ai": {
    serviceId: "c01d0d24-af88-4631-8a9a-23cffef2b36a",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-pydantic-ai",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "74ce36fe-0b8f-446e-8e06-0b6496b6e829",
        healthcheckPath: "/",
        domain: "starter-pydantic-ai-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "25f4eb93-501a-4e5e-b7cf-343eb08ea613",
        healthcheckPath: "/",
        domain: "starter-pydantic-ai-staging.up.railway.app",
        probe: true,
      },
    },
  },
  "starter-strands-python": {
    serviceId: "321735ab-c14d-4e45-a1c2-e47f2b29d774",
    ciBuilt: true,
    gateValidated: true,
    dispatchName: "starter-strands-python",
    probeDriver: "starter",
    promoteTier: 2,
    runtimeDeps: ["aimock"],
    serviceRefs: [{ key: "OPENAI_BASE_URL", target: "aimock" }],
    environments: {
      prod: {
        instanceId: "4af440e0-ba05-48a5-b922-5b96a033891a",
        healthcheckPath: "/",
        domain: "starter-strands-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "adc24096-584a-4ef3-93de-0bc92d49235c",
        healthcheckPath: "/",
        domain: "starter-strands-python-staging.up.railway.app",
        probe: true,
      },
    },
  },
  webhooks: {
    serviceId: "ba6acc13-7585-41fe-a5ee-585b34a58fcd",
    ciBuilt: false,
    gateValidated: true,
    dispatchName: "webhooks",
    probeDriver: "webhooks",
    // Tier-0 shared infra (eval webhook relay): grouped with the other
    // cluster-wide infra so it settles before tier-1/2 promote.
    promoteTier: 0,
    // webhooks is a first-party ghcr.io/copilotkit/ image, but its
    // GHCR repo name is `showcase-eval-webhook` (NOT `webhooks`), and
    // it is built by a separate release workflow — not showcase_build.yml.
    // The dispatch_name entry exists so humans can redeploy/verify
    // webhooks from CI on demand; the build slot is no-op (skip_build).
    // NOTE: that no-op slot still reports build status "success", so
    // webhooks enters the redeploy CSV whenever its matrix slot is
    // selected — and MAY be bounced (Railway re-pulls its out-of-band
    // :latest) by BOTH a manual `service=all` build dispatch AND a push
    // that touches the build workflow files (the `workflow_config`
    // paths-filter disjunct selects EVERY slot, webhooks included).
    // Only an ordinary code push — one matching per-service paths
    // filters but not workflow_config — leaves webhooks untouched.
    environments: {
      prod: {
        instanceId: "d82ef5b4-3bfd-462e-9436-3d5dbca8681a",
        domain: "hooks.showcase.copilotkit.ai",
        probe: true,
        repoName: "showcase-eval-webhook",
      },
      staging: {
        instanceId: "450e87e0-aba5-4aba-afaf-15f4deab03f0",
        domain: "hooks.showcase.staging.copilotkit.ai",
        probe: true,
        repoName: "showcase-eval-webhook",
      },
    },
  },
};

/**
 * Own-property SERVICES lookup. Returns undefined for unknown service
 * names, INCLUDING inherited Object.prototype keys ("constructor",
 * "toString", "hasOwnProperty", …) which a bare `SERVICES[name]`
 * truthiness check would resolve to truthy non-entries. Every exported
 * accessor routes through this (or its throwing wrapper `getEntry`) so
 * the own-property semantics cannot drift per function.
 */
function findEntry(
  serviceName: string,
): (ServiceEntry & { dispatchName?: string }) | undefined {
  return Object.hasOwn(SERVICES, serviceName)
    ? SERVICES[serviceName]
    : undefined;
}

/** Own-property `entry.environments` lookup (same rationale as findEntry). */
function findEnvCfg(
  entry: ServiceEntry,
  env: EnvName,
): EnvironmentConfig | undefined {
  return Object.hasOwn(entry.environments, env)
    ? entry.environments[env]
    : undefined;
}

/** findEntry, throwing the curated unknown-service error when absent. */
function getEntry(
  serviceName: string,
): ServiceEntry & { dispatchName?: string } {
  const entry = findEntry(serviceName);
  if (entry === undefined) {
    throw new Error(
      `Unknown showcase service "${serviceName}". Add it to SERVICES in showcase/scripts/railway-envs.ts.`,
    );
  }
  return entry;
}

/** findEnvCfg, throwing the curated no-such-environment error when absent. */
function getEnvCfg(
  serviceName: string,
  entry: ServiceEntry,
  env: EnvName,
): EnvironmentConfig {
  const envCfg = findEnvCfg(entry, env);
  if (envCfg === undefined) {
    throw new Error(
      `Service "${serviceName}" has no "${env}" environment in the SSOT (envs: ${Object.keys(
        entry.environments,
      )
        .sort()
        .join(", ")}).`,
    );
  }
  return envCfg;
}

/**
 * The env names present in a service's `environments` map. Returns a sorted
 * copy so callers get deterministic order regardless of literal order.
 * Throws on unknown service (fail loud).
 */
export function envsFor(serviceName: string): EnvName[] {
  return Object.keys(getEntry(serviceName).environments).sort();
}

/**
 * Every (serviceName, env) pair across the whole SSOT, sorted by service
 * name then env name. Intended as the canonical iteration helper for any
 * consumer that must visit every env-scoped instance without hardcoding
 * ["prod","staging"] — NOT YET CONSUMED by any caller (the image-ref gate
 * iterates each entry's `environments` directly); kept exported so new
 * exhaustive-iteration consumers reach for it instead of reinventing it.
 */
export function serviceEnvPairs(): Array<{ name: string; env: EnvName }> {
  const pairs: Array<{ name: string; env: EnvName }> = [];
  for (const name of Object.keys(SERVICES).sort()) {
    for (const env of Object.keys(SERVICES[name].environments).sort()) {
      pairs.push({ name, env });
    }
  }
  return pairs;
}

export function instanceIdFor(serviceName: string, env: EnvName): string {
  return getEnvCfg(serviceName, getEntry(serviceName), env).instanceId;
}

export function listServiceNames(): string[] {
  return Object.keys(SERVICES).sort();
}

/**
 * The subset of SERVICES that `showcase_build.yml` actually builds and
 * pushes. Excludes `webhooks` (released by its own repo's workflow) AND
 * the non-CI-built `harness-workers` (consumes the shared showcase-harness
 * image via imageOf; no build slot of its own). pocketbase
 * IS CI-built (its matrix slot is gated to `showcase/pocketbase/**`
 * changes). Default target set for `redeploy-env.ts <env>` when no
 * explicit `--services` list is provided — though the actual default
 * redeploy scope is this set PLUS any `imageOf` consumers that declare
 * the target env (e.g. staging adds harness-workers).
 */
export const CI_BUILT_SERVICES: ReadonlySet<string> = new Set(
  Object.entries(SERVICES)
    .filter(([, entry]) => entry.ciBuilt)
    .map(([name]) => name),
);

/**
 * Resolve the expected GHCR repo name for a (serviceName, env) pair.
 * Exported so callers (verify-railway-image-refs.ts) and unit tests can
 * exercise override resolution directly.
 *
 * Resolution: the per-env `repoName` override when the service declares
 * `env` and sets one; otherwise the service name verbatim (the documented
 * default for services whose GHCR repo matches their Railway name).
 *
 * Fail-loud, consistent with instanceIdFor/domainFor — a silently wrong
 * GHCR name is exactly the drift class the image-ref gate exists to catch:
 *   - THROWS on an unknown service;
 *   - THROWS on an env name not registered in ENV_ID_BY_NAME (unnormalized
 *     synonyms like "production" must go through resolveEnv first);
 *   - THROWS on a registered env the service does not declare (e.g. the
 *     staging-only harness-workers asked for prod — its repo everywhere
 *     is showcase-harness, so echoing the service name would be wrong).
 */
export function repoNameFor(serviceName: string, env: EnvName): string {
  const entry = getEntry(serviceName);
  // Stricter than the other accessors (unchanged behavior): repoNameFor
  // also rejects env names that are not registered SSOT env keys, so
  // unnormalized synonyms ("production") fail loud before the per-service
  // env lookup.
  if (!Object.hasOwn(ENV_ID_BY_NAME, env)) {
    throw new Error(
      `Unknown env "${String(env)}" — repoNameFor requires a normalized SSOT env key (one of: ${Object.keys(ENV_ID_BY_NAME).join(", ")}). Synonyms like "production" must be normalized via resolveEnv() first.`,
    );
  }
  return getEnvCfg(serviceName, entry, env).repoName ?? serviceName;
}

/**
 * Resolve the public host (no scheme) for a (serviceName, env) pair.
 *
 * THROWS on unknown service. THROWS on an env the service does not have.
 * THROWS on a missing/scheme-bearing domain. Never returns "" — the verify
 * probe and any consumer reading from the SSOT must fail loud, not silently
 * probe an empty domain.
 *
 * Use this from verify-deploy.ts, from any TS caller that needs the URL,
 * and from the JSON artifact emitter that the Ruby side consumes.
 */
export function domainFor(serviceName: string, env: EnvName): string {
  const envCfg = getEnvCfg(serviceName, getEntry(serviceName), env);
  const host = envCfg.domain;
  if (!host || host.includes("://")) {
    // Defense-in-depth: SERVICES population is asserted by the
    // railway-envs.test.ts schema check, but if a future contributor
    // ships a scheme-included literal or omits the host this catches it
    // at first use instead of returning a malformed value. We test for
    // the scheme separator `://` rather than `startsWith("http")` so we
    // don't false-reject legitimate hosts whose name happens to begin
    // with the letters "http" (e.g. `httpd-…`, `httpbin…`).
    throw new Error(
      `Service "${serviceName}" has malformed/missing ${env} domain ("${host ?? ""}").`,
    );
  }
  return host;
}

/**
 * Whether `verify-deploy --env <env>` should probe this (serviceName, env)
 * pair. False when the service has no such env, or the env config sets
 * `probe: false`. Defaults to `true` when the env exists and `probe` is
 * omitted (the historic default). Returns false (rather than throwing) on
 * unknown service AND on an undeclared env so callers can treat "not
 * probe-eligible" uniformly — including for inherited Object.prototype
 * keys on either axis (the own-property lookups below return undefined
 * for those, never a truthy non-entry that would default to `true`).
 */
export function probeEnabled(serviceName: string, env: EnvName): boolean {
  const entry = findEntry(serviceName);
  if (entry === undefined) return false;
  const envCfg = findEnvCfg(entry, env);
  if (envCfg === undefined) return false;
  return envCfg.probe ?? true;
}

/**
 * Resolve the Railway HTTP healthcheck path for a (serviceName, env) pair, or
 * `undefined` when none is tracked. Returns undefined (rather than throwing)
 * on unknown service AND on an undeclared env — mirroring `probeEnabled` —
 * because absence is LEGAL and semantically meaningful: it means "leave the
 * Railway default (null); do not assert any path." Callers MUST treat
 * undefined as "omit the field" (never coerce to a literal path) — the promote
 * pin sends `healthcheckPath` to Railway only when this returns a value, so a
 * live-null service is never accidentally cleared OR set to a wrong path.
 */
export function healthcheckPathFor(
  serviceName: string,
  env: EnvName,
): string | undefined {
  const entry = findEntry(serviceName);
  if (entry === undefined) return undefined;
  const envCfg = findEnvCfg(entry, env);
  if (envCfg === undefined) return undefined;
  return envCfg.healthcheckPath;
}

/**
 * Whether `serviceName` is a tracked SSOT entry. Uses the same own-property
 * semantics as {@link findEntry} (so inherited Object.prototype keys are NOT
 * counted as members). Callers need this to disambiguate the two reasons
 * {@link healthcheckPathFor} returns undefined: a service that is NOT in the
 * SSOT at all (brand-new/unknown) versus a TRACKED service that deliberately
 * has a null/omitted healthcheckPath (dashboard, docs, dojo, webhooks,
 * pocketbase). The former may take an agent-class default; the latter must
 * NOT have a healthcheck forced onto it (doing so wedges the deploy — the
 * `/api/health` 404 incident).
 */
export function isTrackedService(serviceName: string): boolean {
  return findEntry(serviceName) !== undefined;
}

/**
 * Resolve the `WorkerProvisioning` record for a (serviceName, env) pair, or
 * `undefined` when the service declares no `workerProvisioning` or has no
 * entry for the given env. Returns undefined (rather than throwing) on unknown
 * service, missing field, or undeclared env — the caller decides whether absence
 * is an error (the drift-gate test requires it to be non-null for
 * `harness-workers`).
 *
 * Only `harness-workers` carries this field today. Use it to read the
 * authoritative `numReplicas` and `BROWSER_POOL_MAX_CONTEXTS` for a given env.
 */
export function workerProvisioningFor(
  serviceName: string,
  env: "prod" | "staging",
): WorkerProvisioning | undefined {
  const entry = findEntry(serviceName);
  if (entry === undefined) return undefined;
  return entry.workerProvisioning?.[env];
}

/**
 * Resolve a `showcase_build.yml` `dispatch_name` (e.g. `mastra`,
 * `shell-dashboard`, `showcase-aimock`) to the canonical SSOT key
 * (e.g. `showcase-mastra`, `dashboard`, `aimock`). Returns undefined
 * when no SSOT entry carries this dispatchName. Note this does NO ciBuilt
 * filtering: any SSOT entry with a matching dispatchName resolves,
 * CI-built or not (e.g. the non-CI-built `webhooks` resolves — that is
 * what lets a human redeploy it on demand via --services).
 */
export function serviceForDispatchName(
  dispatchName: string,
): string | undefined {
  for (const [name, entry] of Object.entries(SERVICES)) {
    if (entry.dispatchName === dispatchName) return name;
  }
  return undefined;
}

/** One promotable member of a {@link ClosurePlan}, carrying its tier. */
export interface ClosureMember {
  /** Canonical SSOT key. */
  name: string;
  /** Promote tier (0 infra → 1 verification → 2 leaf). */
  tier: 0 | 1 | 2;
  /**
   * Standalone service (see {@link ClosureEntry.standalone}): promoted ungated
   * and never pulls the Tier-1 verification set into its own closure. Only set
   * (to `true`) on standalone members so the emitted JSON stays minimal.
   */
  standalone?: boolean;
}

/** A member excluded from the promotable set, with an explicit reason. */
export interface ClosureSkip {
  /** Canonical SSOT key. */
  name: string;
  /** Human-readable reason this member is not promoted (never silent). */
  reason: string;
}

/**
 * The tier-ordered promote plan computed by {@link computePromoteClosure}:
 * the `services` an equivalence-gated promote should pin+verify (tier 0→1→2)
 * plus the `skipped` members that were pulled into the closure but cannot be
 * promoted today (e.g. a member with no `prod` env), each with an explicit
 * reason so the exclusion is visible (§4.3 — never silent).
 */
export interface ClosurePlan {
  /** Tier-ordered (0→1→2) list of promotable services. */
  services: ClosureMember[];
  /** Closure members excluded from `services`, each with a reason. */
  skipped: ClosureSkip[];
}

/**
 * The promote tiers, lowest-first. The promote loop (U4) iterates the
 * closure in this order; a tier gates its dependents.
 */
const PROMOTE_TIERS: readonly (0 | 1 | 2)[] = [0, 1, 2];

/** Structural view of a {@link ServiceEntry} the closure math needs. */
type ClosureEntry = {
  promoteTier?: 0 | 1 | 2;
  runtimeDeps?: string[];
  imageOf?: string;
  gateIgnore?: boolean;
  standalone?: boolean;
  environments?: Record<string, unknown>;
};

/** The effective tier of an entry: declared `promoteTier`, default 2. */
function tierOf(entry: ClosureEntry): 0 | 1 | 2 {
  return entry.promoteTier ?? 2;
}

/**
 * Compute the tier-ordered promote closure for `requested` (SSOT keys OR
 * `showcase_build.yml` dispatch_names — resolved the same way
 * `resolveTargetServices` does). PURE: reads the SSOT, returns a plan, never
 * mutates anything.
 *
 * The closure is (§4.2):
 *   requested
 *     ∪ transitive `runtimeDeps` (each member's runtime deps, recursively)
 *     ∪ the FULL Tier-1 verification set (ALWAYS — an equivalence-gated
 *       promote re-sweeps on the just-promoted harness and reads via the
 *       dashboard, so the control plane must itself be current)
 *     ∪ explicit `imageOf` consumers of any member.
 *
 * NOTE the promote path does NOT inherit the staging-redeploy `imageOf`
 * EXPANSION wholesale — it pulls a consumer in only because that consumer
 * runs a closure member's image and would otherwise run a stale image after
 * the member is pinned (§4.2). A member whose `environments`
 * omits `prod` (e.g. `harness-workers` today, §4.4) cannot be promoted and is
 * recorded in `skipped` with a reason rather than silently dropped (§4.3).
 *
 * Throws (fail loud) on a requested name that resolves to no SSOT entry.
 *
 * Accepts an injected map for testing; defaults to the real SERVICES map.
 */
export function computePromoteClosure(
  requested: string[],
  services: Record<string, ClosureEntry & { dispatchName?: string }> = SERVICES,
): ClosurePlan {
  // 1) Resolve requested names → SSOT keys (own-key first, then dispatchName),
  //    mirroring resolveTargetServices. Fail loud on an unknown name.
  const closure = new Set<string>();
  const resolveKey = (raw: string): string => {
    const name = raw.trim();
    if (Object.hasOwn(services, name)) return name;
    for (const [key, entry] of Object.entries(services)) {
      if (entry.dispatchName === name) return key;
    }
    throw new Error(
      `computePromoteClosure: unknown service "${raw}" — not an SSOT key or dispatch_name in railway-envs.ts.`,
    );
  };
  for (const raw of requested) {
    if (raw.trim() === "") continue;
    closure.add(resolveKey(raw));
  }

  // A promote whose REQUESTED set is ENTIRELY standalone services pulls in NO
  // Tier-1 verification set: a standalone leaf (e.g. `docs`) is self-contained
  // and depends on nothing, so promoting it alone must promote ONLY itself, not
  // the whole control plane. A mixed or `all` request still forces Tier-1 below.
  const requestedKeys = [...closure];
  const allStandalone =
    requestedKeys.length > 0 &&
    requestedKeys.every((k) => services[k]?.standalone === true);

  // 2) Include the full Tier-1 verification set (the control plane + dashboard
  //    the post-promote re-sweep / equivalence read run against) — UNLESS the
  //    request is entirely standalone (a standalone leaf needs no control plane).
  if (!allStandalone) {
    for (const [key, entry] of Object.entries(services)) {
      if (tierOf(entry) === 1) closure.add(key);
    }
  }

  // 3) Transitive runtimeDeps closure (BFS). Every dep must be a real key —
  //    a dangling dep is caught by assertClosureValid, but guard here too so
  //    the pure function never dereferences a non-entry.
  const queue = [...closure];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    const entry = Object.hasOwn(services, key) ? services[key] : undefined;
    if (entry === undefined) continue;
    for (const dep of entry.runtimeDeps ?? []) {
      if (!closure.has(dep) && Object.hasOwn(services, dep)) {
        closure.add(dep);
        queue.push(dep);
      }
    }
  }

  // 4) Explicit imageOf consumers of any closure member (pull, do not inherit
  //    the staging-redeploy env-aware expansion wholesale — §4.2).
  for (const [consumer, entry] of Object.entries(services)) {
    const target = entry.imageOf;
    if (target !== undefined && closure.has(target)) closure.add(consumer);
  }

  // 5) Partition into promotable (tier-ordered) vs skipped-with-reason.
  const promotable: ClosureMember[] = [];
  const skipped: ClosureSkip[] = [];
  for (const key of closure) {
    const entry = services[key];
    // No prod env → cannot be promoted (the staging-only worker today).
    const envs = entry.environments ?? {};
    if (!Object.hasOwn(envs, "prod")) {
      skipped.push({
        name: key,
        reason: `no "prod" environment in the SSOT — cannot be promoted (it exists in: ${
          Object.keys(envs).sort().join(", ") || "no environments"
        }).`,
      });
      continue;
    }
    promotable.push({
      name: key,
      tier: tierOf(entry),
      ...(entry.standalone === true ? { standalone: true } : {}),
    });
  }

  // Tier-ordered (0→1→2), stable within a tier on insertion order.
  const services_ordered: ClosureMember[] = [];
  for (const tier of PROMOTE_TIERS) {
    for (const m of promotable) {
      if (m.tier === tier) services_ordered.push(m);
    }
  }

  return { services: services_ordered, skipped };
}

/**
 * Throw on SSOT load (or in a test with injected input) if the promote
 * closure is malformed (§4.5), MIRRORING `assertImageConsumersValid`:
 *   - a member's `runtimeDeps` / `serviceRefs.target` names a non-existent
 *     SSOT key (a dangling dep would silently never be promoted);
 *   - the SSOT carries NO Tier-1 verification service (an equivalence-gated
 *     promote with no control plane to re-sweep on is meaningless);
 *   - the computed closure is EMPTY (refusing to silently promote nothing).
 *
 * `requested` defaults to the full set of declared dispatch_names so the
 * module-load check exercises the real, fully-populated closure. Accepts an
 * injected map for testing; defaults to the real SERVICES map.
 */
export function assertClosureValid(
  requested: string[] = Object.keys(SERVICES),
  services: Record<string, ClosureEntry & { dispatchName?: string }> = SERVICES,
): void {
  const problems: string[] = [];

  // Dangling runtimeDeps / serviceRefs targets.
  for (const [key, entry] of Object.entries(services)) {
    for (const dep of entry.runtimeDeps ?? []) {
      if (!Object.hasOwn(services, dep)) {
        problems.push(
          `  - runtimeDeps "${dep}" on "${key}" is not an SSOT key in SERVICES`,
        );
      }
    }
    const refs = (entry as { serviceRefs?: { target: string }[] }).serviceRefs;
    for (const ref of refs ?? []) {
      if (!Object.hasOwn(services, ref.target)) {
        problems.push(
          `  - serviceRefs target "${ref.target}" on "${key}" is not an SSOT key in SERVICES`,
        );
      }
    }
  }

  // The SSOT must declare at least one Tier-1 verification service.
  const hasTier1 = Object.values(services).some((e) => tierOf(e) === 1);
  if (!hasTier1) {
    problems.push(
      `  - no Tier-1 verification service (promoteTier:1) in SERVICES — an equivalence-gated promote has no control plane to re-sweep on`,
    );
  }

  // The computed closure must be non-empty. Skip this clause when the
  // dangling-dep / missing-Tier-1 problems above already fired, since
  // computePromoteClosure would throw on an unknown requested name before we
  // could surface the curated message.
  if (problems.length === 0) {
    let plan: ClosurePlan | undefined;
    try {
      plan = computePromoteClosure(requested, services);
    } catch (err) {
      problems.push(`  - computePromoteClosure threw: ${String(err)}`);
    }
    if (plan !== undefined && plan.services.length === 0) {
      problems.push(
        `  - the computed promote closure is EMPTY — refusing to silently promote nothing`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `railway-envs promote-closure invariant violated:\n${problems.join(
        "\n",
      )}\n` +
        `Fix: every runtimeDeps / serviceRefs target must be an existing ` +
        `SSOT key, the SSOT must declare at least one Tier-1 (promoteTier:1) ` +
        `service, and the computed closure must be non-empty.`,
    );
  }
}

/**
 * Throw on SSOT load if any two services share the same `dispatchName`,
 * or if a service's `dispatchName` equals a DIFFERENT entry's SSOT key.
 * `serviceForDispatchName` iterates `Object.entries(SERVICES)` and returns
 * the first match — a silent collision would route redeploys to the wrong
 * service. The cross-key case is the same trap from the other direction:
 * resolveTargetServices checks SSOT keys BEFORE dispatch_names, so a
 * dispatchName shadowed by another entry's key silently misroutes to that
 * other entry. A dispatchName equal to its OWN key (e.g. shell, webhooks)
 * is legal — both lookups land on the same entry. We fail loud at module
 * load instead.
 *
 * Accepts an injected map for testing; defaults to the real SERVICES map.
 */
export function assertDispatchNamesUnique(
  services: Record<string, { dispatchName?: string }> = SERVICES,
): void {
  const seen = new Map<string, string>(); // dispatchName -> first ssotKey
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(services)) {
    const dn = entry.dispatchName;
    if (typeof dn !== "string" || dn.length === 0) continue;
    const prior = seen.get(dn);
    if (prior !== undefined) {
      problems.push(
        `  - duplicate dispatchName "${dn}" on SSOT keys: ${prior}, ${key}`,
      );
    } else {
      seen.set(dn, key);
    }
    // Own-property lookup (same rationale as elsewhere in this file): an
    // inherited Object.prototype key must not register as a collision.
    if (dn !== key && Object.hasOwn(services, dn)) {
      problems.push(
        `  - dispatchName "${dn}" on SSOT key "${key}" equals a DIFFERENT entry's SSOT key — resolveTargetServices resolves SSOT keys first, so this dispatch_name would silently misroute to "${dn}"`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `railway-envs SSOT invariant violated:\n${problems.join("\n")}\n` +
        `Fix: each Railway service must have a unique dispatchName that ` +
        `does not collide with another entry's SSOT key ` +
        `(or no dispatchName at all for out-of-band services).`,
    );
  }
}

/**
 * Throw on SSOT load if any `imageOf` is mis-wired. A dangling target,
 * a target without a build slot, an imageOf on a build slot, or a consumer
 * env the producer never builds for would each silently break the
 * "rebuilt image redeploys ALL its consumers" contract in
 * `redeploy-env.ts` — fail loud at module load instead (same style as
 * `assertDispatchNamesUnique`).
 *
 * Accepts an injected map for testing; defaults to the real SERVICES map.
 */
export function assertImageConsumersValid(
  services: Record<
    string,
    {
      ciBuilt: boolean;
      imageOf?: string;
      environments?: Record<string, unknown>;
    }
  > = SERVICES,
): void {
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(services)) {
    const target = entry.imageOf;
    if (target === undefined) continue;
    if (entry.ciBuilt) {
      problems.push(
        `  - "${key}" is ciBuilt but declares imageOf "${target}" — a build slot is its own image producer; drop one of the two`,
      );
      continue;
    }
    // Own-property lookup: a bare `services[target]` truthiness check
    // would resolve inherited Object.prototype keys (e.g. imageOf:
    // "toString") to a truthy non-entry and misreport the dangling target.
    if (!Object.hasOwn(services, target)) {
      problems.push(
        `  - imageOf "${target}" on "${key}" is not an SSOT key in SERVICES`,
      );
      continue;
    }
    const targetEntry = services[target];
    if (!targetEntry.ciBuilt) {
      problems.push(
        `  - imageOf "${target}" on "${key}" points at a service that is not ciBuilt — only showcase_build.yml build slots can have image consumers`,
      );
      continue;
    }
    // A consumer with ZERO declared environments passes the env-subset
    // check below vacuously — but a consumer that exists in no env is a
    // service the redeploy expansion can never reach (expandImageConsumers
    // filters on `environments[env]`), i.e. a silently never-redeployed
    // service. Reject it loudly.
    const consumerEnvs = Object.keys(entry.environments ?? {});
    if (consumerEnvs.length === 0) {
      problems.push(
        `  - "${key}" declares imageOf "${target}" but ZERO environments — the env-subset check passes vacuously and the consumer would never be redeployed in any env`,
      );
      continue;
    }
    // Env overlap: every env the consumer declares must also be one the
    // producer builds for. A consumer-only env would run an image that no
    // CI build ever refreshes there — a silently never-updating service,
    // the exact stale-image failure this invariant exists to prevent.
    const producerEnvs = targetEntry.environments ?? {};
    for (const env of consumerEnvs) {
      if (!Object.hasOwn(producerEnvs, env)) {
        problems.push(
          `  - "${key}" declares env "${env}" but its imageOf "${target}" has no "${env}" environment — "${key}" would run a never-rebuilt image there`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `railway-envs SSOT invariant violated:\n${problems.join("\n")}\n` +
        `Fix: imageOf must name an existing, ciBuilt SSOT key, may only ` +
        `appear on a non-ciBuilt consumer, and the consumer's declared ` +
        `environments must be a non-empty subset of its producer's.`,
    );
  }
}

/**
 * Throw on SSOT load if the env registries and the per-service
 * `environments` maps disagree (same style as `assertDispatchNamesUnique`):
 *
 *   (i)   every key of every `entry.environments` must be a canonical env
 *         name registered in ENV_ID_BY_NAME — an unregistered key is an env
 *         no accessor or redeploy path can ever resolve (a silently
 *         unreachable env config);
 *   (ii)  ENV_ID_BY_NAME env-ids must be unique — resolveEnv resolves the
 *         FIRST canonical name carrying an env-id, so a duplicate silently
 *         shadows the second name;
 *   (iii) every ENV_ID_BY_NAME canonical name must have at least one
 *         ENV_IDS spelling — a canonical name no spelling maps to can never
 *         be produced by resolveEnv (a registered-but-unnameable env);
 *   (iv)  a key present in BOTH registries must carry the SAME env-id in
 *         both — without this, ENV_IDS.prod drifting to the staging id
 *         passes every other clause while resolveEnv("prod") silently
 *         returns staging (a cross-wired redeploy target);
 *   (v)   every ENV_IDS env-id must be carried by some ENV_ID_BY_NAME
 *         canonical name — an orphan spelling is otherwise rejected only
 *         lazily inside resolveEnv, at call time, for the one spelling an
 *         operator happens to type;
 *   (vi)  every key of both registries must equal its own
 *         trim().toLowerCase() — resolveEnv lowercases its input before
 *         the own-key lookup, so a non-normalized spelling is registered
 *         but unreachable;
 *   (vii) no key of either registry may be an Object.prototype property
 *         name ("constructor", "toString", …) — a prototype-named env
 *         defeats the own-property lookup discipline used throughout this
 *         file and redeploy-env.ts.
 *
 * Accepts injected maps for testing; defaults to the real registries.
 */
export function assertEnvRegistryConsistent(
  services: Record<
    string,
    { environments?: Record<string, unknown> }
  > = SERVICES,
  envIdByName: Record<string, string> = ENV_ID_BY_NAME,
  envIds: Record<string, string> = ENV_IDS,
): void {
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(services)) {
    for (const env of Object.keys(entry.environments ?? {})) {
      if (!Object.hasOwn(envIdByName, env)) {
        problems.push(
          `  - service "${key}" declares env "${env}", which is not a canonical env name in ENV_ID_BY_NAME — no accessor or redeploy path could ever resolve it`,
        );
      }
    }
  }
  const byId = new Map<string, string>(); // env-id -> first canonical name
  for (const [name, id] of Object.entries(envIdByName)) {
    const prior = byId.get(id);
    if (prior !== undefined) {
      problems.push(
        `  - duplicate env-id "${id}" in ENV_ID_BY_NAME (canonical names: ${prior}, ${name}) — resolveEnv resolves the FIRST name, silently shadowing the second`,
      );
    } else {
      byId.set(id, name);
    }
  }
  const spelledIds = new Set(Object.values(envIds));
  for (const [name, id] of Object.entries(envIdByName)) {
    if (!spelledIds.has(id)) {
      problems.push(
        `  - canonical env "${name}" (env-id "${id}") has no ENV_IDS spelling — resolveEnv can never produce it; register at least its own name in ENV_IDS`,
      );
    }
  }
  // (iv) Cross-wire: a key in BOTH registries must carry the SAME env-id.
  for (const [key, id] of Object.entries(envIds)) {
    if (Object.hasOwn(envIdByName, key) && envIdByName[key] !== id) {
      problems.push(
        `  - cross-wired env "${key}": ENV_IDS maps it to "${id}" but ENV_ID_BY_NAME maps it to "${envIdByName[key]}" — resolveEnv("${key}") would silently resolve to the OTHER env`,
      );
    }
  }
  // (v) Orphan spelling: every ENV_IDS env-id must have a canonical name.
  const canonicalIds = new Set(Object.values(envIdByName));
  for (const [spelling, id] of Object.entries(envIds)) {
    if (!canonicalIds.has(id)) {
      problems.push(
        `  - orphan ENV_IDS spelling "${spelling}": its env-id "${id}" is carried by no ENV_ID_BY_NAME canonical name — resolveEnv would reject it only lazily at call time`,
      );
    }
  }
  // (vi)+(vii) Key hygiene on both registries: lowercase-normalized and
  // never an Object.prototype property name.
  const protoNames = new Set(Object.getOwnPropertyNames(Object.prototype));
  const registries: Array<[string, Record<string, string>]> = [
    ["ENV_IDS", envIds],
    ["ENV_ID_BY_NAME", envIdByName],
  ];
  for (const [registryName, registry] of registries) {
    for (const key of Object.keys(registry)) {
      if (key !== key.trim().toLowerCase()) {
        problems.push(
          `  - ${registryName} key "${key}" is not trim().toLowerCase()-normalized — resolveEnv lowercases its input, so this spelling is registered but unreachable`,
        );
      }
      if (protoNames.has(key)) {
        problems.push(
          `  - ${registryName} key "${key}" is an Object.prototype property name — a prototype-named env defeats own-property lookups; pick a different name`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `railway-envs SSOT invariant violated:\n${problems.join("\n")}\n` +
        `Fix: keep ENV_IDS (accepted spellings), ENV_ID_BY_NAME (canonical ` +
        `names) and each service's environments keys mutually consistent.`,
    );
  }
}

/**
 * Throw on SSOT load if any Railway ID is duplicated: a `serviceId` shared
 * by two SSOT entries, or an env-scoped `instanceId` shared by any two env
 * configs ANYWHERE in the map (instance IDs are globally unique on
 * Railway). A duplicated ID means a redeploy/verify of one service would
 * silently hit another — fail loud at module load instead (same style as
 * `assertDispatchNamesUnique`).
 *
 * Accepts an injected map for testing; defaults to the real SERVICES map.
 */
export function assertServiceAndInstanceIdsUnique(
  services: Record<
    string,
    {
      serviceId: string;
      environments?: Record<string, { instanceId?: string }>;
    }
  > = SERVICES,
): void {
  const problems: string[] = [];
  const serviceIdOwners = new Map<string, string>(); // serviceId -> ssotKey
  const instanceIdOwners = new Map<string, string>(); // instanceId -> "key.env"
  for (const [key, entry] of Object.entries(services)) {
    const priorService = serviceIdOwners.get(entry.serviceId);
    if (priorService !== undefined) {
      problems.push(
        `  - duplicate serviceId "${entry.serviceId}" on SSOT keys: ${priorService}, ${key}`,
      );
    } else {
      serviceIdOwners.set(entry.serviceId, key);
    }
    for (const [env, cfg] of Object.entries(entry.environments ?? {})) {
      const instanceId = cfg?.instanceId;
      if (instanceId === undefined) continue;
      const where = `${key}.${env}`;
      const prior = instanceIdOwners.get(instanceId);
      if (prior !== undefined) {
        problems.push(
          `  - duplicate instanceId "${instanceId}" (env configs: ${prior}, ${where}) — a redeploy/verify of one would silently hit the other`,
        );
      } else {
        instanceIdOwners.set(instanceId, where);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `railway-envs SSOT invariant violated:\n${problems.join("\n")}\n` +
        `Fix: every Railway serviceId must appear on exactly one SSOT entry ` +
        `and every env-scoped instanceId must be globally unique.`,
    );
  }
}

// Module-load assertions: fail any importer if the SSOT drifts into a
// collision, a mis-wired image consumer, an inconsistent env registry, or
// a duplicated Railway ID. Tests that exercise the invariants with
// synthetic input call the assert functions directly.
assertDispatchNamesUnique();
assertImageConsumersValid();
assertEnvRegistryConsistent();
assertServiceAndInstanceIdsUnique();
assertClosureValid();
