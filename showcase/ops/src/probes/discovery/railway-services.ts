import { promises as fs } from "node:fs";
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
  /**
   * Demo IDs declared for this service in `registry.json`, joined by
   * slug at enumerate-time. Empty when the slug is missing from the
   * registry, when the registry is unreadable, or when the service has
   * no `demos[]` declared. The `e2e_demos` probe-invoker reads this
   * field to sort services shortest-first BEFORE the worker pool picks
   * them up — see `loader/probe-invoker.ts:demoCount`. Other consumers
   * that don't care about demos can simply ignore the field.
   */
  demos: readonly string[];
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
 * True iff the thrown value is (or wraps) a real `AbortError`. The
 * gql() helper wraps fetch rejections in `DiscoverySourceTransportError`,
 * so a fetch-level abort surfaces as a TransportError whose `cause` is
 * the original AbortError. Walking up to two cause links keeps the
 * check honest without unbounded recursion. Anything that isn't an
 * AbortError (transport flakes, schema violations, backend 5xxs) falls
 * through to the per-service degradation path.
 */
function isAbortError(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 3 && cur instanceof Error; depth++) {
    if (cur.name === "AbortError") return true;
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  return false;
}

/**
 * True iff `a` and `b` are exactly one single-character edit apart
 * (insertion, deletion, substitution, OR adjacent transposition).
 * Used by `classifyShape` to surface suspected typos of `starter-`.
 *
 * Equal strings return `false` — this checks "exactly one edit", not
 * "at most one". Implementation is the standard early-exit linear
 * scan; we don't pull in a full Levenshtein library because the
 * comparison budget is tiny (one segment vs. one literal "starter").
 *
 * Adjacent-transposition detection is included because the canonical
 * starter typo this guards against is `strater` (a/r swap), which a
 * pure Levenshtein-1 check would score as distance 2.
 */
function isOneEditDistance(a: string, b: string): boolean {
  if (a === b) return false;
  // Adjacent transposition: same length, exactly two adjacent chars
  // differ AND swapping them makes the strings equal.
  if (a.length === b.length) {
    let firstDiff = -1;
    let secondDiff = -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        if (firstDiff === -1) {
          firstDiff = i;
        } else if (secondDiff === -1) {
          secondDiff = i;
        } else {
          // Three or more diffs — too far for a single edit.
          firstDiff = -1;
          break;
        }
      }
    }
    if (
      firstDiff !== -1 &&
      secondDiff === firstDiff + 1 &&
      a[firstDiff] === b[secondDiff] &&
      a[secondDiff] === b[firstDiff]
    ) {
      return true;
    }
  }
  // Standard 1-edit check: substitution (same length), insertion or
  // deletion (length differs by 1). Anything else is too far.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.length - shorter.length > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (shorter.length === longer.length) {
      // Substitution — advance both.
      i++;
      j++;
    } else {
      // Insertion in `longer` — advance only `longer`.
      j++;
    }
  }
  // Trailing char in `longer` (single insertion at end).
  if (j < longer.length) edits++;
  return edits === 1;
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
  if (/^showcase-(?!starter-)[a-z0-9][a-z0-9-]*$/.test(name)) {
    // Typo nudge: a name like `showcase-strater-ag2` (transposition)
    // or `showcase-startr-ag2` (deletion) classifies as package
    // silently, but is overwhelmingly likely to be a typo of
    // `starter-`. Surface the suspicion via a structured warn with
    // a suggested correction; do NOT change classification — that
    // would break the documented "anything-not-starter is package"
    // fallback. The widened package regex matches 1-edit-distance
    // typos by construction, so we can't tighten the regex without
    // also rejecting legitimate multi-segment package names.
    const firstSegment = name.slice("showcase-".length).split("-")[0];
    if (firstSegment && isOneEditDistance(firstSegment, "starter")) {
      const suggested = `showcase-starter-${name
        .slice("showcase-".length)
        .split("-")
        .slice(1)
        .join("-")}`;
      opts.logger?.warn?.(
        "discovery.railway-services.classify-typo-suspected",
        { name, suggested },
      );
    }
    return "package";
  }
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
                        // Railway's `DeploymentMeta` is a GraphQL scalar
                        // (untyped JSON object) — not a typed object with
                        // sub-fields. The query fetches `meta` without
                        // sub-selection; we parse it as a record and
                        // extract `imageDigest` in the service-building
                        // loop below.
                        meta: z.record(z.unknown()).nullable().optional(),
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

/**
 * Read `registry.json` and build a `slug -> demos[].id[]` map. Mirrors
 * the parsing logic in `drivers/e2e-demos.ts`'s `defaultDemosResolver`
 * so behaviour stays consistent across the two readers — the discovery
 * source feeds the invoker's pre-dispatch sort while the driver's
 * resolver feeds the per-service fan-out at execute time.
 *
 * Path resolution: honours `env.REGISTRY_JSON_PATH` for tests/dev,
 * falling back to the production runtime path `/app/data/registry.json`
 * (mirrors the driver's default). Read failures are non-fatal: we log
 * `discovery.railway-services.registry-read-failed` once and return an
 * empty Map so every service emits with `demos: []`. A missing registry
 * must NEVER abort the tick — sibling probes (smoke, image-drift, ...)
 * still need their service list even when the registry isn't mounted.
 */
async function loadDemosMap(
  ctx: DiscoveryContext,
): Promise<Map<string, string[]>> {
  const override = ctx.env.REGISTRY_JSON_PATH;
  // Production fallback path. Previously wrapped in `path.resolve()`,
  // which is a no-op for an absolute path; dropped the wrap to keep
  // the constant greppable.
  const fallback = "/app/data/registry.json";
  const registryPath = override ?? fallback;
  let raw: string;
  try {
    // Honour the discovery-level abort signal so a stalled fs.readFile
    // (e.g. an unresponsive volume mount) doesn't orphan past the
    // probe's `timeout_ms`. AbortError lands in the same catch as
    // other fs failures and degrades to an empty map — sibling probes
    // and downstream consumers still get a service list, just without
    // demo enrichment. A missing/aborted registry must NEVER abort
    // the tick.
    raw = await fs.readFile(registryPath, {
      encoding: "utf-8",
      signal: ctx.abortSignal,
    });
  } catch (err) {
    // Bucket: ENOENT is the steady-state for non-demos consumers
    // (image-drift, smoke, aimock-wiring) — they don't mount the
    // registry. In dev/test treating that as `warn` pulses the alert
    // stream every tick, so we downgrade ENOENT specifically to
    // `info`. In production a missing registry is genuinely an
    // operational concern — the volume mount may have failed, or the
    // image was built without the registry — so we promote ENOENT
    // back to `warn` only when `NODE_ENV === "production"`. Other
    // read errors (EACCES, EIO, AbortError) always log at `warn`
    // regardless of environment because they signal an active fault,
    // not steady-state.
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    const meta = {
      path: registryPath,
      err: err instanceof Error ? err.message : String(err),
    };
    if (code === "ENOENT" && process.env.NODE_ENV !== "production") {
      ctx.logger.info(
        "discovery.railway-services.registry-read-failed",
        meta,
      );
    } else {
      ctx.logger.warn(
        "discovery.railway-services.registry-read-failed",
        meta,
      );
    }
    return new Map();
  }
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch (err) {
    // Distinct log key from read failure so operators can tell
    // "file is corrupt" from "file isn't there" without parsing
    // error strings. Stays at `warn` — a corrupt registry is never
    // expected steady-state.
    ctx.logger.warn("discovery.railway-services.registry-parse-failed", {
      path: registryPath,
      err: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }
  // Shape guard: `JSON.parse("null")` returns null, `JSON.parse("42")`
  // returns 42, `JSON.parse("[]")` returns an array. Any of these
  // would crash the `for (const it of parsed.integrations ?? [])`
  // loop with a TypeError on property access (`null.integrations`).
  // Reject anything that isn't a plain object root and degrade to an
  // empty map with a structurally-distinct log key.
  if (
    parsedUnknown === null ||
    typeof parsedUnknown !== "object" ||
    Array.isArray(parsedUnknown)
  ) {
    ctx.logger.warn(
      "discovery.railway-services.registry-shape-invalid",
      {
        path: registryPath,
        rootType: parsedUnknown === null ? "null" : typeof parsedUnknown,
        isArray: Array.isArray(parsedUnknown),
      },
    );
    return new Map();
  }
  const parsed = parsedUnknown as {
    integrations?: Array<{
      slug?: string;
      demos?: Array<{ id?: string }>;
    }>;
  };
  const map = new Map<string, string[]>();
  for (const it of parsed.integrations ?? []) {
    if (!it.slug) continue;
    const demos: string[] = [];
    for (const d of it.demos ?? []) {
      if (typeof d.id === "string") demos.push(d.id);
    }
    map.set(it.slug, demos);
  }
  return map;
}

/**
 * Strip the `showcase-` prefix from a Railway service name to derive
 * the slug used in `registry.json`'s `integrations[].slug` field.
 * Mirrors the driver's `deriveSlug` for consistency. Names without the
 * prefix pass through unchanged so unrelated workloads simply don't
 * match a registry slug and end up with `demos: []`.
 *
 * Strip behaviour for starter services: `showcase-starter-ag2` becomes
 * `starter-ag2` (only the leading `showcase-` segment is removed). The
 * registry uses bare integration slugs (e.g. `ag2`) for package
 * services, so starter slugs don't match a registry entry and end up
 * with `demos: []`. This is the documented contract — the e2e-demos
 * driver doesn't fan out for starters anyway (shape-gated), so the
 * intentional miss is harmless. Adding a starter-specific demos slug
 * scheme would require a coordinated change in the driver, the
 * resolver, and `registry.json`'s `integrations` shape.
 */
function deriveSlugFromServiceName(name: string): string {
  return name.startsWith("showcase-") ? name.slice("showcase-".length) : name;
}

export const railwayServicesSource: DiscoverySource<RailwayServiceInfo> = {
  name: "railway-services",
  configSchema: ConfigSchema,
  async enumerate(ctx, rawConfig) {
    // `rawConfig` is the filter-contents object the invoker hands us —
    // see ConfigSchema docstring above for why this is flat, not a
    // `{filter: {...}}` wrapper.
    const filter = ConfigSchema.parse(rawConfig ?? {});

    // Load registry-derived demos map once per enumerate(). The map is
    // the source of truth for the invoker's `e2e_demos` shortest-first
    // sort (see `loader/probe-invoker.ts:demoCount`); without this the
    // sort sees `demos === undefined` for every service and degrades
    // to key-only ordering, defeating the documented behaviour.
    const demosMap = await loadDemosMap(ctx);
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
      logger: ctx.logger,
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
    const projectResult = await gql<unknown>(
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
                  latestDeployment { meta }
                } }
              }
            } }
          }
        }
      }`,
      { id: projectId },
    );
    const parsedProject = ProjectServicesSchema.safeParse(projectResult.data);
    if (!parsedProject.success) {
      // Correlate downstream schema failures with the partial-errors
      // warn that already fired in `gql()` for the same request — see
      // B2 in the CR notes. When the partial-data envelope fires, we
      // tag the schema-failure log with `cause: "partial-data"` so an
      // operator scanning the alert stream can tell "Railway changed
      // their schema" from "Railway returned partial data and the
      // partial payload tripped our shape guard".
      throw new DiscoverySourceSchemaError(
        "railway-services",
        projectResult.partialData
          ? `project response did not match expected shape (cause: partial-data): ${parsedProject.error.message}`
          : `project response did not match expected shape: ${parsedProject.error.message}`,
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
      const rawDigest = instance?.node.latestDeployment?.meta?.["imageDigest"];
      const deployedDigest = typeof rawDigest === "string" ? rawDigest : "";
      const domain =
        instance?.node.domains?.serviceDomains?.[0]?.domain ?? null;
      const publicUrl = domain ? `https://${domain}` : "";

      let env: Record<string, string> = {};
      try {
        const varsResult = await gql<unknown>(
          `query variables($projectId: String!, $environmentId: String!, $serviceId: String!) {
            variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
          }`,
          { projectId, environmentId, serviceId: svc.id },
        );
        const parsedVars = VariablesSchema.safeParse(varsResult.data);
        if (!parsedVars.success) {
          // Correlation marker: when the partial-errors warn already
          // fired for THIS request (gql() returned `partialData: true`),
          // tag the schema-failure log so operators can tell "Railway
          // schema drifted" from "we got partial data and the partial
          // payload tripped the shape guard". Otherwise the two log
          // keys (partial-errors vs variables-schema) look unrelated
          // even though they share a root cause. See B2 in the CR
          // notes.
          ctx.logger.warn("discovery.railway-services.variables-schema", {
            service: svc.name,
            err: parsedVars.error.message,
            ...(varsResult.partialData ? { cause: "partial-data" } : {}),
          });
          // `env` already initialised to {} above; no reassignment
          // needed. The schema-rejection path leaves the empty default
          // in place — that's the documented degraded behaviour.
        } else {
          const vars = parsedVars.data.variables ?? {};
          for (const [k, v] of Object.entries(vars)) {
            env[k] = v === "*****" ? "__SEALED__" : v;
          }
        }
      } catch (err) {
        // Tick-wide concerns must escape the per-service loop:
        //   1. AbortError — the invoker fired the per-tick timeout
        //      mid-loop. Continuing to spin up N more gql() calls
        //      that will all reject is pure noise; rethrow and let
        //      the invoker take a single keyed synthetic-error
        //      ProbeResult instead of N variables-failed warns.
        //   2. AuthError — a 401/403 mid-loop means the token rotated
        //      (or was revoked) BETWEEN the project-level query and
        //      this per-service call. Every remaining call will also
        //      401, and silently degrading every env to {} produces a
        //      green discovery while operators are blind to the auth
        //      break. Rethrow so the invoker surfaces the failure.
        // Other errors (transport flakes, backend 5xx, schema drift on
        // a single service) keep the documented per-service-degraded
        // behaviour: log + continue with empty env.
        //
        // Narrow contract: ONLY a real AbortError (a fetch rejection
        // wired to the controller's signal) qualifies as "abort". The
        // earlier check that also tripped on `ctx.abortSignal.aborted`
        // over-rethrew unrelated mid-loop failures — once an external
        // tick-timer fires, every subsequent iteration sees
        // `signal.aborted === true`, so a plain Railway 500 on the
        // next service would also escape this catch and kill the
        // whole tick. The catch must distinguish "fetch was aborted"
        // from "controller fired but this error is unrelated".
        //
        // We check `err.name === "AbortError"` directly AND walk the
        // `cause` chain because the gql() helper wraps fetch
        // rejections in DiscoverySourceTransportError; the underlying
        // AbortError lives on `err.cause`. Walking the chain catches
        // that case without re-tripping on unrelated transport
        // errors that happened to fire while the signal was aborted.
        const aborted = isAbortError(err);
        if (aborted || err instanceof DiscoverySourceAuthError) {
          throw err;
        }
        ctx.logger.warn("discovery.railway-services.variables-failed", {
          service: svc.name,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      out.push({
        // Property order mirrors `RailwayServiceInfo` declaration
        // order so a reviewer can grep the interface and the emit
        // site side by side without re-shuffling fields. Behaviour
        // unchanged.
        name: svc.name,
        imageRef,
        publicUrl,
        env,
        shape: classifyShape(svc.name, { logger: ctx.logger }),
        deployedDigest,
        demos: demosMap.get(deriveSlugFromServiceName(svc.name)) ?? [],
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
/**
 * Result envelope from a `gql()` call. `partialData` is true iff
 * Railway returned both a populated `data` payload AND non-empty
 * `errors[]` — the helper logs `partial-errors` and hands `data`
 * back, so callers should propagate the flag onto any downstream
 * schema-failure log to correlate "partial response" with "shape
 * rejection". See B2 in the discovery probe CR notes.
 */
interface GqlResult<T> {
  data: T;
  partialData: boolean;
}

export const RAILWAY_GRAPHQL_ENDPOINT = ENDPOINT;

export function makeGql(opts: {
  fetchImpl: typeof fetch;
  token: string;
  sourceName: string;
  abortSignal: AbortSignal | undefined;
  logger: DiscoveryContext["logger"];
}): <T>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<GqlResult<T>> {
  const { fetchImpl, token, sourceName, abortSignal, logger: gqlLogger } =
    opts;
  return async function gql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<GqlResult<T>> {
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
    const hasErrors = (json.errors?.length ?? 0) > 0;
    const hasData = json.data !== undefined && json.data !== null;
    if (hasErrors && !hasData) {
      // No `data` payload AND non-empty `errors[]` — the query failed
      // outright. 500 is a synthetic status on this class; schema-shape
      // errors above would reach here if the GraphQL layer surfaced
      // them as `errors[]`.
      throw new DiscoverySourceBackendError(
        sourceName,
        `railway gql errors: ${json.errors!.map((e) => e.message).join("; ")}`,
        500,
      );
    }
    if (hasErrors && hasData) {
      // GraphQL "partial success" envelope: Railway populated `data`
      // but also surfaced non-fatal `errors[]` (e.g. soft-deprecation
      // warnings on a sub-field, or a permission gap on an optional
      // nested field). Discarding `data` here would force every
      // downstream caller into the synthetic-error branch even though
      // the payload they asked for is right there. Log a structured
      // warn so operators can audit the partial-error stream, then
      // hand `data` back. Schema validation downstream catches any
      // shape rot the partial payload introduced.
      gqlLogger.warn("discovery.railway-services.partial-errors", {
        source: sourceName,
        errors: json.errors!.map((e) => e.message),
      });
    }
    return { data: json.data as T, partialData: hasErrors && hasData };
  };
}
