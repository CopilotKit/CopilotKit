import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for `showcase-eval`.
 *
 * No SSOT entry currently sets `probe.driver === "eval"` (eval has not
 * been wired into the SSOT yet), but the enum literal exists in
 * `railway-envs.ts::ProbeDriver` and the dispatch switch in
 * `verify-deploy.drivers.ts` routes to this function. Per the
 * cross-workstream contract (the 10-literal enum is the surface), every
 * literal must have a working baseline impl — so this is NOT a stub.
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on
 * `/api/health` (the standard Next.js/Express health path used by every
 * other API-shaped service in the SSOT). Future driver-specific layer:
 * synthetic eval-run fixture call.
 */
export async function probeEval(target: ProbeTarget): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "eval",
    healthcheckPath: "/api/health",
  });
}
