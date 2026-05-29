import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for shell-docs. Per spec §3.5: must load the
 * page and assert a known DOM string plus a known network call. Real
 * impl will reuse probe-shell-docs.ts. Stub fails loud.
 */
export async function probeDocs(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `docs driver not yet implemented for ${target.name} (${target.host})`,
    };
}
