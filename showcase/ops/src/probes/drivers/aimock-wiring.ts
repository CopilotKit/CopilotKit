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

export const aimockWiringDriver: ProbeDriver<
  AimockWiringDriverInput,
  AimockWiringSignal
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
        } as unknown as AimockWiringSignal,
        observedAt: ctx.now().toISOString(),
      };
    }
    const adapter = createRailwayAdapter(
      { token, projectId, environmentId },
      logger,
    );
    // Probe body: flip call-order `(input, ctx)` to match the legacy shape
    // and thread the Railway adapter through. The probe already isolates
    // per-service env-fetch throws into the `errored` bucket, so an auth
    // blip on one service never poisons the tick.
    return aimockWiringProbe.run(
      {
        aimockUrl,
        listServices: adapter.listServices,
        getServiceEnv: adapter.getServiceEnv,
      },
      ctx,
    );
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
): {
  listServices: () => Promise<{ name: string; id: string }[]>;
  getServiceEnv: (name: string) => Promise<Record<string, string | undefined>>;
} {
  const endpoint = "https://backboard.railway.com/graphql/v2";

  async function gql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
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
