/**
 * Control-plane CATALOG ENUMERATOR — the real `ServiceEnumerator` the job
 * producer (S4) runs each tick (BLITZ S10, the discovery seam in
 * `runControlPlane`).
 *
 * ── WHAT IT PRODUCES ───────────────────────────────────────────────────
 * One `ServiceJobSpec` per showcase d6 service — the SAME service set and the
 * SAME per-service granularity the in-process `d6-all-pills-e2e` driver runs
 * today. Each spec carries:
 *   - `probeKey`     = `d6:<slug>` — the dashboard's D6 aggregate row key (see
 *                      contracts.ts §1: "probeKey for a d6 service job is
 *                      d6:<slug>"). This is the join key to the claim row and
 *                      the status row the aggregator writes.
 *   - `serviceSlug`  = the slug (service name minus the `showcase-` prefix),
 *                      identical to the driver's `deriveSlug`.
 *   - `driverKind`   = `e2e_d6` (the per-service d6 unit).
 *   - `driverInputs` = the serialized d6 `E2eFullDriverInput`
 *                      (`key`/`backendUrl`/`demos`/`notSupportedFeatures`/
 *                      `shape`/`deployedAt`/`name`) the WORKER re-hydrates via
 *                      `createD6PayloadToInput`. The d6 driver's own zod schema
 *                      is the validation gate.
 *
 * ── WHY IT REUSES railwayServicesSource ────────────────────────────────
 * The in-process d6 path discovers its services through the `railway-services`
 * discovery source filtered by the `d6-all-pills-e2e.yml` `discovery.filter`
 * block. We reuse the EXACT same source + filter here rather than re-querying
 * Railway by hand, so:
 *   - the fleet enumerates the IDENTICAL service set as the legacy probe (no
 *     drift between the two run paths during the cutover), and
 *   - the `LOCAL_SERVICES_JSON` local-injection seam the source honors works
 *     unchanged — the local N=1 d6 gate feeds the identical `RailwayServiceInfo`
 *     shape and the fleet enumerates against it with zero Railway creds.
 *
 * The filter (`D6_DISCOVERY_FILTER`) is the single source of truth mirroring the
 * YAML; keep it in lockstep with `config/probes/d6-all-pills-e2e.yml` until the
 * two run paths converge on one config.
 *
 * ── INJECTION ──────────────────────────────────────────────────────────
 * The discovery source, the env snapshot, and the fetch impl are injected so
 * the enumerator is unit-testable with a fake source (no Railway, no network);
 * `runControlPlane` wires the real `railwayServicesSource` + `process.env`.
 */

import type { Logger } from "../../types/index.js";
import type { DiscoverySource, DiscoveryContext } from "../../probes/types.js";
import type { RailwayServiceInfo } from "../../probes/discovery/railway-services.js";
import type {
  ServiceEnumerator,
  ServiceJobSpec,
  EnumerateContext,
} from "./job-producer.js";

import {
  E2E_SMOKE_DRIVER_KIND,
  E2E_DEMOS_DRIVER_KIND,
} from "../worker/payload-mapper.js";

/** The d6 driver kind every enumerated spec runs under. */
export const D6_DRIVER_KIND = "e2e_d6";

/**
 * The demos family's outer-cap timeout (ms) — the SINGLE SOURCE OF TRUTH
 * mirroring `config/probes/e2e-demos.yml`'s `timeout_ms` (20 min). On the legacy
 * in-process path the orchestrator threads this YAML value into the demos driver
 * via the `E2E_DEMOS_TIMEOUT_MS` env (see `orchestrator.ts` `envForCfg`). The
 * fleet WORKER does not run that boot path and never sets that env, so the demos
 * enumerator instead CONVEYS the cap per-job in `driverInputs.timeout_ms` (the
 * driver reads `input.timeout_ms`). Without it the 38-demo service would blow the
 * driver's 5-min `DEFAULT_TIMEOUT_MS` and go all-red. Keep this in lockstep with
 * the YAML until the in-process and fleet run paths converge on one config.
 */
export const E2E_DEMOS_TIMEOUT_MS = 1_200_000;

/**
 * The d6 service-set filter — the SINGLE SOURCE OF TRUTH mirroring
 * `config/probes/d6-all-pills-e2e.yml`'s `discovery.filter`. Selects the
 * `showcase-*` demo services and excludes infra/shell services and the
 * decommissioned starters. Keep this in lockstep with the YAML until the
 * in-process and fleet run paths converge on one config.
 */
export const D6_DISCOVERY_FILTER = {
  namePrefix: "showcase-",
  nameExcludes: [
    "showcase-aimock",
    "showcase-harness",
    "showcase-pocketbase",
    "showcase-shell",
    "showcase-shell-dashboard",
    "showcase-shell-docs",
    "showcase-shell-dojo",
    // Harness service for .NET integration testing — not a demo service.
    "showcase-ms-agent-harness-dotnet",
    // Decommissioned starters.
    "showcase-starter-ag2",
    "showcase-starter-agno",
    "showcase-starter-claude-sdk-python",
    "showcase-starter-claude-sdk-typescript",
    "showcase-starter-crewai-crews",
    "showcase-starter-google-adk",
    "showcase-starter-langgraph-fastapi",
    "showcase-starter-langgraph-python",
    "showcase-starter-langgraph-typescript",
    "showcase-starter-langroid",
    "showcase-starter-llamaindex",
    "showcase-starter-mastra",
    "showcase-starter-ms-agent-dotnet",
    "showcase-starter-ms-agent-python",
    "showcase-starter-pydantic-ai",
    "showcase-starter-spring-ai",
    "showcase-starter-strands",
  ],
} as const;

/**
 * A discovery service-set filter — the `namePrefix` / `nameExcludes` block the
 * discovery source narrows on. Shared by the d6 wrapper deps and the generic
 * enumerator params so the shape stays in one place.
 */
export interface ServiceSetFilter {
  namePrefix?: string;
  nameExcludes?: readonly string[];
}

export interface D6ServiceEnumeratorDeps {
  /** The discovery source to enumerate (production: `railwayServicesSource`). */
  source: DiscoverySource<RailwayServiceInfo>;
  /** Frozen env snapshot threaded to the discovery context. */
  env: Readonly<Record<string, string | undefined>>;
  /** Fetch impl threaded to the discovery context (tests stub network). */
  fetchImpl: typeof fetch;
  logger: Logger;
  /**
   * Service-set filter. Defaults to `D6_DISCOVERY_FILTER`. Exposed so a test
   * (or a future operator config) can narrow the set without editing the SSOT.
   */
  filter?: ServiceSetFilter;
}

/**
 * Build the dashboard `probeKey` for a given service slug. A bare string is
 * treated as a prefix (`<prefix>:<slug>` — the d6 `d6:<slug>` convention); a
 * function gives a family full control over the key shape. The same value is
 * stamped onto `driverInputs.key` so the driver emits the exact dashboard keys.
 */
export type ProbeKeyPrefix = string | ((slug: string) => string);

export interface ServiceEnumeratorParams {
  /** The discovery source to enumerate (production: `railwayServicesSource`). */
  source: DiscoverySource<RailwayServiceInfo>;
  /** Frozen env snapshot threaded to the discovery context. */
  env: Readonly<Record<string, string | undefined>>;
  /** Fetch impl threaded to the discovery context (tests stub network). */
  fetchImpl: typeof fetch;
  logger: Logger;
  /** The driver kind every enumerated spec runs under (e.g. `e2e_d6`). */
  driverKind: string;
  /**
   * Builds the dashboard `probeKey` (and `driverInputs.key`) per service. A
   * string is used as a `<prefix>:<slug>` prefix; a function gives full control.
   */
  probeKeyPrefix: ProbeKeyPrefix;
  /**
   * Service-set filter selecting which discovered services this family runs.
   * Carries the discovery source's `namePrefix` / `nameExcludes` block.
   */
  filter: ServiceSetFilter;
  /**
   * Extra family-wide `driverInputs` fields spread onto every enumerated spec's
   * `driverInputs` AFTER the per-service `toDriverInputs` projection, so a family
   * can convey a YAML-derived knob the worker can't otherwise reach (e.g. the
   * demos `timeout_ms` outer cap — the fleet worker never sets the legacy
   * `E2E_DEMOS_TIMEOUT_MS` env). The per-service fields win on key collision; the
   * conveyed knobs (e.g. `timeout_ms`) never collide with the per-service shape.
   * Omitted by d6/smoke/deep (their specs are unchanged).
   */
  extraDriverInputs?: Readonly<Record<string, unknown>>;
}

/**
 * Resolve a `ProbeKeyPrefix` into the concrete dashboard key for a slug. The
 * string arm OWNS the `:` separator (`<prefix>:<slug>`), so a string-form caller
 * passes the bare prefix WITHOUT a trailing `:` (e.g. `"d6"`, not `"d6:"`). The
 * function arm gives a family full control over the key shape (and is
 * responsible for its own separators).
 */
function buildProbeKey(prefix: ProbeKeyPrefix, slug: string): string {
  return typeof prefix === "function" ? prefix(slug) : `${prefix}:${slug}`;
}

/**
 * Strip the `showcase-` prefix to derive the slug — mirrors the d6 driver's
 * `deriveSlug` and discovery's `deriveSlugFromServiceName` so the enumerated
 * `serviceSlug` / `probeKey` match the keys the dashboard already reads.
 */
function deriveSlug(name: string): string {
  return name.startsWith("showcase-") ? name.slice("showcase-".length) : name;
}

/**
 * Map one discovered `RailwayServiceInfo` into the d6 driver input the worker
 * re-hydrates. Field names match the d6 `inputSchema`
 * (`key`/`backendUrl`/`demos`/`notSupportedFeatures`/`shape`/`deployedAt`/
 * `name`). The driver reads `backendUrl ?? publicUrl`; we set `backendUrl` to
 * the discovered `publicUrl` (the live URL the spec navigates against — local
 * container host or Railway public domain) and emit ONLY `backendUrl` — the
 * driver's `??` fallback never needs a second copy under `publicUrl`, and
 * emitting both would drift the serialized shape from the documented contract.
 * `key` is the `d6:<slug>` aggregate key so the driver emits the exact
 * dashboard row keys.
 */
function toDriverInputs(
  svc: RailwayServiceInfo,
  slug: string,
  probeKey: string,
): Record<string, unknown> {
  return {
    key: probeKey,
    name: svc.name,
    backendUrl: svc.publicUrl,
    demos: [...svc.demos],
    notSupportedFeatures: [...svc.notSupportedFeatures],
    shape: svc.shape,
    // Omitted when empty so the driver's deploy-churn grace window only engages
    // for a genuine timestamp (the driver guards on length/parse anyway).
    ...(svc.deployedAt ? { deployedAt: svc.deployedAt } : {}),
  };
}

/**
 * Build a generic per-service `ServiceEnumerator` parameterized by the
 * service-set filter, the `driverKind`, and the `probeKey` prefix builder. Each
 * call enumerates the discovery source under the filter and maps every service
 * to one `ServiceJobSpec`. The `EnumerateContext.filter` (operator slug scoping
 * on a triggered run) is applied AFTER discovery so an operator can scope a
 * manual run to a subset of services without re-querying — mirroring the
 * in-process invoker's slug filter.
 *
 * `createD6ServiceEnumerator` is the d6 specialization of this seam; other
 * browser families re-express their enumerators the same way, each passing its
 * own filter / kind / prefix.
 */
export function createServiceEnumerator(
  params: ServiceEnumeratorParams,
): ServiceEnumerator {
  const {
    source,
    env,
    fetchImpl,
    logger,
    driverKind,
    probeKeyPrefix,
    filter,
    extraDriverInputs,
  } = params;

  // Fail loud on a filter with no `namePrefix`: the discovery source treats an
  // absent/empty prefix as "match everything", which would enumerate ALL
  // services (the railway-services source documents this incident class). The
  // d6 wrapper always passes a concrete filter, so it is unaffected. A future
  // family that legitimately needs "match all" can revisit this; default to
  // fail-loud now.
  if (typeof filter.namePrefix !== "string" || filter.namePrefix === "") {
    throw new Error(
      `createServiceEnumerator: filter.namePrefix must be a non-empty string ` +
        `(driverKind ${driverKind}); an absent/empty prefix would enumerate ALL services.`,
    );
  }

  return async (ctx: EnumerateContext): Promise<ServiceJobSpec[]> => {
    const discoveryCtx: DiscoveryContext = { fetchImpl, env, logger };
    const services = await source.enumerate(discoveryCtx, {
      namePrefix: filter.namePrefix,
      nameExcludes: filter.nameExcludes ? [...filter.nameExcludes] : undefined,
    });

    // Optional operator slug scoping (triggered runs only). An explicit filter
    // with zero matches means "no slugs match" — keep the run honest (empty)
    // rather than silently running everything.
    const slugScope = ctx.filter?.slugs;
    const slugSet =
      slugScope && slugScope.length > 0 ? new Set(slugScope) : undefined;

    const specs: ServiceJobSpec[] = [];
    for (const svc of services) {
      const slug = deriveSlug(svc.name);
      if (slugSet && !slugSet.has(slug) && !slugSet.has(svc.name)) continue;
      const probeKey = buildProbeKey(probeKeyPrefix, slug);
      // A function-form prefix returning "" yields an empty probeKey (and
      // `driverInputs.key`) — a bad dashboard/claim join key. Fail loud naming
      // the offending slug rather than emitting a spec keyed "".
      if (probeKey === "") {
        throw new Error(
          `createServiceEnumerator: probeKeyPrefix produced an empty probeKey ` +
            `for service "${svc.name}" (slug "${slug}", driverKind ${driverKind}).`,
        );
      }
      const spec: ServiceJobSpec = {
        probeKey,
        serviceSlug: slug,
        driverKind,
        // Family-wide conveyed knobs (e.g. demos `timeout_ms`) spread FIRST so
        // the per-service `toDriverInputs` projection always wins on a key
        // collision — the conveyed knobs never overlap the per-service shape.
        driverInputs: {
          ...extraDriverInputs,
          ...toDriverInputs(svc, slug, probeKey),
        },
      };
      // Forward the operator feature-type scoping to the worker as a cell
      // narrowing (the d6 driver filters by ctx.featureTypes); per-service is
      // still the partition, this only restricts which cells run.
      if (ctx.filter?.featureTypes && ctx.filter.featureTypes.length > 0) {
        spec.cellIds = [...ctx.filter.featureTypes];
      }
      specs.push(spec);
    }

    logger.info("fleet.control-plane.catalog-enumerated", {
      runId: ctx.runId,
      triggered: ctx.triggered,
      driverKind,
      discovered: services.length,
      enqueueable: specs.length,
    });
    return specs;
  };
}

/**
 * Build the real d6 `ServiceEnumerator` — a thin specialization of
 * `createServiceEnumerator` with the d6 filter, the `e2e_d6` driver kind, and
 * the `d6:<slug>` probeKey prefix. The produced SPECS are identical to the prior
 * hardwired implementation (same services, same filter, same kind, same keys);
 * the only observable change is the diagnostic log line — the generic
 * enumerator's `fleet.control-plane.catalog-enumerated` log additionally carries
 * a `driverKind` field (the specs themselves are unchanged).
 */
export function createD6ServiceEnumerator(
  deps: D6ServiceEnumeratorDeps,
): ServiceEnumerator {
  const { source, env, fetchImpl, logger } = deps;
  const filter = deps.filter ?? D6_DISCOVERY_FILTER;

  return createServiceEnumerator({
    source,
    env,
    fetchImpl,
    logger,
    driverKind: D6_DRIVER_KIND,
    probeKeyPrefix: "d6",
    filter,
  });
}

/**
 * Build the real e2e-smoke (`d4`) `ServiceEnumerator` — a thin specialization of
 * `createServiceEnumerator` with the shared showcase filter, the `e2e_smoke`
 * driver kind, and the `d4:<slug>` probeKey prefix (matching `src/cli/targets.ts`
 * `d4:<slug>` and `config/probes/e2e-smoke.yml`). The fleet WORKER routes
 * `e2e_smoke` jobs to its pooled smoke driver, which sets the per-slug
 * `X-AIMock-Context` header itself via the pooled launcher.
 */
export function createE2eSmokeServiceEnumerator(
  deps: D6ServiceEnumeratorDeps,
): ServiceEnumerator {
  const { source, env, fetchImpl, logger } = deps;
  const filter = deps.filter ?? D6_DISCOVERY_FILTER;

  return createServiceEnumerator({
    source,
    env,
    fetchImpl,
    logger,
    driverKind: E2E_SMOKE_DRIVER_KIND,
    probeKeyPrefix: "d4",
    filter,
  });
}

/**
 * Build the real e2e-deep (`d5-single-pill-e2e`) `ServiceEnumerator`.
 *
 * D5 is now LITERALLY "D6 take-one": the enumerated specs run under the D6
 * driver (`e2e_d6`) — the SAME route, headers, conversation, and pooled
 * launcher — but scoped to a single representative pill per feature category
 * and emitting the `d5:` dashboard key prefix. This eliminated the separate
 * D5 driver / launcher whose own launcher instance + cadence systematically
 * lost the `x-aimock-context` header against the shared fleet pool (aimock
 * strict 503 → red). Two conveyed `driverInputs` make the D6 driver behave
 * as D5:
 *   - `representativeOnly: true` — filter the D6 matrix to only the
 *     featureTypes present in `D5_REPRESENTATIVES`.
 *   - `rowPrefix: "d5"` — thread the `d5:` prefix through every emitted PB
 *     row (per-cell `d5:<slug>/<ft>` and aggregate `d5:<slug>`).
 *
 * The probeKey prefix stays `d5-single-pill-e2e:<slug>` (matching
 * `src/cli/targets.ts` and `config/probes/e2e-deep.yml`) so the claim/dashboard
 * join key is unchanged; only the driver KIND and the two scoping inputs differ
 * from a full D6 run.
 */
export function createE2eDeepServiceEnumerator(
  deps: D6ServiceEnumeratorDeps,
): ServiceEnumerator {
  const { source, env, fetchImpl, logger } = deps;
  const filter = deps.filter ?? D6_DISCOVERY_FILTER;

  return createServiceEnumerator({
    source,
    env,
    fetchImpl,
    logger,
    driverKind: D6_DRIVER_KIND,
    probeKeyPrefix: "d5-single-pill-e2e",
    filter,
    extraDriverInputs: { representativeOnly: true, rowPrefix: "d5" },
  });
}

/** Deps for the demos enumerator — `D6ServiceEnumeratorDeps` plus the outer-cap. */
export interface E2eDemosServiceEnumeratorDeps extends D6ServiceEnumeratorDeps {
  /**
   * The demos driver's outer-cap timeout (ms), conveyed per-job in
   * `driverInputs.timeout_ms` so the fleet worker's pooled demos driver reads it
   * (the worker never sets the legacy `E2E_DEMOS_TIMEOUT_MS` env). Defaults to
   * {@link E2E_DEMOS_TIMEOUT_MS} (the `config/probes/e2e-demos.yml` value).
   */
  timeoutMs?: number;
}

/**
 * Build the real e2e-demos (`e2e-demos`) `ServiceEnumerator` — a thin
 * specialization of `createServiceEnumerator` with the shared showcase filter,
 * the `e2e_demos` driver kind, and the `e2e-demos:<slug>` probeKey prefix
 * (matching `config/probes/e2e-demos.yml` `id: e2e-demos`).
 *
 * Unlike the other families, demos CONVEYS its YAML `timeout_ms` outer cap into
 * each spec's `driverInputs.timeout_ms` (see {@link E2E_DEMOS_TIMEOUT_MS}): the
 * fleet worker re-hydrates the payload but never sets the legacy
 * `E2E_DEMOS_TIMEOUT_MS` env, so without this the 38-demo service would blow the
 * demos driver's 5-min `DEFAULT_TIMEOUT_MS` and go all-red.
 */
export function createE2eDemosServiceEnumerator(
  deps: E2eDemosServiceEnumeratorDeps,
): ServiceEnumerator {
  const { source, env, fetchImpl, logger } = deps;
  const filter = deps.filter ?? D6_DISCOVERY_FILTER;
  const timeoutMs = deps.timeoutMs ?? E2E_DEMOS_TIMEOUT_MS;

  return createServiceEnumerator({
    source,
    env,
    fetchImpl,
    logger,
    driverKind: E2E_DEMOS_DRIVER_KIND,
    probeKeyPrefix: "e2e-demos",
    filter,
    extraDriverInputs: { timeout_ms: timeoutMs },
  });
}
