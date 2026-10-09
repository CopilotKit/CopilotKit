import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the `aimock` service (the showcase
 * wrapper image baked with fixtures).
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on
 * `/health` (mirrors the `health_path` for `showcase-aimock` in
 * `.github/workflows/showcase_deploy.yml`). Future driver-specific
 * layer: fixture replay with deterministic-response drift check
 * (POST a known prompt, assert recorded response shape).
 */
export async function probeAimock(target: ProbeTarget): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "aimock",
    healthcheckPath: "/health",
  });
}
