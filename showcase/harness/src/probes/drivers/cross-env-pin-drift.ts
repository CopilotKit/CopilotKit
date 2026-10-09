import { z } from "zod";
import type { ProbeDriver } from "../types.js";
import type { ProbeResult } from "../../types/index.js";
import { makeGql } from "../discovery/railway-services.js";
import {
  DiscoverySourceAuthError,
  DiscoverySourceBackendError,
  DiscoverySourceTransportError,
} from "../discovery/errors.js";

/**
 * CROSS-ENV pin-drift driver.
 *
 * This is the genuinely-new prod drift signal, distinct from the two
 * pre-existing probes it is frequently confused with:
 *
 *   - `pin-drift-core.ts` / `drivers/pin-drift.ts` is the validate-pins
 *     RATCHET — a fail-baseline hash comparison of the source-tree pin
 *     set. It is NOT cross-environment and never reads a running deploy.
 *   - `drivers/image-drift.ts` compares ONE env's running digest against
 *     the GHCR `:latest` tag. The merged false-red fix there only
 *     SUPPRESSED reds on pinned prod (`pinnedExpected`) — it does NOT
 *     verify prod is running what it was promoted to.
 *
 * The real prod drift question is CROSS-ENV: for each prod-pinned
 * service, is prod actually RUNNING the digest it was LAST PROMOTED to,
 * and is that digest still present in the registry? Under the
 * pinned-prod / floating-staging contract, prod's `source.image` is an
 * immutable `@sha256:<digest>` ref (set by `bin/railway promote`) — that
 * IS the last-promoted digest. So this driver, per service:
 *
 *   1. Reads prod's PINNED ref from `serviceInstances[prod].source.image`
 *      (the last-promoted digest) and asserts it carries an `@sha256:`.
 *      An unpinned prod (`:latest`) is `status: "unpinned"` → red.
 *   2. Reads prod's RUNNING digest from
 *      `serviceInstances[prod].latestDeployment.meta.imageDigest` and
 *      asserts it equals the pinned digest. A mismatch means prod is
 *      running something other than what it was promoted to →
 *      `status: "regressed"` → red. (Distinct from image-drift's
 *      "behind :latest", which is EXPECTED on pinned prod.)
 *   3. GETs the pinned digest manifest from GHCR and asserts it is still
 *      present. A garbage-collected last-promoted digest means prod
 *      cannot be re-pulled / rolled forward cleanly →
 *      `status: "ghcr-missing"` → red (alarm).
 *
 * Staging's running digest is read for REPORTING ONLY (the floating
 * side) — it never drives the assertion. Surfacing it lets operators see
 * the prod/staging digest pair in one signal.
 *
 * Cross-package note: `tsc rootDir: src` forbids importing
 * `showcase/scripts/*`, so the Railway GraphQL plumbing is reused from
 * the SAME package (`discovery/railway-services.ts`'s exported `makeGql`)
 * rather than from the scripts tree. The two-env read is the project
 * query (which already returns every env's instances) filtered to the
 * prod + staging env-ids supplied per input — no second round-trip and
 * no second discovery pass.
 */

/** Probe `kind` literal. Wiring onto the schedule/Ops surface is U11. */
export const CROSS_ENV_PIN_DRIFT_KIND = "pin_drift_cross_env";

const crossEnvPinDriftInputSchema = z.object({
  /** Probe row key, e.g. `pin_drift_cross_env:showcase-langgraph-python`. */
  key: z.string().min(1),
  /** Railway service name (matches `railway-services` discovery `name`). */
  name: z.string().min(1),
  /**
   * GHCR repository for the service image, e.g.
   * `ghcr.io/copilotkit/showcase-langgraph-python`. Used to look up the
   * pinned digest's manifest. Supplied by the wiring layer rather than
   * parsed from the prod ref so a malformed prod ref still produces a
   * deterministic GHCR lookup target for the error message.
   */
  imageRepo: z.string().min(1),
  /** Railway production environment id (the pinned side). */
  prodEnvId: z.string().min(1),
  /**
   * Railway staging environment id (the floating side). Optional —
   * staging is reporting-only and absent on prod-only services.
   */
  stagingEnvId: z.string().min(1).optional(),
});

type CrossEnvPinDriftInput = z.infer<typeof crossEnvPinDriftInputSchema>;

export type CrossEnvPinDriftStatus =
  | "stable"
  | "regressed"
  | "unpinned"
  | "ghcr-missing";

/**
 * Discriminated-union signal — success carries the full digest tuple +
 * status; error carries only `errorDesc`. Callers discriminate on the
 * presence of `errorDesc`.
 */
export type CrossEnvPinDriftSignal =
  | {
      service: string;
      status: CrossEnvPinDriftStatus;
      /** Last-promoted (pinned) digest from prod `source.image`. Empty when unpinned. */
      prodPinnedDigest: string;
      /** Running digest from prod `latestDeployment.meta.imageDigest`. */
      prodRunningDigest: string;
      /** Running digest on staging (reporting only). Empty when staging absent / undeployed. */
      stagingRunningDigest: string;
      /** Whether the pinned digest is still present in GHCR. */
      ghcrPresent: boolean;
      errorDesc?: undefined;
    }
  | { errorDesc: string };

interface InstanceView {
  pinnedDigest: string;
  runningDigest: string;
  rawImage: string;
}

// GraphQL response shape (subset of the project query). Kept minimal —
// only the fields this driver reads.
const ProjectSchema = z.object({
  project: z
    .object({
      services: z.object({
        edges: z.array(
          z.object({
            node: z.object({
              name: z.string(),
              serviceInstances: z.object({
                edges: z.array(
                  z.object({
                    node: z.object({
                      environmentId: z.string(),
                      source: z
                        .object({ image: z.string().nullable() })
                        .nullable(),
                      latestDeployment: z
                        .object({
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
    })
    .nullable(),
});

/**
 * Parse a service-instance node into pinned + running digests. The
 * pinned digest is the `@sha256:…` from `source.image` (empty when the
 * ref is tag-only / unpinned); the running digest is
 * `latestDeployment.meta.imageDigest`.
 */
function readInstance(node: {
  source: { image: string | null } | null;
  latestDeployment?: { meta?: Record<string, unknown> | null } | null;
}): InstanceView {
  const rawImage = node.source?.image ?? "";
  const atIdx = rawImage.lastIndexOf("@");
  const pinnedDigest = atIdx !== -1 ? rawImage.slice(atIdx + 1) : "";
  const rawRunning = node.latestDeployment?.meta?.["imageDigest"];
  const runningDigest = typeof rawRunning === "string" ? rawRunning : "";
  return { pinnedDigest, runningDigest, rawImage };
}

export const crossEnvPinDriftDriver: ProbeDriver<
  CrossEnvPinDriftInput,
  CrossEnvPinDriftSignal
> = {
  kind: CROSS_ENV_PIN_DRIFT_KIND,
  inputSchema: crossEnvPinDriftInputSchema,
  async run(ctx, input): Promise<ProbeResult<CrossEnvPinDriftSignal>> {
    const observedAt = ctx.now().toISOString();
    const error = (errorDesc: string): ProbeResult<CrossEnvPinDriftSignal> => ({
      key: input.key,
      state: "error",
      signal: { errorDesc },
      observedAt,
    });

    const token = ctx.env.RAILWAY_TOKEN;
    const projectId = ctx.env.RAILWAY_PROJECT_ID;
    if (!token || !projectId) {
      ctx.logger.warn("driver.cross-env-pin-drift.missing-creds", {
        service: input.name,
      });
      return error(
        "RAILWAY_TOKEN and RAILWAY_PROJECT_ID must both be set for the cross-env pin-drift probe",
      );
    }

    const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
    const gql = makeGql({
      fetchImpl,
      token,
      sourceName: "cross-env-pin-drift",
      abortSignal: ctx.abortSignal,
      logger: ctx.logger,
    });

    // Single project query returning every env's instances; we filter to
    // prod + staging client-side (same pattern as railway-services).
    let projectData: unknown;
    try {
      const result = await gql<unknown>(
        `query crossEnvPinDrift($id: String!) {
          project(id: $id) {
            services {
              edges { node {
                name
                serviceInstances {
                  edges { node {
                    environmentId
                    source { image }
                    latestDeployment { meta }
                  } }
                }
              } }
            }
          }
        }`,
        { id: projectId },
      );
      projectData = result.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // `makeGql` throws the discovery error taxonomy
      // (DiscoverySource{Auth,Transport,Backend,Schema}Error) on
      // auth/transport/HTTP/body faults, plus a bare Error on anything
      // unforeseen. All of them collapse to one keyed `state:"error"`
      // result so a Railway fault is a single actionable line in the
      // writer log rather than an uncaught crash that takes down the
      // probe tick. `errClass` records WHICH taxonomy class fired so an
      // operator can tell a 401 from a DNS blip without parsing the
      // message string.
      const errClass =
        err instanceof DiscoverySourceAuthError ||
        err instanceof DiscoverySourceTransportError ||
        err instanceof DiscoverySourceBackendError
          ? err.name
          : "unknown";
      ctx.logger.warn("driver.cross-env-pin-drift.railway-failed", {
        service: input.name,
        errClass,
        err: message,
      });
      return error(`railway query failed: ${message}`);
    }

    const parsed = ProjectSchema.safeParse(projectData);
    if (!parsed.success) {
      return error(
        `railway project response did not match expected shape: ${parsed.error.message}`,
      );
    }
    if (parsed.data.project === null) {
      return error(
        `railway project ${projectId} returned null — check RAILWAY_PROJECT_ID and token access`,
      );
    }

    const svc = parsed.data.project.services.edges.find(
      (e) => e.node.name === input.name,
    );
    if (!svc) {
      return error(`service ${input.name} not found in railway project`);
    }

    const prodNode = svc.node.serviceInstances.edges.find(
      (e) => e.node.environmentId === input.prodEnvId,
    )?.node;
    if (!prodNode) {
      return error(
        `service ${input.name} has no instance in prod env ${input.prodEnvId}`,
      );
    }
    const prod = readInstance(prodNode);

    const stagingNode = input.stagingEnvId
      ? svc.node.serviceInstances.edges.find(
          (e) => e.node.environmentId === input.stagingEnvId,
        )?.node
      : undefined;
    const stagingRunningDigest = stagingNode
      ? readInstance(stagingNode).runningDigest
      : "";

    // (1) Prod must be pinned to an `@sha256:` digest — that pinned ref
    // IS the last-promoted digest under the promote contract.
    if (prod.pinnedDigest === "" || !prod.pinnedDigest.startsWith("sha256:")) {
      ctx.logger.warn("driver.cross-env-pin-drift.unpinned", {
        service: input.name,
        image: prod.rawImage,
      });
      return {
        key: input.key,
        state: "red",
        signal: {
          service: input.name,
          status: "unpinned",
          prodPinnedDigest: prod.pinnedDigest,
          prodRunningDigest: prod.runningDigest,
          stagingRunningDigest,
          ghcrPresent: false,
        },
        observedAt,
      };
    }

    // (2) Prod must be RUNNING the pinned/last-promoted digest. A
    // running digest that differs (or is absent) means prod drifted off
    // what it was promoted to. An absent running digest is treated as a
    // mismatch (we cannot prove prod is running the pin), staying red.
    if (prod.runningDigest !== prod.pinnedDigest) {
      ctx.logger.warn("driver.cross-env-pin-drift.regressed", {
        service: input.name,
        pinned: prod.pinnedDigest,
        running: prod.runningDigest,
      });
      return {
        key: input.key,
        state: "red",
        signal: {
          service: input.name,
          status: "regressed",
          prodPinnedDigest: prod.pinnedDigest,
          prodRunningDigest: prod.runningDigest,
          stagingRunningDigest,
          ghcrPresent: false,
        },
        observedAt,
      };
    }

    // (3) The last-promoted digest must still exist in GHCR so prod can
    // be re-pulled / rolled forward. A GC'd digest is an alarm even
    // though prod is currently running it (the local image survives, but
    // a re-pull would fail).
    let ghcrPresent: boolean;
    try {
      ghcrPresent = await ghcrDigestPresent(fetchImpl, {
        repository: input.imageRepo,
        reference: prod.pinnedDigest,
        token: ctx.env.GHCR_TOKEN,
        signal: ctx.abortSignal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.warn("driver.cross-env-pin-drift.ghcr-error", {
        service: input.name,
        err: message,
      });
      return error(`ghcr lookup failed: ${message}`);
    }

    if (!ghcrPresent) {
      ctx.logger.warn("driver.cross-env-pin-drift.ghcr-missing", {
        service: input.name,
        digest: prod.pinnedDigest,
      });
      return {
        key: input.key,
        state: "red",
        signal: {
          service: input.name,
          status: "ghcr-missing",
          prodPinnedDigest: prod.pinnedDigest,
          prodRunningDigest: prod.runningDigest,
          stagingRunningDigest,
          ghcrPresent: false,
        },
        observedAt,
      };
    }

    return {
      key: input.key,
      state: "green",
      signal: {
        service: input.name,
        status: "stable",
        prodPinnedDigest: prod.pinnedDigest,
        prodRunningDigest: prod.runningDigest,
        stagingRunningDigest,
        ghcrPresent: true,
      },
      observedAt,
    };
  },
};

// Helpers -------------------------------------------------------------------

/**
 * GET the GHCR manifest endpoint for `<repository>@<digest>` and return
 * whether it is present. A 200 means present; a 404 means GC'd (returns
 * false, NOT an error — a missing pinned digest is a probe signal, not a
 * transport fault). Auth failures and other non-2xx/non-404 statuses, and
 * transport rejections, throw so the driver surfaces them as an error
 * result rather than a false "missing".
 *
 * Mirrors `image-drift.ts`'s `fetchGhcrDigest` request shape (Accept
 * header advertising OCI + Docker v2 media types) but answers a
 * presence question instead of returning the digest header — the
 * reference here IS the digest.
 */
async function ghcrDigestPresent(
  fetchImpl: typeof fetch,
  opts: {
    repository: string;
    reference: string;
    token?: string;
    signal?: AbortSignal;
  },
): Promise<boolean> {
  const path = opts.repository.replace(/^ghcr\.io\//, "");
  const url = `https://ghcr.io/v2/${path}/manifests/${encodeURIComponent(opts.reference)}`;
  const headers: Record<string, string> = {
    Accept: [
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.oci.image.index.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.docker.distribution.manifest.list.v2+json",
    ].join(", "),
  };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers, signal: opts.signal });
  } catch (err) {
    throw new Error(
      `ghcr fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (res.status === 404) return false;
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `ghcr auth failed: ${res.status} ${res.statusText || ""}`.trim(),
    );
  }
  if (!res.ok) {
    throw new Error(`ghcr manifest lookup ${res.status}`);
  }
  return true;
}
