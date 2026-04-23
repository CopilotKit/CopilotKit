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

/**
 * Service shape — distinguishes the two deployment archetypes that share
 * the `showcase-*` naming scheme on Railway but have wildly different URL
 * surfaces. Drivers branch on this field to pick the right probe contract
 * (see `drivers/smoke.ts` and `drivers/e2e-smoke.ts`).
 *
 *   - `package`  Shell-based showcases (`showcase-ag2`, `showcase-mastra`,
 *                ...). They expose `/smoke`, `/health`, `/demos/*`, and
 *                `/api/copilotkit/` as distinct routes.
 *   - `starter`  Single-app integrations deployed from
 *                `showcase/starters/*` (Railway service name pattern
 *                `showcase-starter-*`). They mount the integration at
 *                `/`, health at `/api/health`, and have NO `/smoke` or
 *                `/demos/*` routing.
 *
 * Classification is derived from the Railway service name, so adding a
 * new starter requires no YAML edit — the next tick picks it up with
 * `shape: "starter"` automatically.
 *
 * Single-source tuple: the driver schemas import `showcaseShapeSchema`
 * below so every consumer of `shape` shares the exact enum — adding a new
 * archetype (e.g. `static`) is a one-line edit here plus a matching
 * classifier branch, not a cross-file ripple.
 */
export const showcaseShapeSchema = z.enum(["package", "starter"]);
export type ShowcaseServiceShape = z.infer<typeof showcaseShapeSchema>;

export interface RailwayServiceInfo {
  name: string;
  imageRef: string;
  publicUrl: string;
  env: Record<string, string>;
  /**
   * Deployment archetype, classified from the service name. Drivers
   * that probe per-service URLs branch on this field to pick the right
   * contract (starter: `/api/health` + skip `/smoke` + skip `/demos/*`;
   * package: legacy `/smoke` + `/health` + `/demos/*`).
   */
  shape: ShowcaseServiceShape;
  /**
   * Digest of the image running in the latest deployment, sourced from
   * Railway's `latestDeployment.meta.imageDigest`. Railway stores
   * tag-only refs in `source.image` (e.g. `ghcr.io/org/name:latest`),
   * so the `imageRef` field never contains a digest for tag-deployed
   * services. The image-drift driver uses this field as the "currently
   * deployed" digest instead of parsing from the (digest-less) imageRef.
   *
   * Empty string when no deployment exists or the field is absent.
   */
  deployedDigest: string;
}

/**
 * Minimal logger surface used by shape helpers. A structural subset of
 * the orchestrator's `Logger` — kept local so `classifyShape` /
 * `resolveShape` can accept ad-hoc test loggers without importing the
 * full `Logger` type tree.
 */
interface ShapeLogger {
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Classify a Railway service name into a `ShowcaseServiceShape`. Exported
 * so tests can exercise the classifier directly and downstream drivers
 * can reclassify from a bare name when the discovery record wasn't
 * threaded through (static-YAML callers). The rule set:
 *   - `showcase-starter-<slug>` → `"starter"`.
 *   - `showcase-<slug>` where `<slug>` is lowercase-alphanumeric plus
 *     hyphens (multi-segment names like `showcase-langgraph-python`,
 *     `showcase-claude-sdk-typescript`, `showcase-ms-agent-dotnet`) →
 *     `"package"`. The earlier single-segment regex misclassified every
 *     hyphen-bearing package as unknown and fired a warn per tick on
 *     real production services.
 *   - Any other name — typos like `showcase-strater-foo`, mixed case,
 *     or unrelated workloads (`copilotkit-cloud`, `my-random-service`)
 *     — still returns `"package"` as a safe default but emits an audit
 *     warn via `opts.logger?.warn`. That preserves the fall-through
 *     behaviour while alerting operators on drift (renamed service,
 *     unrelated workload picked up by discovery) on the first tick.
 */
export function classifyShape(
  name: string,
  opts: { logger?: ShapeLogger } = {},
): ShowcaseServiceShape {
  if (/^showcase-starter-[a-z0-9-]+$/.test(name)) return "starter";
  // Widened package regex: starts with `showcase-`, not followed by
  // `starter-` (that path is the branch above), then lowercase-alnum
  // plus hyphens. Accepts `showcase-ag2`, `showcase-langgraph-python`,
  // `showcase-claude-sdk-typescript`, etc. without firing a warn.
  if (/^showcase-(?!starter-)[a-z0-9][a-z0-9-]*$/.test(name)) return "package";
  // Everything else — a `showcase-*` typo, a mixed-case variant, or a
  // name that doesn't start with `showcase-` at all — gets a warn. The
  // return value stays `"package"` so downstream drivers keep
  // operating; the warn is the audit trail.
  opts.logger?.warn?.("discovery.railway-services.name-shape-unknown", {
    name,
  });
  return "package";
}

/**
 * Resolve the deployment shape for a driver invocation. Classifier wins
 * when `name` is present — silent defaulting at the driver boundary
 * inverts the fix this contract exists to make, so we throw on any
 * explicit-vs-classifier disagreement rather than pick one. When `name`
 * is absent, honour the caller-supplied `shape` verbatim. When neither
 * is present, fall back to `package` and log a debug entry so the
 * assumption is greppable if it ever breaks.
 */
export function resolveShape(
  input: { name?: string; shape?: ShowcaseServiceShape },
  opts: { logger?: ShapeLogger } = {},
): ShowcaseServiceShape {
  if (input.name) {
    const classified = classifyShape(input.name, { logger: opts.logger });
    if (input.shape && input.shape !== classified) {
      throw new Error(
        `Shape mismatch: classifier="${classified}" input="${input.shape}" — check discovery wiring`,
      );
    }
    return classified;
  }
  if (input.shape) return input.shape;
  opts.logger?.debug?.("discovery.railway-services.resolve-shape-fallback", {
    reason: "no-name-or-shape",
  });
  return "package";
}

/**
 * Filter block accepted from YAML's `discovery.filter` — the
 * probe-invoker (`loader/probe-invoker.ts`) calls
 * `source.enumerate(ctx, cfg.discovery.filter ?? {})`, passing the
 * FILTER CONTENTS DIRECTLY (not wrapped in an outer `{filter: ...}`
 * object). This schema is therefore the source's full config contract,
 * not a nested field inside one. An earlier version wrapped the block
 * in an outer `{filter: FilterSchema}` ConfigSchema; the wrapper never
 * matched the invoker's call shape, so `cfg.filter` was always
 * undefined, `namePrefix` + `nameExcludes` silently defaulted to
 * undefined, and all 7 infra services declared in smoke.yml's
 * `nameExcludes` produced smoke:/health:/agent: rows every tick.
 *
 * `.passthrough()` preserves the previous lenient behaviour — tests
 * and callers that pass extra keys still parse cleanly rather than
 * trigger a strict-mode rejection.
 */
const ConfigSchema = z
  .object({
    labels: z.record(z.string()).optional(),
    namePrefix: z.string().optional(),
    /**
     * Exact-match name exclusion list. Applied AFTER `namePrefix` so
     * operators can say "all `showcase-*` services EXCEPT infra/shell
     * services" in one filter block rather than having to post-filter
     * inside every driver. Empty/undefined ⇒ no exclusions. Matches
     * are exact-string (not prefix or regex) to keep the YAML shape
     * auditable — `["showcase-ops","showcase-aimock"]` means exactly
     * those two names and nothing else.
     */
    nameExcludes: z.array(z.string().min(1)).optional(),
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
                    latestDeployment: z
                      .object({
                        meta: z
                          .object({
                            imageDigest: z.string().nullable().optional(),
                          })
                          .nullable()
                          .optional(),
                      })
                      .nullable()
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
    // `rawConfig` is the filter-contents object the invoker hands us —
    // see ConfigSchema docstring above for why this is flat, not a
    // `{filter: {...}}` wrapper.
    const filter = ConfigSchema.parse(rawConfig ?? {});
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
    //
    // Note: `serviceInstances` on `Service` takes NO arguments in the
    // current Railway schema — passing `environmentId` there raises
    // `Unknown argument "environmentId" on field "Service.serviceInstances"`
    // and 400s the whole tick. We fetch every instance and filter by
    // environment client-side below (the loop that finds
    // `environmentId === environmentId`).
    const projectRaw = await gql<unknown>(
      `query project($id: String!) {
        project(id: $id) {
          services {
            edges { node {
              id
              name
              serviceInstances {
                edges { node {
                  environmentId
                  source { image }
                  domains { serviceDomains { domain } }
                  latestDeployment { meta { imageDigest } }
                } }
              }
            } }
          }
        }
      }`,
      { id: projectId },
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
    const excludeSet = new Set(filter.nameExcludes ?? []);
    const services = parsedProject.data.project.services.edges
      .map((e) => e.node)
      .filter((svc) => {
        if (filter.namePrefix && !svc.name.startsWith(filter.namePrefix)) {
          return false;
        }
        // Exact-name exclusion — applied AFTER the prefix check so the
        // exclusion list only has to enumerate names the prefix already
        // matched. Returning false here skips the per-service env fetch
        // entirely (same path as the prefix miss above) so excluded
        // services cost nothing beyond the project-level round-trip.
        if (excludeSet.has(svc.name)) {
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
      const deployedDigest =
        instance?.node.latestDeployment?.meta?.imageDigest ?? "";
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

      out.push({
        name: svc.name,
        imageRef,
        deployedDigest,
        publicUrl,
        env,
        shape: classifyShape(svc.name, { logger: ctx.logger }),
      });
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
