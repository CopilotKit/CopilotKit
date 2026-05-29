import type { ProbeTarget } from "./verify-deploy";
import type { ProbeOutcome } from "./verify-deploy.drivers";

/**
 * Feature-level verifier for Next.js shell services (showcase shell).
 * Per spec §3.5 ("200 ≠ healthy"): must load the page and assert a known
 * DOM string PLUS a known network call. Stub until the per-driver
 * micro-task lands the real impl (fails loud — no silent skip).
 */
export async function probeShell(target: ProbeTarget): Promise<ProbeOutcome> {
    return {
        ok: false,
        error: `shell driver not yet implemented for ${target.name} (${target.host})`,
    };
}
