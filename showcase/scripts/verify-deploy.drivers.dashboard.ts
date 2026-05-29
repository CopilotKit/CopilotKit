import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the `shell-dashboard` Next.js service.
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on `/`.
 * Future driver-specific layer: dashboard-DOM assertion (catches the
 * "rendered the 404 chrome with 200" case Next.js dev quirks produce).
 */
export async function probeDashboard(target: ProbeTarget): Promise<ProbeOutcome> {
    return probeBaseline(target, {
        driverLabel: "dashboard",
        healthcheckPath: "/",
    });
}
