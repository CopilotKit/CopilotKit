import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for showcase-eval. Per spec §3.5: synthetic e2e
 * fixture call against the service's API. Stub fails loud.
 */
export async function probeEval(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `eval driver not yet implemented for ${target.name} (${target.host})`,
    };
}
