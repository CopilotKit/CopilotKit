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

import { isTelemetryDisabled } from "@copilotkit/shared";

// Canonical telemetry docs page on main.
const TELEMETRY_DOCS_URL = "https://docs.copilotkit.ai/telemetry";

let disclosureLogged = false;

/**
 * Logs a one-line console.info about anonymous telemetry on runtime
 * startup. No-op when telemetry is disabled via `COPILOTKIT_TELEMETRY_DISABLED`
 * or `DO_NOT_TRACK`, or when already logged once in this process.
 *
 * Idempotent — safe to call from multiple constructor paths.
 */
export function logRuntimeTelemetryDisclosure(): void {
  if (disclosureLogged) return;
  if (isTelemetryDisabled()) return;
  disclosureLogged = true;
  // eslint-disable-next-line no-console
  console.info(
    `[CopilotKit Runtime] anonymous telemetry enabled — see ${TELEMETRY_DOCS_URL} to opt out (set COPILOTKIT_TELEMETRY_DISABLED=true).`,
  );
}

// Test-only reset hook so the once-per-process guard doesn't leak between
// test cases. Not part of the public package surface — used by the runtime
// disclosure tests.
export function _resetRuntimeTelemetryDisclosureForTesting(): void {
  disclosureLogged = false;
}
