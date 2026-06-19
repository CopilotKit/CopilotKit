import { CROSS_ENV_PIN_DRIFT_KIND } from "./drivers/cross-env-pin-drift.js";

/**
 * Ops-surface drift routing (plan U11 / spec §7.3).
 *
 * There are TWO drift signals the Ops surface can show per service, and
 * they answer DIFFERENT questions:
 *
 *   - `image_drift` ("`:latest`-drift") compares ONE env's running digest
 *     against the GHCR `:latest` tag. That is the right question for
 *     STAGING, which floats `:latest` by contract — a staging deploy
 *     behind `:latest` is genuine drift. But on PROD (intentionally
 *     PINNED to a digest) "behind :latest" is EXPECTED, so image-drift
 *     neutralizes it to GREEN via `pinnedExpected`. That neutralization
 *     does not VERIFY prod — it merely SUPPRESSES the signal, so the Ops
 *     surface effectively lies about pinned prod (always green, even if
 *     prod drifted off its last-promoted digest or that digest was GC'd).
 *   - `pin_drift_cross_env` (U6's CROSS-ENV pin-drift) is the real prod
 *     signal: it asserts prod is RUNNING the digest it was LAST PROMOTED
 *     to AND that the digest is still present in GHCR — NOT "matches
 *     :latest".
 *
 * So the Ops surface routes by the harness's deploy environment:
 *   PROD    → `pin_drift_cross_env`   (verify the pin)
 *   STAGING → `image_drift`           (verify floating `:latest`)
 *
 * The env resolution mirrors `image-drift.ts`'s `isProductionEnv` exactly
 * (explicit `SHOWCASE_ENV` override, then Railway's injected
 * `RAILWAY_ENVIRONMENT_NAME`, case-insensitive exact-match on
 * "production") so the routing and the driver agree on "is this prod?".
 * Only a genuine production label routes to the cross-env path — "staging",
 * "unknown", and unset all fall to `image_drift` so a missing env var can
 * never silently route prod-verification onto a guess.
 */

/** Probe kind the Ops surface uses for PROD drift — U6's cross-env probe. */
export const OPS_PROD_DRIFT_KIND = CROSS_ENV_PIN_DRIFT_KIND;

/** Probe kind the Ops surface uses for STAGING drift — `:latest`-drift. */
export const OPS_STAGING_DRIFT_KIND = "image_drift" as const;

export type OpsDriftKind =
  | typeof OPS_PROD_DRIFT_KIND
  | typeof OPS_STAGING_DRIFT_KIND;

/**
 * Resolve whether the harness deploy environment is production. Mirrors
 * `image-drift.ts:isProductionEnv` (and the orchestrator's `sourceEnv`
 * resolution): explicit `SHOWCASE_ENV` override wins, then Railway's
 * injected `RAILWAY_ENVIRONMENT_NAME`. Case-insensitive exact match on
 * "production" — "staging", "unknown", and unset all return false.
 */
function isProductionEnv(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const name = env.SHOWCASE_ENV ?? env.RAILWAY_ENVIRONMENT_NAME;
  return typeof name === "string" && name.trim().toLowerCase() === "production";
}

/**
 * Select the authoritative drift probe kind for the Ops surface given the
 * harness's environment: PROD → cross-env pin-drift, everything else →
 * `:latest` image-drift. See the module docstring for why the prod path
 * must NOT use image-drift (the `pinnedExpected` lie).
 */
export function selectDriftProbeKind(
  env: Readonly<Record<string, string | undefined>>,
): OpsDriftKind {
  return isProductionEnv(env) ? OPS_PROD_DRIFT_KIND : OPS_STAGING_DRIFT_KIND;
}
