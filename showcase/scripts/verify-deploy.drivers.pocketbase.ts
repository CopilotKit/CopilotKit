import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the `pocketbase` service.
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on
 * `/api/health` (PocketBase's standard health endpoint). Future
 * driver-specific layer: admin login + known collection list assertion.
 */
export async function probePocketbase(
  target: ProbeTarget,
): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "pocketbase",
    healthcheckPath: "/api/health",
  });
}
