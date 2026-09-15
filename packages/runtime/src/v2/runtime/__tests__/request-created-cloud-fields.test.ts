/**
 * The CopilotCloud fields on `oss.runtime.copilot_request_created`.
 *
 * The real `cloud.guardrails.enabled` used to come only from the v1
 * entrypoint's own middleware, which emitted a second copy of this event to
 * carry it. That copy is gone, so these assertions are what keeps the field
 * from going with it.
 *
 * The v1 copy also carried `cloud.base_url`. That one is not ported — the
 * conformance suite pins this event's exact property set across all six
 * runtimes — so there is nothing here to assert about it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { handleRunAgent } from "../handlers/handle-run";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";
import { telemetry } from "../telemetry";
import type { CopilotRuntime } from "../core/runtime";

const CLOUD_KEY = "ck_live_abc123.secret";

function mockRuntime(): CopilotRuntime {
  return {
    agents: Promise.resolve({}),
    transcriptionService: undefined,
    beforeRequestMiddleware: undefined,
    afterRequestMiddleware: undefined,
    forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
  } as unknown as CopilotRuntime;
}

function runRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://example.com/agent/missing/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("copilot_request_created — CopilotCloud guardrails", () => {
  let capture: MockInstance<typeof telemetry.capture>;

  beforeEach(() => {
    capture = vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function properties(): Record<string, unknown> {
    return capture.mock.calls[0][1] as Record<string, unknown>;
  }

  it("sends exactly the canonical property set for a non-cloud run", async () => {
    // Mirrors the cross-language contract in
    // `tools/runtime-conformance/telemetry-cases.mjs`, which deepEquals this
    // event's properties for every runtime SDK. A field added here that the
    // Go, Python, Ruby and .NET runtimes do not send breaks that suite —
    // `cloud.base_url` did exactly that and only CI caught it.
    await handleRunAgent({
      runtime: mockRuntime(),
      request: runRequest({}),
      agentId: "missing",
    });

    expect(properties()).toEqual({
      requestType: "run",
      "cloud.guardrails.enabled": false,
      "cloud.api_key_provided": false,
    });
  });

  it("reports forwarded guardrails for a CopilotCloud caller", async () => {
    await handleRunAgent({
      runtime: mockRuntime(),
      request: runRequest(
        { forwardedProps: { cloud: { guardrails: { rules: [] } } } },
        { "x-copilotcloud-public-api-key": CLOUD_KEY },
      ),
      agentId: "missing",
    });

    expect(properties()).toMatchObject({
      "cloud.guardrails.enabled": true,
      "cloud.api_key_provided": true,
      "cloud.public_api_key": CLOUD_KEY,
    });
  });

  it("reports guardrails off for a CopilotCloud caller that forwards none", async () => {
    await handleRunAgent({
      runtime: mockRuntime(),
      request: runRequest(
        { forwardedProps: {} },
        {
          "x-copilotcloud-public-api-key": CLOUD_KEY,
        },
      ),
      agentId: "missing",
    });

    expect(properties()["cloud.guardrails.enabled"]).toBe(false);
  });

  it("does not read the body when there is no CopilotCloud key", async () => {
    // Guardrails only ever arrive from a CopilotCloud client, which always
    // sends its key. Reading otherwise would clone every request body to
    // learn a constant false, on the hot path, for every self-hosted user.
    const request = runRequest({
      forwardedProps: { cloud: { guardrails: { rules: [] } } },
    });
    const clone = vi.spyOn(request, "clone");

    await handleRunAgent({
      runtime: mockRuntime(),
      request,
      agentId: "missing",
    });

    expect(properties()["cloud.guardrails.enabled"]).toBe(false);
    expect(clone).not.toHaveBeenCalled();
  });
});
