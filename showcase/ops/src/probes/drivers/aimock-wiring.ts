import { z } from "zod";
import {
  aimockWiringProbe,
  type AimockWiringSignal,
} from "../aimock-wiring.js";
import type { ProbeDriver } from "../types.js";
import type { Logger } from "../../types/index.js";

/**
 * Driver wrapper around the legacy `aimockWiringProbe`. The existing probe
 * object (see `../aimock-wiring.ts`) is the single source of truth for
 * probe BEHAVIOUR — this file only adapts the probe to the new YAML-driven
 * loader/invoker path. Concretely:
 *
 *   1. Legacy `Probe.run(input, ctx)` → new `ProbeDriver.run(ctx, input)`
 *      call-order flip, so the probe-invoker can dispatch uniformly.
 *   2. The YAML config carries ONLY a `key` (config/probes/aimock-wiring.yml).
 *      Callback injection (`listServices` / `getServiceEnv`) is not
 *      representable in YAML, so the driver reads Railway + aimock config
 *      from `ctx.env` at run time and constructs the Railway adapter in
 *      process. That keeps the YAML representation minimal and mirrors
 *      how every other future driver will consume orchestrator-level env
 *      (RAILWAY_TOKEN, AIMOCK_URL, GHCR_TOKEN, …).
 *   3. Missing env is a probe-level error, not a driver-wide boot error.
 *      The driver returns a synthetic `state:"error"` ProbeResult so a
 *      misconfigured operator sees a keyed error on the next tick rather
 *      than a silent no-op. This mirrors the `probeErrored: true` branch
 *      inside the legacy probe for config drift.
 *
 * Phase 4.1 cleanup (out of scope here) removes the legacy `Probe`
 * interface and the `buildCronProbeResolver` cron-resolver path; at that
 * point this file becomes the single aimock-wiring entry point. Until
 * then, both paths run in parallel and emit to the same writer — the
 * probe-loader path exercised via YAML is additive.
 */

/**
 * Input schema for the aimock-wiring driver. The YAML single-target shape
 * only carries `key`; a driver that needs more fields can declare them
 * here with passthrough semantics. Keeping the schema narrow (just `key`)
 * matches the YAML exactly so a typo in the probe config surfaces as a
 * Zod rejection, not a silent "missing field" at run time.
 */
const aimockWiringInputSchema = z
  .object({
    key: z.string().min(1),
  })
  .passthrough();

type AimockWiringDriverInput = z.infer<typeof aimockWiringInputSchema>;

/**
 * Driver-level Signal type: either the legacy probe's full signal OR a
 * bare `{ errorDesc }` envelope for driver-produced `state:"error"` ticks
 * (env-missing, listServices auth failure, etc.). Modelling this as a
 * union drops the old `as unknown as AimockWiringSignal` cast and lets
 * TypeScript narrow correctly at the consumer based on `state` — success
 * ticks always carry `AimockWiringSignal`, error ticks carry the bare
 * envelope. status-writer stores both shapes as-is under `signal` and
 * downstream templates already guard on `state === "error"` before
 * indexing into signal fields.
 */
export type AimockWiringDriverSignal =
  | AimockWiringSignal
  | { errorDesc: string };

export const aimockWiringDriver: ProbeDriver<
  AimockWiringDriverInput,
  AimockWiringDriverSignal
> = {
  kind: aimockWiringProbe.dimension,
  inputSchema: aimockWiringInputSchema,
  async run(ctx, input) {
    const { env, logger } = ctx;
    const token = env.RAILWAY_TOKEN;
    const projectId = env.RAILWAY_PROJECT_ID;
    const environmentId = env.RAILWAY_ENVIRONMENT_ID;
    const aimockUrl = env.AIMOCK_URL;
    if (!token || !projectId || !environmentId || !aimockUrl) {
      // Surface misconfig as a keyed synthetic-error ProbeResult — the
      // writer picks it up identically to any other error tick. Pre-fix,
      // the orchestrator had to branch on "env present" vs "env missing"
      // before wiring the probe at all; centralising here means the YAML
      // stays simple and operators just set the env vars when they're ready.
      logger.warn("probe.aimock-wiring.config-missing", {
        hasToken: !!token,
        hasProjectId: !!projectId,
        hasEnvironmentId: !!environmentId,
        hasAimockUrl: !!aimockUrl,
      });
      return {
        key: input.key,
        state: "error",
        signal: {
          errorDesc:
            "RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, and AIMOCK_URL must all be set",
        },
        observedAt: ctx.now().toISOString(),
      };
    }
    // `ctx.fetchImpl` is the canonical injection point for test stubs —
    // every other network-calling driver (image-drift, version-drift,
    // redirect-decommission) already honours it. Fall back to
    // `globalThis.fetch` in production where the orchestrator never sets
    // `fetchImpl` explicitly.
    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
    const adapter = createRailwayAdapter(
      { token, projectId, environmentId },
      logger,
      fetchImpl,
      // Thread the invoker's AbortController signal into the Railway
      // adapter so listServices/getServiceEnv fetches abort in-flight if
      // the probe's `timeout_ms` fires. Without this, one slow Railway
      // response could orphan a socket past the synthetic-timeout
      // ProbeResult the invoker emits.
      ctx.abortSignal,
    );
    // Probe body: flip call-order `(input, ctx)` to match the legacy shape
    // and thread the Railway adapter through. The probe already isolates
    // per-service env-fetch throws into the `errored` bucket, so an auth
    // blip on one service never poisons the tick. BUT `listServices`
    // throws escape the probe entirely (the probe calls it without a
    // try/catch because a failed service list means we literally have no
    // services to iterate). We catch those here and convert to a keyed
    // synthetic-error ProbeResult so the writer records a `state:"error"`
    // tick rather than the invoker catching a generic driver throw.
    try {
      return await aimockWiringProbe.run(
        {
          aimockUrl,
          listServices: adapter.listServices,
          getServiceEnv: adapter.getServiceEnv,
        },
        ctx,
      );
    } catch (err) {
      const errorDesc = err instanceof Error ? err.message : String(err);
      logger.warn("probe.aimock-wiring.run-failed", { errorDesc });
      return {
        key: input.key,
        state: "error",
        signal: { errorDesc },
        observedAt: ctx.now().toISOString(),
      };
    }
  },
};

/**
 * Minimal Railway GraphQL adapter scoped to what the aimock-wiring driver
 * needs — a mirror of the adapter in `orchestrator.ts#createRailwayAdapter`
 * but scoped locally so the driver is self-contained. When Phase 4.1
 * retires the legacy `buildCronProbeResolver` path, this becomes the
 * single source of truth and the orchestrator version is deleted.
 */
function createRailwayAdapter(
  opts: { token: string; projectId: string; environmentId: string },
  logger: Logger,
  fetchImpl: typeof fetch,
  abortSignal: AbortSignal | undefined,
): {
  listServices: () => Promise<{ name: string; id: string }[]>;
  getServiceEnv: (name: string) => Promise<Record<string, string | undefined>>;
} {
  const endpoint = "https://backboard.railway.com/graphql/v2";

  async function gql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: abortSignal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`railway gql ${res.status}: ${text}`);
    }
    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(
        `railway gql errors: ${json.errors.map((e) => e.message).join("; ")}`,
      );
    }
    return json.data as T;
  }

  // Cache the project's service list so getServiceEnv doesn't refetch on
  // every call — same rationale as the orchestrator-level adapter.
  let cachedServices: { name: string; id: string }[] | null = null;
  const listServices = async (): Promise<{ name: string; id: string }[]> => {
    const data = await gql<{
      project: {
        services: { edges: { node: { id: string; name: string } }[] };
      };
    }>(
      `query project($id: String!) {
        project(id: $id) {
          services { edges { node { id name } } }
        }
      }`,
      { id: opts.projectId },
    );
    const out = data.project.services.edges.map((e) => e.node);
    cachedServices = out;
    return out;
  };

  const getServiceEnv = async (
    name: string,
  ): Promise<Record<string, string | undefined>> => {
    if (!cachedServices) {
      await listServices();
    }
    const match = cachedServices!.find((s) => s.name === name);
    if (!match) {
      throw new Error(`railway service not found: ${name}`);
    }
    const data = await gql<{ variables: Record<string, string> }>(
      `query variables($projectId: String!, $environmentId: String!, $serviceId: String!) {
        variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
      }`,
      {
        projectId: opts.projectId,
        environmentId: opts.environmentId,
        serviceId: match.id,
      },
    );
    // Sealed Railway variables come back as literal "*****" — map them to
    // the `__SEALED__` sentinel that the probe recognises. Same handling
    // as the orchestrator-level adapter so behaviour is identical across
    // both paths until Phase 4.1 retires the legacy one.
    const vars = data.variables ?? {};
    const out: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      out[k] = v === "*****" ? "__SEALED__" : v;
    }
    logger.debug("probe.aimock-wiring.railway-env-fetched", {
      service: name,
      keyCount: Object.keys(out).length,
    });
    return out;
  };

  return { listServices, getServiceEnv };
}
