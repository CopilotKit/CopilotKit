import { z } from "zod";
import type { DiscoveryContext, DiscoverySource } from "../types.js";
import { railwayServicesSource } from "./railway-services.js";

/**
 * Discovery source for the CROSS-ENV pin-drift probe (plan U11 / spec
 * §7.3). Wiring layer between `railway-services` (which enumerates the
 * `showcase-*` service roster for ONE env) and the `pin_drift_cross_env`
 * driver (U6), which needs, per service:
 *
 *   - `name`        — the Railway service name (from railway-services).
 *   - `imageRepo`   — the GHCR repo (no tag/digest) the pinned digest is
 *                     looked up in; derived from the service's `imageRef`.
 *   - `prodEnvId`   — the pinned side (asserted against).
 *   - `stagingEnvId`— the floating side (reporting only; the driver reads
 *                     it for the prod/staging digest pair in one signal).
 *
 * `railway-services` is SINGLE-ENV (`RAILWAY_ENVIRONMENT_ID` from
 * ctx.env) — so we enumerate it ONCE to get the service roster + image
 * refs, then stamp the prod/staging env-ids onto every record. The driver
 * itself runs a two-env project query (it filters prod + staging
 * client-side from the single project query), so no second discovery pass
 * is needed here.
 *
 * `rootDir: src` forbids importing `showcase/scripts/railway-envs.ts`
 * (the env-id SSOT), so the env-ids are read from `ctx.env` with the SSOT
 * values mirrored as the default. The mirror is kept in lockstep with
 * `showcase/scripts/railway-envs.ts` (PRODUCTION_ENV_ID / STAGING_ENV_ID);
 * the env-var override (`RAILWAY_PROD_ENVIRONMENT_ID` /
 * `RAILWAY_STAGING_ENVIRONMENT_ID`) lets staging/CI point at a different
 * project without a code change.
 */

/**
 * SSOT mirror of `showcase/scripts/railway-envs.ts` — kept in lockstep.
 * `rootDir: src` forbids the cross-package import, so these are mirrored
 * here and overridable via env so a non-prod project (CI) can re-point.
 */
const DEFAULT_PROD_ENV_ID = "b14919f4-6417-429f-848d-c6ae2201e04f";
const DEFAULT_STAGING_ENV_ID = "8edfef02-ea09-4a20-8689-261f21cc2849";

/**
 * Filter block mirrors railway-services' (namePrefix + nameExcludes) since
 * we delegate enumeration to it. `.passthrough()` so the YAML filter flows
 * straight through to the delegate without re-declaring each field.
 */
const ConfigSchema = z
  .object({
    namePrefix: z.string().optional(),
    nameExcludes: z.array(z.string()).optional(),
  })
  .passthrough();

/** Per-service record handed to the `pin_drift_cross_env` driver. */
export interface CrossEnvPinDriftRecord {
  name: string;
  imageRepo: string;
  prodEnvId: string;
  stagingEnvId: string;
}

/**
 * Strip the `:tag` and/or `@sha256:…` suffix off an `imageRef` to get the
 * bare GHCR repository (`ghcr.io/<org>/<name>`). Mirrors the right-to-left
 * parse in `image-drift.ts:parseImageRef` (digest first, then the LAST `:`
 * in the final path segment so a `registry:5000/...` port isn't mistaken
 * for a tag). Returns "" for an empty ref so the driver surfaces a
 * deterministic GHCR-lookup error rather than guessing a repo.
 */
export function imageRepoFromRef(imageRef: string): string {
  if (!imageRef) return "";
  const atIdx = imageRef.lastIndexOf("@");
  const withoutDigest = atIdx !== -1 ? imageRef.slice(0, atIdx) : imageRef;
  const slashIdx = withoutDigest.lastIndexOf("/");
  const lastSegment =
    slashIdx === -1 ? withoutDigest : withoutDigest.slice(slashIdx + 1);
  const colonIdx = lastSegment.indexOf(":");
  if (colonIdx === -1) return withoutDigest;
  return (
    (slashIdx === -1 ? "" : withoutDigest.slice(0, slashIdx + 1)) +
    lastSegment.slice(0, colonIdx)
  );
}

export const crossEnvPinDriftDiscoverySource: DiscoverySource<CrossEnvPinDriftRecord> =
  {
    name: "cross-env-pin-drift",
    configSchema: ConfigSchema,
    async enumerate(
      ctx: DiscoveryContext,
      rawConfig,
    ): Promise<CrossEnvPinDriftRecord[]> {
      const prodEnvId =
        ctx.env.RAILWAY_PROD_ENVIRONMENT_ID ?? DEFAULT_PROD_ENV_ID;
      const stagingEnvId =
        ctx.env.RAILWAY_STAGING_ENVIRONMENT_ID ?? DEFAULT_STAGING_ENV_ID;

      // Delegate the service-roster enumeration to railway-services (it
      // already applies the namePrefix/nameExcludes filter, the
      // LOCAL_SERVICES_JSON seam, and the auth/transport/schema error
      // taxonomy). A throw here propagates to the invoker as a single
      // keyed discovery-error tile — same as any other source.
      const services = await railwayServicesSource.enumerate(ctx, rawConfig);

      return services.map((svc) => ({
        name: svc.name,
        imageRepo: imageRepoFromRef(svc.imageRef),
        prodEnvId,
        stagingEnvId,
      }));
    },
  };
