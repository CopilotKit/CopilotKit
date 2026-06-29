/**
 * Availability gate for Glass Engine (advanced inspector mode).
 *
 * This is the DEPLOYMENT-level gate, distinct from the presenter's runtime
 * on/off toggle (localStorage, see glass-engine-context). When unset, Glass
 * Engine does not exist for that deployment: the left-rail toggle is not
 * rendered and the /api/memories* proxy routes 404. Public hosting leaves it
 * unset; FDE/sales/conference deployments set `GLASS_ENGINE_AVAILABLE=true`.
 *
 * Server-only — it reads a non-NEXT_PUBLIC_ env var so the value is decided per
 * deployment at runtime (one image, many destinations), never baked into the
 * client bundle. The client learns it as a prop threaded from app/layout.tsx.
 *
 * Strict equality to "true" so a stray "1"/"yes" can't accidentally expose the
 * inspector on a public host.
 */
export function glassEngineAvailable(): boolean {
  return process.env.GLASS_ENGINE_AVAILABLE === "true";
}
