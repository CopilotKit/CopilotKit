// The CopilotCloud guardrails flag on `oss.runtime.copilot_request_created`.
//
// It lives here because the v1 entrypoint used to compute it in its own
// middleware and emit a second copy of the event. That copy is gone; this is
// what it carried and the v2 handlers did not.
//
// The v1 copy also carried `cloud.base_url`, which is deliberately not
// ported. The cross-language conformance suite pins this event to exactly
// requestType, cloud.guardrails.enabled and cloud.api_key_provided
// (`tools/runtime-conformance/telemetry-cases.mjs`), and the four native
// runtimes send nothing else. A near-constant read off an env var is not
// worth diverging the canonical event shape for.

import { readBody } from "@copilotkit/shared";
import type { RunAgentInput } from "@ag-ui/client";

/**
 * Whether the caller forwarded CopilotCloud guardrails configuration.
 *
 * Guardrails reach a runtime as `forwardedProps.cloud.guardrails`. An earlier
 * version read the body only when the CopilotCloud key header was present,
 * because in principle only a CopilotCloud client sends guardrails and that
 * client always sends its key. Production does not hold to that: of 112
 * guardrails-enabled requests over 90 days, 2 carried no key, and they
 * undercounted as `false`. The signal is rare enough — 13 people across 9
 * Cloud keys in a year — that losing 2% of it to save a body clone is a bad
 * trade, so the body is now always read.
 *
 * `readBody` clones rather than consuming, so the handler can still parse the
 * request afterwards.
 */
export async function readGuardrailsEnabled(
  request: Request,
): Promise<boolean> {
  try {
    const body = (await readBody(request)) as RunAgentInput | undefined;
    const forwardedProps = body?.forwardedProps as
      | { cloud?: { guardrails?: unknown } }
      | undefined;
    return forwardedProps?.cloud?.guardrails !== undefined;
  } catch {
    // Telemetry must never decide whether a request is served.
    return false;
  }
}
