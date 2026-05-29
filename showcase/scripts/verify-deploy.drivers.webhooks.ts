import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for showcase-webhooks. Per spec §3.5: synthetic
 * event POST and downstream confirmation. Stub fails loud.
 */
export async function probeWebhooks(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `webhooks driver not yet implemented for ${target.name} (${target.host})`,
    };
}
