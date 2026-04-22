import { z } from "zod";
import type { DiscoveryContext, DiscoverySource } from "../types.js";
import {
  DiscoverySourceAuthError,
  DiscoverySourceBackendError,
  DiscoverySourceSchemaError,
  DiscoverySourceTransportError,
} from "./errors.js";

/**
 * DiscoverySource enumerating Railway services in the orchestrator's
 * project + environment. Extracted from the ad-hoc Railway adapter in
 * `orchestrator.ts` / `drivers/aimock-wiring.ts` so every future probe
 * that fans out across Railway services (image-drift, redirect decom,
 * e2e-smoke, ...) can share the same enumeration path and the same
 * typed-error taxonomy.
 *
 * Contract:
 *   - Reads `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`
 *     from `ctx.env` (NOT `process.env`) — tests stub via the env snapshot.
 *   - Uses `ctx.fetchImpl` for every round-trip — no global `fetch`
 *     reference, no monkey-patching required.
 *   - Throws `DiscoverySourceAuthError` on 401/403 or missing credentials,
 *     `DiscoverySourceBackendError` on any other non-2xx,
 *     `DiscoverySourceTransportError` when the fetch itself rejects,
 *     `DiscoverySourceSchemaError` when the body doesn't match the
 *     expected GraphQL shape (missing `project.services`, non-JSON body,
 *     etc.). The invoker converts all four into a single keyed synthetic
 *     `state:"error"` ProbeResult.
 *   - Per-service env fetch failures do NOT abort the whole tick — a
 *     missing/throwing variables call degrades that one service's `env`
 *     to an empty object, on the principle that one flaky service must
 *     not blind us to drift on every other service. If the project-level
 *     query fails, however, we have no services to return and DO throw.
 *
 * Sealed variables: Railway masks secret variable values as the literal
 * string "*****". We map those to the sentinel "__SEALED__" so probes
 * can distinguish "sealed, value unknown" from "unset". Matches the
 * behaviour of the legacy adapter in `orchestrator.ts`.
 */

export interface RailwayServiceInfo {
  name: string;
  imageRef: string;
  publicUrl: string;
  env: Record<string, string>;
}

const FilterSchema = z
  .object({
    labels: z.record(z.string()).optional(),
    namePrefix: z.string().optional(),
    /**
     * Exclude-list of exact service names. Applied AFTER `namePrefix` so
     * an operator can say "all showcase-* services EXCEPT these infra
     * ones". Common use: skip aimock / ops / pocketbase / shell so the
     * e2e-smoke probe targets only user-facing services.
     */
    nameExcludes: z.array(z.string()).optional(),
  })
  .optional();

const ConfigSchema = z
  .object({
    filter: FilterSchema,
  })
  .passthrough();

const ENDPOINT = "https://backboard.railway.com/graphql/v2";

// Zod shapes for the GraphQL responses. Kept in-file (not exported) so the
// schema errors carry consistent paths in their messages.
const ProjectServicesSchema = z.object({
  project: z.object({
    services: z.object({
      edges: z.array(
        z.object({
          node: z.object({
            id: z.string(),
            name: z.string(),
            serviceInstances: z.object({
              edges: z.array(
                z.object({
                  node: z.object({
                    environmentId: z.string(),
                    source: z
                      .object({
                        image: z.string().nullable(),
                      })
                      .nullable(),
                    domains: z
                      .object({
                        serviceDomains: z
                          .array(z.object({ domain: z.string() }))
                          .optional(),
                      })
                      .optional(),
                  }),
                }),
              ),
            }),
          }),
        }),
      ),
    }),
  }),
});

const VariablesSchema = z.object({
  variables: z.record(z.string()).nullable().optional(),
});

export const railwayServicesSource: DiscoverySource<RailwayServiceInfo> = {
  name: "railway-services",
  configSchema: ConfigSchema,
  async enumerate(ctx, rawConfig) {
    const cfg = ConfigSchema.parse(rawConfig ?? {});
    const filter = cfg.filter ?? {};
    const token = ctx.env.RAILWAY_TOKEN;
    const projectId = ctx.env.RAILWAY_PROJECT_ID;
    const environmentId = ctx.env.RAILWAY_ENVIRONMENT_ID;
    if (!token || !projectId || !environmentId) {
      // Missing creds classed as Auth — same bucket as 401/403 because the
      // caller can't act on "network failed" here, only "credentials are
      // wrong/missing". Mirrors `orchestrator.RAILWAY_AUTH_FAILED` log ID.
      throw new DiscoverySourceAuthError(
        "railway-services",
        "RAILWAY_TOKEN, RAILWAY_PROJECT_ID, and RAILWAY_ENVIRONMENT_ID must all be set",
      );
    }

    const gql = makeGql({
      fetchImpl: ctx.fetchImpl,
      token,
      sourceName: "railway-services",
      // Discovery-level abort signal: when the invoker's per-tick
      // timeout fires, stall-guard every Railway GraphQL request so the
      // sockets close instead of hanging past the tick boundary. The
      // source can run dozens of per-service variable lookups on a
      // large project — one stuck call could otherwise orphan a socket
      // for many minutes.
      abortSignal: ctx.abortSignal,
    });

    // Project-level query: fetch all services with their instance image
    // refs + domains in one round-trip. A failure here aborts the tick —
    // we can't synthesize targets without the service list.
    const projectRaw = await gql<unknown>(
      `query project($id: String!, $envId: String!) {
        project(id: $id) {
          services {
            edges { node {
              id
              name
              serviceInstances(environmentId: $envId) {
                edges { node {
                  environmentId
                  source { image }
                  domains { serviceDomains { domain } }
                } }
              }
            } }
          }
        }
      }`,
      { id: projectId, envId: environmentId },
    );
    const parsedProject = ProjectServicesSchema.safeParse(projectRaw);
    if (!parsedProject.success) {
      throw new DiscoverySourceSchemaError(
        "railway-services",
        `project response did not match expected shape: ${parsedProject.error.message}`,
        undefined,
        parsedProject.error,
      );
    }

    // Apply the YAML-level filter. Label filtering is accepted in the
    // schema for forward compatibility with a future Railway labels API
    // but isn't enforced yet — Railway doesn't expose service labels
    // today. `namePrefix` is the live filter.
    const services = parsedProject.data.project.services.edges
      .map((e) => e.node)
      .filter((svc) => {
        if (filter.namePrefix && !svc.name.startsWith(filter.namePrefix)) {
          return false;
        }
        if (filter.nameExcludes && filter.nameExcludes.includes(svc.name)) {
          return false;
        }
        return true;
      });

    // Per-service detail enrichment. Failures here degrade the single
    // service (empty env) rather than aborting the whole tick — mirrors
    // aimock-wiring's per-service try/catch pattern.
    const out: RailwayServiceInfo[] = [];
    for (const svc of services) {
      const instance = svc.serviceInstances.edges.find(
        (e) => e.node.environmentId === environmentId,
      );
      const imageRef = instance?.node.source?.image ?? "";
      const domain =
        instance?.node.domains?.serviceDomains?.[0]?.domain ?? null;
      const publicUrl = domain ? `https://${domain}` : "";

      let env: Record<string, string> = {};
      try {
        const varsRaw = await gql<unknown>(
          `query variables($projectId: String!, $environmentId: String!, $serviceId: String!) {
            variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
          }`,
          { projectId, environmentId, serviceId: svc.id },
        );
        const parsedVars = VariablesSchema.safeParse(varsRaw);
        if (!parsedVars.success) {
          ctx.logger.warn("discovery.railway-services.variables-schema", {
            service: svc.name,
            err: parsedVars.error.message,
          });
        } else {
          const vars = parsedVars.data.variables ?? {};
          env = {};
          for (const [k, v] of Object.entries(vars)) {
            env[k] = v === "*****" ? "__SEALED__" : v;
          }
        }
      } catch (err) {
        // Single-service variable fetch failure: log + continue with
        // empty env. A global 401 would have already aborted the tick
        // via the project-level query above, so reaching this branch
        // means transient per-service trouble — not a blanket outage.
        ctx.logger.warn("discovery.railway-services.variables-failed", {
          service: svc.name,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      out.push({ name: svc.name, imageRef, publicUrl, env });
    }
    return out;
  },
};

/**
 * Build a GraphQL executor against the Railway endpoint that maps every
 * transport/HTTP/body error into one of the typed DiscoverySource*Error
 * classes. Centralised here so the project-level and per-service queries
 * share identical error semantics — an operator reading the log stream
 * sees the same class regardless of which sub-query failed.
 */
function makeGql(opts: {
  fetchImpl: typeof fetch;
  token: string;
  sourceName: string;
  abortSignal: AbortSignal | undefined;
}): <T>(query: string, variables: Record<string, unknown>) => Promise<T> {
  const { fetchImpl, token, sourceName, abortSignal } = opts;
  return async function gql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: abortSignal,
      });
    } catch (err) {
      throw new DiscoverySourceTransportError(
        sourceName,
        `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (res.status === 401 || res.status === 403) {
      const text = await res.text().catch(() => "");
      throw new DiscoverySourceAuthError(
        sourceName,
        `railway gql ${res.status}: ${text}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DiscoverySourceBackendError(
        sourceName,
        `railway gql ${res.status}: ${text}`,
        res.status,
      );
    }
    let json: { data?: T; errors?: Array<{ message: string }> };
    try {
      json = (await res.json()) as {
        data?: T;
        errors?: Array<{ message: string }>;
      };
    } catch (err) {
      throw new DiscoverySourceSchemaError(
        sourceName,
        `response body was not JSON: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err,
      );
    }
    if (json.errors?.length) {
      // GraphQL errors with a 200 envelope still class as backend errors —
      // the transport was fine but Railway rejected the query. 500 is a
      // synthetic status on this class; schema-shape errors above would
      // reach here if the GraphQL layer surfaced them as `errors[]`.
      throw new DiscoverySourceBackendError(
        sourceName,
        `railway gql errors: ${json.errors.map((e) => e.message).join("; ")}`,
        500,
      );
    }
    return json.data as T;
  };
}
