import { describe, it, expect } from "vitest";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";
import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotRuntimeLike } from "../core/runtime";

/**
 * Minimal agent stub that satisfies the MiddlewareCapableAgent shape
 * used inside configureAgentForRequest.
 */
function createMockAgent(headers?: Record<string, string>): AbstractAgent {
  return {
    headers,
    // configureAgentForRequest checks `typeof agent.use === "function"`
    use: () => {},
  } as unknown as AbstractAgent;
}

function createMockRuntime(): CopilotRuntimeLike {
  return {
    agents: Promise.resolve({}),
    // The /run call site reads the resolved policy off the runtime; default
    // (built-in denylist on) is fine here since these tests use non-denylisted
    // custom headers.
    forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
  } as unknown as CopilotRuntimeLike;
}

function createRequest(headers: Record<string, string>): Request {
  return new Request("https://example.com/agent/test-agent/run", {
    method: "POST",
    headers,
  });
}

describe("configureAgentForRequest – header forwarding", () => {
  it("forwards x-aimock-context when agent.headers is undefined (default LangGraphAgent)", () => {
    const agent = createMockAgent(/* headers = undefined */);
    const request = createRequest({
      "Content-Type": "application/json",
      "x-aimock-context": "langgraph-python",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    // The core regression: before the fix, agent.headers stayed undefined
    // because the old `if (agent.headers)` guard skipped the assignment.
    expect((agent as any).headers).toBeDefined();
    expect((agent as any).headers["x-aimock-context"]).toBe("langgraph-python");
  });

  it("forwards x-test-id when agent.headers is undefined", () => {
    const agent = createMockAgent();
    const request = createRequest({
      "Content-Type": "application/json",
      "x-test-id": "run-42",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    expect((agent as any).headers["x-test-id"]).toBe("run-42");
  });

  it("merges forwardable headers with pre-existing agent.headers", () => {
    const agent = createMockAgent({
      "x-existing": "keep-me",
      authorization: "Bearer original-token",
    });
    const request = createRequest({
      "Content-Type": "application/json",
      "x-aimock-context": "langgraph-python",
      "x-test-id": "run-99",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    const headers = (agent as any).headers as Record<string, string>;

    // Pre-existing headers preserved
    expect(headers["x-existing"]).toBe("keep-me");
    expect(headers["authorization"]).toBe("Bearer original-token");

    // Forwardable headers merged in
    expect(headers["x-aimock-context"]).toBe("langgraph-python");
    expect(headers["x-test-id"]).toBe("run-99");
  });

  it("server-configured agent headers WIN over a colliding forwarded header (#5712)", () => {
    const agent = createMockAgent({
      "x-aimock-context": "server-context",
    });
    const request = createRequest({
      "x-aimock-context": "inbound-context",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    // Headers the server explicitly configured on the agent are authoritative:
    // an inbound request header must not silently override them (#5712).
    expect((agent as any).headers["x-aimock-context"]).toBe("server-context");
  });

  it("drops a forwarded header that collides case-insensitively with a server header (#5712)", () => {
    // Server uses canonical casing; inbound is normalized to lowercase. Without
    // a case-insensitive match both keys would survive and undici would
    // comma-join them into an invalid "multiple JWTs" value.
    const agent = createMockAgent({
      Authorization: "Bearer SERVER-TOKEN",
    });
    const request = createRequest({
      Authorization: "Bearer INBOUND-TOKEN",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    const headers = (agent as any).headers as Record<string, string>;
    const authKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === "authorization",
    );
    expect(authKeys).toHaveLength(1);
    expect(headers[authKeys[0]!]).toBe("Bearer SERVER-TOKEN");
  });

  it("does NOT forward non-forwardable headers like content-type or origin", () => {
    const agent = createMockAgent();
    const request = createRequest({
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
      "User-Agent": "test-runner",
      Cookie: "session=abc",
      Host: "example.com",
      Accept: "text/event-stream",
      // Only this one should come through
      "x-aimock-context": "langgraph-python",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    const headers = (agent as any).headers as Record<string, string>;

    // Non-forwardable headers must NOT be present
    expect(headers["content-type"]).toBeUndefined();
    expect(headers["origin"]).toBeUndefined();
    expect(headers["user-agent"]).toBeUndefined();
    expect(headers["cookie"]).toBeUndefined();
    expect(headers["host"]).toBeUndefined();
    expect(headers["accept"]).toBeUndefined();

    // The x- header IS forwarded
    expect(headers["x-aimock-context"]).toBe("langgraph-python");
  });

  it("authorization header IS forwarded (it is in the allowlist)", () => {
    const agent = createMockAgent();
    const request = createRequest({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    const headers = (agent as any).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret-token");
    expect(headers["content-type"]).toBeUndefined();
  });

  it("strips denylisted infra/platform headers while forwarding custom x-* (#5712 breadth)", () => {
    const agent = createMockAgent();
    const request = createRequest({
      "Content-Type": "application/json",
      // Denylisted infra/platform headers — the leak we're closing.
      "X-Forwarded-For": "203.0.113.7",
      "X-Real-IP": "203.0.113.7",
      "X-Vercel-Id": "iad1::abc",
      "X-Copilotcloud-Public-Api-Key": "ck_pub_secret",
      // Legitimate custom headers — must still forward.
      "X-Tenant-Id": "tenant-123",
      Authorization: "Bearer user-token",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    const headers = (agent as any).headers as Record<string, string>;

    // Denylisted headers must NOT reach the outgoing agent call.
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
    expect(headers["x-vercel-id"]).toBeUndefined();
    expect(headers["x-copilotcloud-public-api-key"]).toBeUndefined();
    // Custom application headers + authorization still forward.
    expect(headers["x-tenant-id"]).toBe("tenant-123");
    expect(headers["authorization"]).toBe("Bearer user-token");
  });

  it("applies a custom forwardHeaders policy from the runtime (plumb-through)", () => {
    const agent = createMockAgent();
    const request = createRequest({
      "X-Forwarded-For": "203.0.113.7",
      "X-Tenant-Id": "tenant-123",
    });

    // useDefaultDenylist:false restores the old wide-open behavior.
    const runtime = {
      agents: Promise.resolve({}),
      forwardHeadersPolicy: resolveForwardHeadersPolicy({
        useDefaultDenylist: false,
      }),
    } as unknown as CopilotRuntimeLike;

    configureAgentForRequest({
      runtime,
      request,
      agentId: "test-agent",
      agent,
    });

    const headers = (agent as any).headers as Record<string, string>;
    // With the denylist disabled, the infra header forwards again — proving the
    // runtime-resolved policy is actually applied on the /run path.
    expect(headers["x-forwarded-for"]).toBe("203.0.113.7");
    expect(headers["x-tenant-id"]).toBe("tenant-123");
  });

  it("does NOT throw and applies the default denylist when the runtime omits forwardHeadersPolicy (non-breaking interface)", () => {
    const agent = createMockAgent();
    const request = createRequest({
      "Content-Type": "application/json",
      // Denylisted infra header — must be stripped by the default policy.
      "X-Forwarded-For": "203.0.113.7",
      // Legitimate custom + authorization — must still forward.
      "X-Tenant-Id": "tenant-123",
      Authorization: "Bearer user-token",
    });

    // A policy-less external `CopilotRuntimeLike` implementor: `forwardHeadersPolicy`
    // is OMITTED entirely (optional on the published interface). Before the fix the
    // /run call site passed `undefined` straight into the merge, which dereffed
    // `policy.allow` and threw. After the fix it coalesces to the default resolved
    // policy (default-on denylist).
    const policylessRuntime = {
      agents: Promise.resolve({}),
    } as unknown as CopilotRuntimeLike;

    expect(() =>
      configureAgentForRequest({
        runtime: policylessRuntime,
        request,
        agentId: "test-agent",
        agent,
      }),
    ).not.toThrow();

    const headers = (agent as any).headers as Record<string, string>;
    // Default denylist applied: infra header dropped, custom x-* + authorization forwarded.
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["x-tenant-id"]).toBe("tenant-123");
    expect(headers["authorization"]).toBe("Bearer user-token");
  });

  it("results in empty headers object when request has no forwardable headers and agent.headers is undefined", () => {
    const agent = createMockAgent();
    const request = createRequest({
      "Content-Type": "application/json",
      Origin: "http://localhost",
    });

    configureAgentForRequest({
      runtime: createMockRuntime(),
      request,
      agentId: "test-agent",
      agent,
    });

    // Even with no forwardable headers, agent.headers should be set (not undefined)
    expect((agent as any).headers).toBeDefined();
    expect((agent as any).headers).toEqual({});
  });
});
