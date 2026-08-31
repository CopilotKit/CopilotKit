import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the `shell-dojo` Next.js service.
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on `/`.
 * Future driver-specific layer: dojo-DOM assertion + the AG-UI dojo
 * landing's known network call.
 */
export async function probeDojo(target: ProbeTarget): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "dojo",
    healthcheckPath: "/",
  });
}
