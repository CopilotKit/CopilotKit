import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for pocketbase. Per spec §3.5: admin login +
 * known collection list. Stub fails loud.
 */
export async function probePocketbase(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `pocketbase driver not yet implemented for ${target.name} (${target.host})`,
    };
}
