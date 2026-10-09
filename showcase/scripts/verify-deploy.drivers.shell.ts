import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";
import { probeBaseline } from "./verify-deploy.drivers.baseline";

/**
 * Feature-level verifier for the Next.js `shell` service (the main
 * showcase shell). Per spec §3.5 ("200 ≠ healthy") the eventual goal
 * is to load the page and assert a known DOM string + a known network
 * call. The baseline implemented here is the floor every driver must
 * meet:
 *   1. Railway deployment-SUCCESS for the resolved env (GraphQL).
 *   2. HTTP 200 on `https://<host>/` (the shell's Next.js root).
 *
 * Driver-specific DOM + network-call extensions can compose on top of
 * `probeBaseline` (run after a green baseline) when the per-driver
 * micro-tasks land. Until then, this baseline is the agreed completion
 * bar — and crucially, NO driver remains a "not yet implemented" stub.
 */
export async function probeShell(target: ProbeTarget): Promise<ProbeOutcome> {
  return probeBaseline(target, {
    driverLabel: "shell",
    healthcheckPath: "/",
  });
}
