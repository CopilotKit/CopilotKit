import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for shell-dashboard. Per spec §3.5: must load
 * the page and assert a known DOM string plus a known network call.
 * Stub fails loud.
 */
export async function probeDashboard(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `dashboard driver not yet implemented for ${target.name} (${target.host})`,
    };
}
