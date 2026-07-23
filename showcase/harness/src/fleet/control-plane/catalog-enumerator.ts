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
import {
  DiscoverySourceAuthError,
  DiscoverySourceBackendError,
  DiscoverySourceTransportError,
} from "../../probes/discovery/errors.js";
import type {
  ServiceEnumerator,
  ServiceJobSpec,
  EnumerateContext,
} from "./job-producer.js";

import {
  E2E_SMOKE_DRIVER_KIND,
  E2E_DEMOS_DRIVER_KIND,
} from "../worker/payload-mapper.js";

/**
 * Retry backoff schedule (ms) for `source.enumerate` against Railway-GQL.
 *
 * Railway's `/graphql/v2` endpoint sits behind Cloudflare's WAF which can
 * burst-block the harness producer with HTTP 429 / Cloudflare error 1015
 * (or 1020/1022) for tens of minutes during a flap. Without retries the
 * producer's tick hard-fails every cron, zeroing out D4/D5/D6 writes and
 * turning the staging dashboard red within one tick window. Three retries
 * at 1s/4s/16s ride out a ~21s WAF burst on a single tick; persistent
 * outages then fall through to the cached-catalog fallback (see
 * `withCatalogCache`).
 *
 * Exported for tests so the schedule remains the SSOT.
 */
export const ENUMERATE_RETRY_BACKOFF_MS: readonly number[] = [
  1_000, 4_000, 16_000,
] as const;

/**
 * Cloudflare error-code markers that indicate WAF rate-limit / abuse
 * heuristics (1015 = "rate limited", 1020 = "access denied", 1022 = "block
 * due to access rules"). Retried because the underlying outage is transient
 * upstream, not a real config error on our side. Matched against the
 * `DiscoverySourceBackendError` message which carries the Cloudflare HTML
 * body verbatim.
 */
const CLOUDFLARE_RETRY_MARKERS: readonly string[] = [
  "1015",
  "1020",
  "1022",
] as const;

/**
 * Decide whether a thrown error from `source.enumerate` is retryable.
 *
 * Retry on:
 *   - `DiscoverySourceTransportError`: socket/DNS-level failure, network
 *     blip, request aborted — always transient.
 *   - `DiscoverySourceBackendError` with `status === 429`: explicit rate
 *     limit, the Cloudflare-WAF case this exists for.
 *   - `DiscoverySourceBackendError` with `status >= 500`: upstream 5xx,
 *     transient by definition.
 *   - `DiscoverySourceBackendError` whose message carries a Cloudflare
 *     `1015`/`1020`/`1022` marker (defensive: sometimes CF wraps the
 *     rate-limit response with a non-429 status).
 *
 * Do NOT retry on:
 *   - `DiscoverySourceAuthError`: 401/403 is a real config/credential
 *     error and must fail loud — burning retries here would just delay
 *     the operator-actionable failure.
 *   - Any other `DiscoverySourceBackendError` with 4xx (e.g. 400 bad
 *     request, 404): client-side error, retrying will not change the
 *     outcome.
 *   - `DiscoverySourceSchemaError`: an upstream API change — retrying
 *     will not fix the wire payload.
 *   - Any other thrown class: bubble up unchanged.
 *
 * Exported so the catalog-aware enumerator test can pin the decision
 * surface without re-deriving the predicate from the implementation.
 */
export function isRetryableEnumerateError(err: unknown): boolean {
  if (err instanceof DiscoverySourceAuthError) return false;
  if (err instanceof DiscoverySourceTransportError) return true;
  if (err instanceof DiscoverySourceBackendError) {
    if (err.status === 429) return true;
    if (err.status >= 500) return true;
    // Defensive: a Cloudflare 1015 served under a non-429 status still
    // carries the marker in the response body — retry on the marker, not
    // just the status code.
    const msg = err.message;
    for (const marker of CLOUDFLARE_RETRY_MARKERS) {
      if (msg.includes(marker)) return true;
    }
    return false;
  }
  return false;
}

/**
 * In-memory cache of the last successful `services` list per enumerator
 * instance. Survives across ticks within one process (the producer is
 * long-lived). When all retries fail, the enumerator falls back to this
 * cache and emits jobs at staleness rather than zeroing out the dashboard.
 *
 * A fresh-boot process with no cached entry and a persistent enumerate
 * failure preserves the original hard-fail behavior (the producer's
 * `enumerate-failed` short-circuit) — without a catalog there is nothing
 * to enqueue.
 *
 * Per-enumerator (not shared globally) so the d6/smoke/demos/deep
 * enumerators do not cross-pollinate.
 */
interface CatalogCache {
  services: RailwayServiceInfo[];
  cachedAtMs: number;
}

/**
 * Sleep used between retry attempts. Injectable so tests can collapse the
 * 1s/4s/16s schedule to instant without a fake-timer dance. Default is a
 * real `setTimeout` Promise — production sees the real backoff.
 */
export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap a one-shot `source.enumerate` invocation with the Railway-GQL
 * resilience policy:
 *   1. Retry transient failures (429 / 5xx / Cloudflare 1015|1020|1022 /
 *      transport) on the `ENUMERATE_RETRY_BACKOFF_MS` schedule.
 *   2. On persistent failure, fall back to the last successful catalog
 *      from the in-memory cache (LOUDLY: a `warn` named
 *      `fleet.producer.enumerate-failed-using-cache` so the cache-use
 *      shows up in observability).
 *   3. With NO cache available, re-throw the last error (preserves the
 *      current hard-fail behavior on a fresh boot — without a catalog
 *      there is nothing to enqueue).
 *
 * The retry+cache wrapper sits OUTSIDE the per-service mapping step
 * (operator slug-scoping + driver-input projection still re-applies on a
 * cache use) so the cached path produces the same `ServiceJobSpec[]`
 * shape the live path does.
 *
 * Exposed as a free function (not folded into `createServiceEnumerator`)
 * so the catalog-enumerator test can pin the retry/cache behavior in
 * isolation without re-wiring the whole spec projection.
 */
async function enumerateWithRetryAndCache(opts: {
  source: DiscoverySource<RailwayServiceInfo>;
  discoveryCtx: DiscoveryContext;
  filter: { namePrefix: string; nameExcludes?: string[] };
  logger: Logger;
  driverKind: string;
  cache: { current: CatalogCache | null };
  sleep: SleepFn;
  now: () => number;
  retrySchedule: readonly number[];
}): Promise<RailwayServiceInfo[]> {
  const {
    source,
    discoveryCtx,
    filter,
    logger,
    driverKind,
    cache,
    sleep,
    now,
  } = opts;
  const retrySchedule = opts.retrySchedule;
  // attempt 0 is the initial try; attempt 1..N are the retries.
  const maxAttempt = retrySchedule.length;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxAttempt; attempt++) {
    if (attempt > 0) {
      const backoffMs = retrySchedule[attempt - 1] ?? 0;
      logger.warn("fleet.producer.enumerate-retry", {
        driverKind,
        attempt,
        backoffMs,
        err: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
      await sleep(backoffMs);
    }
    try {
      const services = await source.enumerate(discoveryCtx, filter);
      // Persist the latest successful catalog so a later transient failure
      // can fall back to it.
      cache.current = { services, cachedAtMs: now() };
      return services;
    } catch (err) {
      lastErr = err;
      if (!isRetryableEnumerateError(err)) {
        // Real config error (auth, 4xx other than 429, schema rot): fail
        // loud — no retry, no cache. Surface the operator-actionable error
        // class verbatim.
        throw err;
      }
      // continue the retry loop
    }
  }
  // All retries exhausted. Fall back to the cached catalog if present;
  // otherwise re-throw the last transient error so the producer's
  // `enumerate-failed` path runs (current hard-fail behavior — without a
  // catalog there is nothing to enqueue).
  if (cache.current !== null) {
    const ageMs = now() - cache.current.cachedAtMs;
    logger.warn("fleet.producer.enumerate-failed-using-cache", {
      driverKind,
      ageMs,
      services: cache.current.services.length,
      reason: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
    return cache.current.services;
  }
  throw lastErr;
}

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
 * The d6 (`d6-all-pills-e2e`) full-matrix outer-cap timeout (ms) — the SINGLE
 * SOURCE OF TRUTH mirroring `config/probes/d6-all-pills-e2e.yml`'s `timeout_ms`
 * (20 min). Like the demos family, the d6 enumerator CONVEYS this cap per-job in
 * `driverInputs.timeout_ms` so the fleet WORKER's pooled d6 driver honors the
 * YAML budget. The legacy in-process path threads the YAML `timeout_ms` into the
 * driver via `probe-invoker`'s `cfg.timeout_ms` guard; the fleet worker never
 * runs that boot path, so without this conveyance the d6 driver silently falls
 * back to its hardcoded `DEFAULT_TIMEOUT_MS` (10 min) and a slow backend
 * false-aborts at 10 min instead of the YAML's 20. Keep this in lockstep with
 * the YAML until the in-process and fleet run paths converge on one config.
 */
export const D6_E2E_TIMEOUT_MS = 1_200_000;

/**
 * The d5 (`e2e-deep` / `d5-single-pill-e2e`) take-one outer-cap timeout (ms) —
 * the SINGLE SOURCE OF TRUTH mirroring `config/probes/e2e-deep.yml`'s
 * `timeout_ms` (10 min). D5 runs the SAME d6 driver scoped to one representative
 * pill per feature, so it conveys its own (smaller) YAML cap per-job in
 * `driverInputs.timeout_ms`. Without it the d5 specs run under the d6 driver's
 * hardcoded `DEFAULT_TIMEOUT_MS` (10 min) — which happens to coincide today, but
 * pinning the conveyance to the YAML keeps the two run paths honest and prevents
 * silent drift if either YAML budget changes. Keep this in lockstep with the
 * YAML until the in-process and fleet run paths converge on one config.
 */
export const D5_E2E_TIMEOUT_MS = 600_000;

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
  /**
   * The driver-invocation outer-cap timeout (ms), conveyed per-job in
   * `driverInputs.timeout_ms` so the fleet worker's pooled d6 driver reads the
   * YAML budget from the payload (the worker never runs the legacy in-process
   * `probe-invoker` boot path that applies `cfg.timeout_ms`). Each family
   * defaults to its own YAML value (`D6_E2E_TIMEOUT_MS` for d6,
   * `D5_E2E_TIMEOUT_MS` for d5). Exposed so a test can override.
   */
  timeoutMs?: number;
  /**
   * Sleep impl used between Railway-GQL retry attempts. Forwarded verbatim
   * to `createServiceEnumerator`. Defaults to real `setTimeout`. Exposed so
   * a test can collapse the `ENUMERATE_RETRY_BACKOFF_MS` schedule to
   * instant without monkey-patching globals.
   */
  sleep?: SleepFn;
  /**
   * Clock injected for the cached-catalog `cachedAtMs` and `ageMs`
   * accounting. Forwarded verbatim. Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Retry backoff schedule (ms). Forwarded verbatim. Defaults to
   * `ENUMERATE_RETRY_BACKOFF_MS` (1s/4s/16s).
   */
  retrySchedule?: readonly number[];
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
  /**
   * Sleep impl used between Railway-GQL retry attempts. Defaults to real
   * `setTimeout`; tests inject an instant resolve to collapse the
   * `ENUMERATE_RETRY_BACKOFF_MS` (1s/4s/16s) schedule without a fake-timer
   * dance. Exposed on the public params so the catalog-enumerator test can
   * stub the wait without monkey-patching globals.
   */
  sleep?: SleepFn;
  /**
   * Clock injected to stamp the cached-catalog `cachedAtMs` (and the
   * `ageMs` carried on the `enumerate-failed-using-cache` warn). Defaults
   * to `Date.now`; tests inject a frozen clock for deterministic age
   * assertions.
   */
  now?: () => number;
  /**
   * Retry backoff schedule (ms). Defaults to `ENUMERATE_RETRY_BACKOFF_MS`
   * (1s/4s/16s, three retries). A test can pass a shorter schedule (e.g.
   * `[0, 0, 0]`) to exercise the retry loop without waiting; the
   * production wiring leaves it at the SSOT default.
   */
  retrySchedule?: readonly number[];
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
  const sleep = params.sleep ?? defaultSleep;
  const now = params.now ?? (() => Date.now());
  const retrySchedule = params.retrySchedule ?? ENUMERATE_RETRY_BACKOFF_MS;

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

  // Per-enumerator catalog cache (Change 2). Lives in the closure so each
  // enumerator instance owns its own slice — d6/smoke/demos/deep never
  // cross-pollinate. The producer (long-lived) re-uses the same enumerator
  // instance across ticks, so this cache survives tick-to-tick within the
  // process. A fresh process boots with `current === null` (first
  // enumerate fail still hard-fails, preserving the current behavior).
  const cache: { current: CatalogCache | null } = { current: null };

  // Hoist the (now-validated) prefix so TS sees `string`, not `string |
  // undefined` — the guard above already failed loud on a missing prefix
  // but the type is structural.
  const namePrefix: string = filter.namePrefix;
  return async (ctx: EnumerateContext): Promise<ServiceJobSpec[]> => {
    const discoveryCtx: DiscoveryContext = { fetchImpl, env, logger };
    const services = await enumerateWithRetryAndCache({
      source,
      discoveryCtx,
      filter: {
        namePrefix,
        nameExcludes: filter.nameExcludes
          ? [...filter.nameExcludes]
          : undefined,
      },
      logger,
      driverKind,
      cache,
      sleep,
      now,
      retrySchedule,
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
  const timeoutMs = deps.timeoutMs ?? D6_E2E_TIMEOUT_MS;

  return createServiceEnumerator({
    source,
    env,
    fetchImpl,
    logger,
    driverKind: D6_DRIVER_KIND,
    probeKeyPrefix: "d6",
    filter,
    // Convey the YAML outer-cap so the fleet worker's d6 driver honors the
    // `d6-all-pills-e2e.yml` budget instead of its hardcoded DEFAULT_TIMEOUT_MS.
    extraDriverInputs: { timeout_ms: timeoutMs },
    // Forward Railway-GQL resilience knobs (test-only stubs in production
    // wiring; real defaults otherwise — `defaultSleep` / `Date.now` /
    // `ENUMERATE_RETRY_BACKOFF_MS`).
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.retrySchedule !== undefined
      ? { retrySchedule: deps.retrySchedule }
      : {}),
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
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.retrySchedule !== undefined
      ? { retrySchedule: deps.retrySchedule }
      : {}),
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
  const timeoutMs = deps.timeoutMs ?? D5_E2E_TIMEOUT_MS;

  return createServiceEnumerator({
    source,
    env,
    fetchImpl,
    logger,
    driverKind: D6_DRIVER_KIND,
    probeKeyPrefix: "d5-single-pill-e2e",
    filter,
    // Convey the YAML outer-cap alongside the D5-take-one scoping so the fleet
    // worker's d6 driver honors the `e2e-deep.yml` budget rather than its
    // hardcoded DEFAULT_TIMEOUT_MS.
    extraDriverInputs: {
      representativeOnly: true,
      rowPrefix: "d5",
      timeout_ms: timeoutMs,
    },
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.retrySchedule !== undefined
      ? { retrySchedule: deps.retrySchedule }
      : {}),
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
    ...(deps.sleep !== undefined ? { sleep: deps.sleep } : {}),
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(deps.retrySchedule !== undefined
      ? { retrySchedule: deps.retrySchedule }
      : {}),
  });
}
