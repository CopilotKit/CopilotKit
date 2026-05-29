// Server-only runtime config reader. Reads from process.env at REQUEST
// time (not at module load) so a single built artifact can serve
// different URL values across staging vs prod by changing the Railway
// service's env vars — no rebuild required.
//
// `unstable_noStore()` opts the calling segment out of Next.js's static
// cache so reads always reflect the live env. Without it, a server
// component that uses this could be statically rendered at build time
// and freeze the URLs back into the artifact — defeating the runtime
// switch. See Next.js App Router docs on Dynamic Rendering.
//
// This module MUST NOT be imported from client components. The matching
// client-side reader lives in runtime-config.client.ts and reads from
// window.__SHOWCASE_CONFIG__ which the root layout injects.
//
// shell-dojo today has no URL consumers (zero process.env.NEXT_PUBLIC_*
// reads in this shell). The `RuntimeConfig` interface is intentionally
// an empty object literal — it exists to keep the runtime-config /
// layout-injection pattern symmetric across the shells. Adding a URL
// later means adding a field here, reading it from process.env via
// `readUrl`, and the client-side reader picks it up automatically
// through the shared interface.

import { unstable_noStore as noStore } from "next/cache";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RuntimeConfig {}

/**
 * Resolve the runtime config for shell-dojo. Called once per request
 * by the root layout. Currently returns an empty object since
 * shell-dojo has no URL-dependent consumers; the module exists to keep
 * the pattern symmetric across shells (see shell-dashboard's
 * runtime-config.ts for the full template).
 *
 * `opts.noStore` (default `true`) controls whether to call
 * `unstable_noStore()`. The Node.js server runtime needs the opt-out
 * so Next.js does not statically prerender callers and freeze any
 * future URL values into the build artifact.
 */
export function getRuntimeConfig(
    opts: { noStore?: boolean } = {},
): RuntimeConfig {
    if (opts.noStore !== false) noStore();
    return {};
}
