import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the `showcase-harness` API service.
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on
 * `/health` (the harness's documented healthcheck path; mirrors the
 * `health_path` table in `.github/workflows/showcase_deploy.yml`).
 * Future driver-specific layer: synthetic e2e fixture call against
 * the harness's `/run` API.
 */
export async function probeHarness(target: ProbeTarget): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "harness",
    healthcheckPath: "/health",
  });
}
