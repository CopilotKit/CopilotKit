import { describe, it, expect } from "vitest";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";
import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotRuntimeLike } from "../core/runtime";

function makeRuntime(overrides: Partial<CopilotRuntimeLike> = {}): CopilotRuntimeLike {
  return {
    agents: {},
    ...overrides,
  } as unknown as CopilotRuntimeLike;
}

function makeAgent(headers: Record<string, string>): AbstractAgent & { headers: Record<string, string> } {
  return {
    headers,
    clone: () => makeAgent({ ...headers }),
  } as unknown as AbstractAgent & { headers: Record<string, string> };
}

describe("configureAgentForRequest", () => {
  it("agent-defined headers take precedence over forwarded request headers", () => {
    const agent = makeAgent({ Authorization: "Bearer oidc-token-for-backend" });

    const request = new Request("https://example.com", {
      headers: {
        // Browser's Authorization (e.g. IAP or user token) must not overwrite the agent's
        authorization: "Bearer browser-token",
        "x-custom": "from-browser",
      },
    });

    configureAgentForRequest({
      runtime: makeRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    expect((agent as { headers: Record<string, string> }).headers["Authorization"]).toBe(
      "Bearer oidc-token-for-backend",
    );
  });

  it("merges forwarded x-* headers when agent has no conflict", () => {
    const agent = makeAgent({ Authorization: "Bearer oidc-token" });

    const request = new Request("https://example.com", {
      headers: {
        "x-request-id": "req-123",
        "x-trace": "trace-abc",
      },
    });

    configureAgentForRequest({
      runtime: makeRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    const headers = (agent as { headers: Record<string, string> }).headers;
    expect(headers["Authorization"]).toBe("Bearer oidc-token");
    expect(headers["x-request-id"]).toBe("req-123");
    expect(headers["x-trace"]).toBe("trace-abc");
  });
});
