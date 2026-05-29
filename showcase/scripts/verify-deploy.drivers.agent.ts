import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for generic agent backends (showcase-* integration
 * services). Per spec §3.5: feature-level fixture call into the integration's
 * /api endpoint. Stub fails loud.
 */
export async function probeAgent(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `agent driver not yet implemented for ${target.name} (${target.host})`,
    };
}
