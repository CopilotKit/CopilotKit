import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for showcase-harness. Per spec §3.5: synthetic
 * e2e fixture call against the service's API. Stub fails loud.
 */
export async function probeHarness(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `harness driver not yet implemented for ${target.name} (${target.host})`,
    };
}
