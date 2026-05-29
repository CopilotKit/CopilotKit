import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for the aimock service. Per spec §3.5: fixture
 * replay with deterministic-response drift check. Stub fails loud.
 */
export async function probeAimock(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `aimock driver not yet implemented for ${target.name} (${target.host})`,
    };
}
