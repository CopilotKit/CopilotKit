import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for `showcase-webhooks` (eval webhook relay).
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on
 * `/api/health` (matches the API-shaped service convention used by
 * every other agent/relay service in the SSOT). Future driver-specific
 * layer: synthetic event POST + downstream-fanout confirmation.
 */
export async function probeWebhooks(
  target: ProbeTarget,
): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "webhooks",
    healthcheckPath: "/api/health",
  });
}
