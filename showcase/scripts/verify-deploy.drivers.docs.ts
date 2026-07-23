import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the `shell-docs` Next.js service.
 *
 * Baseline (this commit): Railway deployment-SUCCESS + HTTP 200 on `/`.
 * Future driver-specific layer: DOM-string assertion + the structural
 * `<main>` + `<h1>` heuristic from `probe-shell-docs.ts` so a 200 with
 * the 404 chrome is still treated as red. That extension composes on
 * top of `probeBaseline` once the per-driver micro-task lands.
 */
export async function probeDocs(target: ProbeTarget): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "docs",
    healthcheckPath: "/",
  });
}
