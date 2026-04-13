import { describe, it, expect, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import {
  resolveAgents,
  type AgentsConfig,
  type AgentFactoryContext,
} from "../core/runtime";
import { handleRunAgent } from "../handlers/handle-run";
import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { CopilotRuntime } from "../core/runtime";

function createMockAgent(name = "test") {
  return new HttpAgent({ url: `https://example.com/${name}` });
}

function createMockRuntime(agents: AgentsConfig) {
  return {
    agents,
    transcriptionService: undefined,
    beforeRequestMiddleware: undefined,
    afterRequestMiddleware: undefined,
    runner: { stop: vi.fn().mockResolvedValue(true) },
    mode: "sse",
  } as unknown as CopilotRuntime;
}

function createMockRequest(headers?: Record<string, string>) {
  return new Request("https://example.com/agent/test/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ threadId: "thread-1", messages: [], state: {} }),
  });
}

describe("resolveAgents", () => {
  it("resolves a static record", async () => {
    const agents = { default: createMockAgent() };
    const result = await resolveAgents(agents);
    expect(result).toBe(agents);
  });

  it("resolves a Promise", async () => {
    const agents = { default: createMockAgent() };
    const result = await resolveAgents(Promise.resolve(agents));
    expect(result).toEqual(agents);
  });

  it("calls a factory function with request context", async () => {
    const agent = createMockAgent();
    const factory = vi.fn().mockReturnValue({ default: agent });
    const request = createMockRequest({ "x-tenant-id": "tenant-123" });

    const result = await resolveAgents(factory, request);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith({ request });
    expect(result).toEqual({ default: agent });
  });

  it("calls an async factory function", async () => {
    const agent = createMockAgent();
    const factory = vi.fn().mockResolvedValue({ default: agent });
    const request = createMockRequest();

    const result = await resolveAgents(factory, request);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ default: agent });
  });

  it("throws when factory is used without a request", async () => {
    const factory = vi.fn().mockReturnValue({ default: createMockAgent() });

    await expect(resolveAgents(factory)).rejects.toThrow(
      "Agent factory function requires a request context",
    );
    expect(factory).not.toHaveBeenCalled();
  });

  it("factory can read request headers for per-tenant resolution", async () => {
    const tenantAgentA = createMockAgent("tenant-a");
    const tenantAgentB = createMockAgent("tenant-b");

    const factory = ({ request }: AgentFactoryContext) => {
      const tenantId = request.headers.get("x-tenant-id");
      if (tenantId === "a") return { default: tenantAgentA };
      return { default: tenantAgentB };
    };

    const requestA = createMockRequest({ "x-tenant-id": "a" });
    const requestB = createMockRequest({ "x-tenant-id": "b" });

    const resultA = await resolveAgents(factory, requestA);
    expect(resultA.default).toBe(tenantAgentA);

    const resultB = await resolveAgents(factory, requestB);
    expect(resultB.default).toBe(tenantAgentB);
  });
});

describe("handleRunAgent with agents factory", () => {
  it("returns 404 when factory returns no matching agent", async () => {
    const factory = vi.fn().mockReturnValue({
      other: createMockAgent("other"),
    });
    const runtime = createMockRuntime(factory);
    const request = createMockRequest();

    const response = await handleRunAgent({
      runtime,
      request,
      agentId: "nonexistent",
    });

    expect(response.status).toBe(404);
    expect(factory).toHaveBeenCalledWith({ request });
  });
});

describe("handleGetRuntimeInfo with agents factory", () => {
  it("resolves factory and lists agents", async () => {
    const factory = vi.fn().mockReturnValue({
      support: createMockAgent("support"),
      technical: createMockAgent("technical"),
    });
    const runtime = createMockRuntime(factory);
    const request = createMockRequest();

    const response = await handleGetRuntimeInfo({ runtime, request });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body.agents)).toContain("support");
    expect(Object.keys(body.agents)).toContain("technical");
    expect(factory).toHaveBeenCalledWith({ request });
  });
});
