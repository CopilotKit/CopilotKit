import { describe, it, expect, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime } from "../copilot-runtime";
import { resolveAgents } from "../../../../v2/runtime/core/runtime";

const adapter = { name: "OpenAIAdapter" } as any;
const agents = () =>
  ({ default: new HttpAgent({ url: "https://example.com/a" }) }) as any;

async function resolve(runtime: CopilotRuntime) {
  runtime.handleServiceAdapter(adapter);
  return resolveAgents(runtime.instance.agents);
}

describe("v1 CopilotRuntime rejects tool config it cannot execute", () => {
  it("throws for `actions`, naming the v2 replacement", async () => {
    const handler = vi.fn();
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: [
        { name: "greet", description: "greet", parameters: [], handler },
      ],
    } as any);

    const err = await resolve(runtime).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/no longer execute/);
    expect(err.message).toMatch(/BuiltInAgent/);
    // The point of throwing: the handler was never going to run anyway.
    expect(handler).not.toHaveBeenCalled();
  });

  it("throws for `mcpServers`", async () => {
    const createMCPClient = vi.fn();
    const runtime = new CopilotRuntime({
      agents: agents(),
      mcpServers: [{ endpoint: "https://mcp.example.com" }],
      createMCPClient,
    } as any);

    const err = await resolve(runtime).catch((e) => e);
    expect(err.message).toMatch(/no longer execute/);
    expect(createMCPClient).not.toHaveBeenCalled();
  });

  it("leaves a runtime with neither option alone", async () => {
    const runtime = new CopilotRuntime({ agents: agents() } as any);
    const resolved = await resolve(runtime);
    expect(resolved.default).toBeDefined();
  });
});
