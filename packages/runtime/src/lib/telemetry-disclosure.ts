// Runtime-side anonymous telemetry disclosure log.
//
// The runtime has shipped anonymous telemetry for some time (see
// `packages/shared/src/telemetry/telemetry-client.ts`). This file just
// surfaces a one-line pointer to the opt-out docs on first
// instantiation so operators don't have to dig through the docs site
// to discover the existing behavior. Pairs with the inspector's
// first-run console disclosure for a consistent operator-facing
// surface.
//
// Fires at most once per process — runtime instances may be constructed
// multiple times (tests, hot-reload), but the disclosure is informational
// and a single line is enough.
//
// The once-guard lives on `globalThis`, not a module-level variable,
// because "once per process" must survive module re-evaluation. Next.js
// dev compiles each API route in its own module context, and the runtime
// ships as both ESM and CJS builds, so a module-scoped flag is reborn per
// route compile / per package copy and the disclosure re-fires on every
// one. A single global slot is shared across all of them.

// Canonical telemetry docs page on main.
// Mirror constant: packages/web-inspector/src/lib/telemetry.ts
const TELEMETRY_DOCS_URL = "https://docs.copilotkit.ai/telemetry";

function isTelemetryDisabled(): boolean {
  const env = process.env as Record<string, string | undefined>;
  return (
    env.COPILOTKIT_TELEMETRY_DISABLED === "true" ||
    env.COPILOTKIT_TELEMETRY_DISABLED === "1" ||
    env.DO_NOT_TRACK === "true" ||
    env.DO_NOT_TRACK === "1"
  );
}

// Process-wide once-guard slot. A global-registry symbol (`Symbol.for`)
// resolves to the same key across every copy of this module — ESM/CJS
// builds and Next.js per-route module contexts alike — so the flag is
// genuinely shared process-wide.
const DISCLOSURE_GUARD = Symbol.for(
  "copilotkit.runtime.telemetryDisclosureLogged",
);

// `Symbol.for` is typed as `symbol` (not `unique symbol`), so it can't be a
// computed property name; a symbol index signature is the valid way to read
// and write the slot off `globalThis`.
type DisclosureGlobal = Record<symbol, boolean | undefined>;

/**
 * Logs a one-line console.info about anonymous telemetry on runtime
 * startup. No-op when telemetry is disabled via `COPILOTKIT_TELEMETRY_DISABLED`
 * or `DO_NOT_TRACK`, or when already logged once in this process.
 *
 * Idempotent — safe to call from multiple constructor paths.
 */
export function logRuntimeTelemetryDisclosure(): void {
  const guard = globalThis as unknown as DisclosureGlobal;
  if (guard[DISCLOSURE_GUARD]) return;
  if (isTelemetryDisabled()) return;
  guard[DISCLOSURE_GUARD] = true;
  // eslint-disable-next-line no-console
  console.info(
    `[CopilotKit Runtime] anonymous telemetry enabled — see ${TELEMETRY_DOCS_URL} to opt out (set COPILOTKIT_TELEMETRY_DISABLED=true).`,
  );
}

// Test-only reset hook so the once-per-process guard doesn't leak between
// test cases. Not part of the public package surface — used by the runtime
// disclosure tests.
export function _resetRuntimeTelemetryDisclosureForTesting(): void {
  (globalThis as unknown as DisclosureGlobal)[DISCLOSURE_GUARD] = false;
}
