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
 * Reads the body only when a CopilotCloud key is present. Guardrails reach a
 * runtime as `forwardedProps.cloud.guardrails`, which only a CopilotCloud
 * client sends, and that client always sends its key — so for every other
 * request this would clone the body to learn a constant `false`. `readBody`
 * clones rather than consuming, so the handler can still parse the request.
 */
export async function readGuardrailsEnabled(
  request: Request,
): Promise<boolean> {
  if (!request.headers.get("x-copilotcloud-public-api-key")) return false;
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
