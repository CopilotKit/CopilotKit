/**
 * railway-envs.ts — Single source of truth for Railway IDs used by all
 * TypeScript showcase tooling. Mirrors (but does not import) the IDs in
 * `showcase/bin/railway` (Ruby). When these drift, prefer this file as
 * the TS-side canonical source and reconcile bin/railway by hand.
 *
 * - PROJECT_ID is the CopilotKit Showcase Railway project.
 * - ENV_IDS maps human env names (and common synonyms) to Railway env IDs.
 * - SERVICES is the per-service map of serviceId + a per-env `environments`
 *   record. Each environment carries its own serviceInstance ID, public
 *   domain (optional — domainless workers omit it), probe flag, and GHCR
 *   repo-name override (optional).
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
 * as `environments` keys (NOT the synonyms). Accessors that need the Railway
 * env-id for an arbitrary env name resolve it here. Extend this (and add the
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
  | "agent";

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
 */
export interface EnvironmentConfig {
  /** env-scoped Railway serviceInstance ID. */
  instanceId: string;
  /** Public host (no scheme). Omitted for domainless workers. */
  domain?: string;
  /** Probe this env in verify-deploy? Defaults to true when omitted. */
  probe?: boolean;
  /** Per-env GHCR repo-name override. Defaults to the service name. */
  repoName?: string;
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
   * pocketbase and webhooks are first-party GHCR images but are built
   * by their own repos' release workflows — they MUST NOT be touched
   * by the showcase build's staging redeploy step.
   */
  ciBuilt: boolean;
  /**
   * True iff `verify-railway-image-refs.ts` validates this service's
   * image refs. As of WS-C completion this is `true` for every service
   * in `SERVICES` — the historic Phase-2 deferral on dashboard, docs,
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
   *   - the consumer's declared `environments` must be a subset of its
   *     `imageOf` producer's environments (a consumer env the producer
   *     never builds for would run a never-rebuilt image there).
   *
   * The expansion is env-aware: a consumer only enters an env's redeploy
   * scope if it declares that env (the staging-only worker never enters
   * the prod scope). Omit for any service with its own build slot or a
   * pinned/out-of-band image (e.g. `harness-legacy`, which deliberately
   * runs a pinned pre-fleet digest and must NOT follow rebuilds).
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
   *     borrowed control-plane host). The Ruby parity test rejects
   *     `.up.railway.app` hosts and resolve-verify-matrix filters on
   *     `probe.staging===true`, so neither consumer is affected by these
   *     placeholder hosts — they exist only to preserve the JSON shape.
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
        domain: "showcase-aimock-production.up.railway.app",
        probe: true,
        repoName: "showcase-aimock",
      },
      staging: {
        instanceId: "9f260dfd-d9d4-43e9-98fe-49696f87fe50",
        domain: "aimock-staging.up.railway.app",
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
    // Railway service name is `harness`; GHCR repo is `showcase-harness`.
    // ciBuilt: true, gateValidated: true — uniform with the rest of
    // the CI-built integrations now that WS-C has flipped the five.
    environments: {
      prod: {
        instanceId: "05fbcdf2-8a50-4b71-b4f6-c92c4b17e626",
        domain: "showcase-harness-production.up.railway.app",
        probe: true,
        repoName: "showcase-harness",
      },
      staging: {
        instanceId: "0811f68f-fac4-440e-a350-3a7ca5855b80",
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
    // STAGING-ONLY worker (pool-fleet cutover). There is no prod
    // serviceInstance — the pool-fleet runs in staging only for now. Under
    // the env-map schema we simply OMIT the prod key (no placeholder ID is
    // needed). gateIgnore skips both gate directions; ciBuilt:false because
    // the worker has no build slot of its own — but `imageOf: "harness"`
    // (below) puts it in the staging redeploy scope whenever the shared
    // showcase-harness image is rebuilt. If/when a prod worker is
    // provisioned, add a `prod` env entry and flip gateIgnore off (the
    // imageOf expansion is env-aware and will start covering prod
    // automatically once the prod env entry exists).
    ciBuilt: false,
    // gateIgnore: deliberately-untracked for the image-ref gate. The
    // worker is staging-only and domainless (it pulls jobs from the
    // control-plane queue rather than serving HTTP), so it does not fit the
    // symmetric dual-env / public-domain shape the gate validates. Listing
    // it here (with gateIgnore) is what clears the "untracked Railway
    // service" failure — findUntrackedServices treats any SSOT entry as
    // known — WITHOUT triggering a false "missing from prod" failure from
    // findMissingServices (which only checks gateValidated:true entries).
    gateValidated: false,
    gateIgnore: true,
    probeDriver: "harness",
    // The worker runs the SAME `showcase-harness` GHCR image that the
    // existing `harness` (control-plane) service runs — it is NOT a
    // separately-built image. The single `showcase-harness` build slot in
    // showcase_build.yml produces the image both services consume; there is
    // no `harness-workers` build slot. Hence ciBuilt:false, with the
    // consumption modeled explicitly via imageOf so the staging redeploy
    // after a successful `showcase-harness` build bounces the worker too
    // (it used to be silently skipped, leaving it on the stale image). The
    // repoName override points at `showcase-harness` so the image-ref shape
    // resolves correctly if the gate ever validates it.
    imageOf: "harness",
    //
    // No public domain (queue worker, not HTTP-exposed) and probe disabled:
    // verify-deploy skips probe:false services, and the schema no longer
    // requires a domain, so we OMIT it rather than point at a borrowed host.
    environments: {
      staging: {
        instanceId: "362c1e37-5f40-45f2-ac7b-0e5adac565f8",
        probe: false,
        repoName: "showcase-harness",
      },
    },
    // Ruby/jq JSON-shape compat (see ServiceEntry.legacyJsonCompat). The
    // emitter fills the absent prod env's prodInstanceId from serviceId and
    // both domains from the legacy borrowed control-plane harness hosts so
    // the generated JSON stays byte-identical. None of these are read by TS.
    legacyJsonCompat: {
      domains: {
        prod: "showcase-harness-production.up.railway.app",
        staging: "harness-staging-2ee4.up.railway.app",
      },
      // The absent prod env carried a placeholder repoName in the legacy
      // JSON; restore it so repoNameOverride stays {prod, staging}.
      repoNameOverride: { prod: "showcase-harness" },
    },
  },
  "harness-legacy": {
    serviceId: "11279eba-97eb-417e-82a5-7cb4254eb147",
    // INTERIM service (fleet-migration bridge). This is the legacy all-probe
    // harness (HARNESS_ROLE unset) stood up to keep the non-d6 probe coverage
    // live while the pool-fleet migration proceeds. It runs a PINNED pre-fleet
    // `showcase-harness` image digest set out-of-band — it is NOT CI-built —
    // and will be torn down (removed from this SSOT and from Railway) at
    // migration end. Real serviceInstance IDs exist for BOTH envs on Railway
    // (resolved 2026-06-05 via GraphQL); we record both. gateIgnore keeps the
    // image-ref gate from validating either instance's (out-of-band) ref, and
    // ciBuilt:false keeps it out of the default CI_BUILT_SERVICES redeploy
    // scope. The build only failed because the Railway→SSOT untracked-services
    // check saw this service name with no SSOT entry; listing it here clears
    // that without subjecting its pinned digest to the gate's shape check.
    ciBuilt: false,
    // gateIgnore: deliberately-untracked for the image-ref gate. This
    // interim service runs a pinned digest (not the canonical :latest /
    // @sha256 shape the gate enforces) and is short-lived. Mirrors
    // harness-workers exactly (minus the worker's single-env shape —
    // harness-legacy DOES exist in both envs).
    gateValidated: false,
    gateIgnore: true,
    probeDriver: "harness",
    // Runs a pinned pre-fleet `showcase-harness` image digest, set
    // out-of-band rather than tracked by showcase_build.yml. The repoName
    // override points at `showcase-harness` so the image-ref shape resolves
    // if the gate ever validates it.
    //
    // probe disabled in BOTH envs: this interim service's coverage is
    // exercised out-of-band during the migration, not by verify-deploy.
    // Domainless under the env-map schema — no public host is probed, so the
    // borrowed control-plane host is omitted.
    environments: {
      prod: {
        instanceId: "3d125700-a08d-4a7f-904b-c13f3f7cc0fc",
        probe: false,
        repoName: "showcase-harness",
      },
      staging: {
        instanceId: "ed184024-fdfa-4b6f-bb51-37d6648e0beb",
        probe: false,
        repoName: "showcase-harness",
      },
    },
    // Ruby/jq JSON-shape compat (see ServiceEntry.legacyJsonCompat). Both
    // envs exist with real instance IDs; only the borrowed domains need
    // restoring so the generated JSON stays byte-identical. Not read by TS.
    legacyJsonCompat: {
      domains: {
        prod: "showcase-harness-production.up.railway.app",
        staging: "harness-staging-2ee4.up.railway.app",
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
        domain: "showcase.copilotkit.ai",
        probe: true,
        repoName: "showcase-shell",
      },
      staging: {
        instanceId: "25b7de41-188c-4f2e-ac07-538212eaeb91",
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
    environments: {
      prod: {
        instanceId: "de571c97-03fd-486b-8a54-9767a4a53f95",
        domain: "showcase-ag2-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "ecaf81b3-93a8-4862-92b6-04a016b634ed",
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
    environments: {
      prod: {
        instanceId: "026d12fb-2844-42af-8f92-b47bc8a06bc8",
        domain: "showcase-agno-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "68964ab6-75ca-4095-a64a-52cacfb684f5",
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
    environments: {
      prod: {
        instanceId: "40018ef7-1ed1-4979-b80c-9c2d957b6d88",
        domain: "showcase-built-in-agent-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "b89ae7b3-01cc-4ed4-aca6-23aaa63cd59e",
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
    environments: {
      prod: {
        instanceId: "bb18caaf-9a3e-4fdd-85ec-562fd82a3a89",
        domain: "showcase-claude-sdk-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "1ef25aec-5fbd-40b9-8685-57c2681bd45d",
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
    environments: {
      prod: {
        instanceId: "bee425e4-9661-4a88-8888-922b8cd4b61d",
        domain: "showcase-claude-sdk-typescript-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "92305747-2f55-4122-aad4-882e989558ab",
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
    environments: {
      prod: {
        instanceId: "3dab0cc3-cab1-4579-b772-947268088514",
        domain: "showcase-crewai-crews-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "88c2a14f-435b-499e-a811-ee4f4be18fd8",
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
    environments: {
      prod: {
        instanceId: "7b2da5db-87d2-40ad-a3d9-b2d7a5485a22",
        domain: "showcase-google-adk-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "7efe2fa0-fa78-4585-bc4c-6d39c326e6d1",
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
    environments: {
      prod: {
        instanceId: "105b7e01-acd0-48e2-9a09-541e2103e8d2",
        domain: "showcase-langgraph-fastapi-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "7899afe0-141b-4217-8dbb-5907813231dc",
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
    environments: {
      prod: {
        instanceId: "aec504f7-63d7-4ea6-9d50-601b00d2ae80",
        domain: "showcase-langgraph-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "04d29664-a776-4670-9db3-b1d18bce1669",
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
    environments: {
      prod: {
        instanceId: "f53e9fdc-7c3e-4dfd-9fa8-d7241fd55bb8",
        domain: "showcase-langgraph-typescript-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "481ab37f-da8a-4015-bd88-2b28d9eb261a",
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
    environments: {
      prod: {
        instanceId: "6b5e20b5-8f8e-4ec3-9288-7a41122e42e5",
        domain: "showcase-langroid-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "a213f7d9-2117-4944-988b-05e68d819dd5",
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
    environments: {
      prod: {
        instanceId: "b778856e-9f90-4136-9415-fb2b41173f8d",
        domain: "showcase-llamaindex-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "17899ea7-355c-43f2-a152-28cb0b7fa864",
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
    environments: {
      prod: {
        instanceId: "eaeddd9c-8b75-426f-b033-0fd935cbf6ef",
        domain: "showcase-mastra-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "eec22411-aab5-47a1-8f5b-d097e233d7f8",
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
    environments: {
      prod: {
        instanceId: "93ca0edf-7b59-4de4-b1fd-3412bb07bc6a",
        domain: "showcase-ms-agent-dotnet-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "9826bc58-c472-41e6-b050-29249d4b2a52",
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
    environments: {
      prod: {
        instanceId: "8f91ebc6-95c0-4433-b1f7-657ff49c2d59",
        domain: "showcase-ms-agent-harness-dotnet-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "6b0fe181-9156-4a40-9e44-90befe09833a",
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
    environments: {
      prod: {
        instanceId: "323ed911-4d28-45ab-8fc0-7d151828b938",
        domain: "showcase-ms-agent-python-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "741725ce-5fa1-4327-aff5-53dcc000c29c",
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
    environments: {
      prod: {
        instanceId: "192cd647-6824-4f01-937a-1da675d83805",
        domain: "showcase-pydantic-ai-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "6edf5ca5-6a56-4d28-92c3-2a3360c735db",
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
    environments: {
      prod: {
        instanceId: "2fbf1db2-5e51-44c9-983c-3f2242d95c61",
        domain: "showcase-spring-ai-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "189ac76f-bd77-45c0-9c45-3853dae763cc",
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
    environments: {
      prod: {
        instanceId: "2123c71b-9385-443c-a1c3-bcf4b1669eeb",
        domain: "showcase-strands-production.up.railway.app",
        probe: true,
      },
      staging: {
        instanceId: "f8a9d2ed-50ec-4f06-85d6-230baced8471",
        domain: "showcase-strands-staging.up.railway.app",
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
    // webhooks is a first-party ghcr.io/copilotkit/ image, but its
    // GHCR repo name is `showcase-eval-webhook` (NOT `webhooks`), and
    // it is built by a separate release workflow — not showcase_build.yml.
    // The dispatch_name entry exists so humans can redeploy/verify
    // webhooks from CI on demand; the build slot is no-op.
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
 * The env names present in a service's `environments` map. Returns a sorted
 * copy so callers get deterministic order regardless of literal order.
 * Throws on unknown service (fail loud).
 */
export function envsFor(serviceName: string): EnvName[] {
  const entry = SERVICES[serviceName];
  if (!entry) {
    throw new Error(
      `Unknown showcase service "${serviceName}". Add it to SERVICES in showcase/scripts/railway-envs.ts.`,
    );
  }
  return Object.keys(entry.environments).sort();
}

/**
 * Every (serviceName, env) pair across the whole SSOT, sorted by service
 * name then env name. The canonical iteration order for any consumer that
 * must visit every env-scoped instance (the image-ref gate, exhaustive
 * snapshots, etc.) without hardcoding ["prod","staging"].
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
  const entry = SERVICES[serviceName];
  if (!entry) {
    throw new Error(
      `Unknown showcase service "${serviceName}". Add it to SERVICES in showcase/scripts/railway-envs.ts.`,
    );
  }
  const envCfg = entry.environments[env];
  if (!envCfg) {
    throw new Error(
      `Service "${serviceName}" has no "${env}" environment in the SSOT (envs: ${Object.keys(
        entry.environments,
      )
        .sort()
        .join(", ")}).`,
    );
  }
  return envCfg.instanceId;
}

export function listServiceNames(): string[] {
  return Object.keys(SERVICES).sort();
}

/**
 * The subset of SERVICES that `showcase_build.yml` actually builds and
 * pushes. Excludes `webhooks` (released by its own repo's workflow).
 * pocketbase IS CI-built (its matrix slot is gated to
 * `showcase/pocketbase/**` changes). Default target set for
 * `redeploy-env.ts <env>` when no explicit `--services` list is provided
 * — though the actual default redeploy scope is this set PLUS any
 * `imageOf` consumers that declare the target env (e.g. staging adds
 * harness-workers → 27 attempted).
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
  // Own-property lookups throughout: bare index checks would resolve
  // inherited Object.prototype keys to truthy non-entries.
  const entry = Object.hasOwn(SERVICES, serviceName)
    ? SERVICES[serviceName]
    : undefined;
  if (!entry) {
    throw new Error(
      `Unknown showcase service "${serviceName}". Add it to SERVICES in showcase/scripts/railway-envs.ts.`,
    );
  }
  if (!Object.hasOwn(ENV_ID_BY_NAME, env)) {
    throw new Error(
      `Unknown env "${String(env)}" — repoNameFor requires a normalized SSOT env key (one of: ${Object.keys(ENV_ID_BY_NAME).join(", ")}). Synonyms like "production" must be normalized via resolveEnv() first.`,
    );
  }
  const envCfg = Object.hasOwn(entry.environments, env)
    ? entry.environments[env]
    : undefined;
  if (!envCfg) {
    throw new Error(
      `Service "${serviceName}" has no "${env}" environment in the SSOT (envs: ${Object.keys(
        entry.environments,
      )
        .sort()
        .join(", ")}).`,
    );
  }
  return envCfg.repoName ?? serviceName;
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
  const entry = SERVICES[serviceName];
  if (!entry) {
    throw new Error(
      `Unknown showcase service "${serviceName}". Add it to SERVICES in showcase/scripts/railway-envs.ts.`,
    );
  }
  const envCfg = entry.environments[env];
  if (!envCfg) {
    throw new Error(
      `Service "${serviceName}" has no "${env}" environment in the SSOT (envs: ${Object.keys(
        entry.environments,
      )
        .sort()
        .join(", ")}).`,
    );
  }
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
 * unknown service so callers can treat "not probe-eligible" uniformly.
 */
export function probeEnabled(serviceName: string, env: EnvName): boolean {
  const entry = SERVICES[serviceName];
  if (!entry) return false;
  const envCfg = entry.environments[env];
  if (!envCfg) return false;
  return envCfg.probe ?? true;
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

/**
 * Throw on SSOT load if any two services share the same `dispatchName`.
 * `serviceForDispatchName` iterates `Object.entries(SERVICES)` and returns
 * the first match — a silent collision would route redeploys to the wrong
 * service. We fail loud at module load instead.
 *
 * Accepts an injected map for testing; defaults to the real SERVICES map.
 */
export function assertDispatchNamesUnique(
  services: Record<string, { dispatchName?: string }> = SERVICES,
): void {
  const seen = new Map<string, string>(); // dispatchName -> first ssotKey
  const collisions: Array<{
    dispatchName: string;
    keys: [string, string];
  }> = [];
  for (const [key, entry] of Object.entries(services)) {
    const dn = entry.dispatchName;
    if (typeof dn !== "string" || dn.length === 0) continue;
    const prior = seen.get(dn);
    if (prior !== undefined) {
      collisions.push({ dispatchName: dn, keys: [prior, key] });
    } else {
      seen.set(dn, key);
    }
  }
  if (collisions.length > 0) {
    const lines = collisions
      .map(
        (c) =>
          `  - duplicate dispatchName "${c.dispatchName}" on SSOT keys: ${c.keys[0]}, ${c.keys[1]}`,
      )
      .join("\n");
    throw new Error(
      `railway-envs SSOT invariant violated:\n${lines}\n` +
        `Fix: each Railway service must have a unique dispatchName ` +
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
    // Env overlap: every env the consumer declares must also be one the
    // producer builds for. A consumer-only env would run an image that no
    // CI build ever refreshes there — a silently never-updating service,
    // the exact stale-image failure this invariant exists to prevent.
    const producerEnvs = targetEntry.environments ?? {};
    for (const env of Object.keys(entry.environments ?? {})) {
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
        `environments must be a subset of its producer's.`,
    );
  }
}

// Module-load assertions: fail any importer if the SSOT drifts into a
// collision or a mis-wired image consumer. Tests that exercise the
// invariants with synthetic input call the assert functions directly.
assertDispatchNamesUnique();
assertImageConsumersValid();
