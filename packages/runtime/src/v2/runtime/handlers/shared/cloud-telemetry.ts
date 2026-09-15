// CopilotCloud fields on `oss.runtime.copilot_request_created`.
//
// Both live here because the v1 entrypoint used to compute them in its own
// middleware and emit a second copy of the event. That copy is gone; these
// are what it carried and the v2 handlers did not.

import { readBody } from "@copilotkit/shared";
import type { RunAgentInput } from "@ag-ui/client";

/** The CopilotCloud API the runtime would talk to, however it is configured. */
export function cloudBaseUrl(): string {
  return (
    process.env.COPILOT_CLOUD_BASE_URL || "https://api.cloud.copilotkit.ai"
  );
}

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
