import { describe, it, expect, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime } from "../copilot-runtime";
import { resolveAgents } from "../../../../v2/runtime/core/runtime";

const adapter = { name: "OpenAIAdapter" } as any;
const agents = () =>
  ({ default: new HttpAgent({ url: "https://example.com/a" }) }) as any;

/** Pull the tools the runtime attached to the default agent. */
async function toolsOf(runtime: CopilotRuntime) {
  runtime.handleServiceAdapter(adapter);
  const resolved: any = await resolveAgents(runtime.instance.agents);
  return (Reflect.get(resolved.default, "config") as any)?.tools ?? [];
}

describe("v1 `actions` execute their handler", () => {
  it("calls the action's handler with the model's arguments", async () => {
    const handler = vi.fn().mockResolvedValue({ greeting: "hi Ada" });
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: [
        {
          name: "greet",
          description: "greet",
          parameters: [{ name: "name", type: "string" }],
          handler,
        },
      ],
    } as any);

    const tools = await toolsOf(runtime);
    const greet = tools.find((t: any) => t.name === "greet");
    const result = await greet.execute({ name: "Ada" });

    expect(handler).toHaveBeenCalledWith({ name: "Ada" });
    expect(result).toEqual({ greeting: "hi Ada" });
  });

  it("returns a readable string when the action has no handler", async () => {
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: [{ name: "orphan", description: "no handler", parameters: [] }],
    } as any);

    const tools = await toolsOf(runtime);
    const result = await tools
      .find((t: any) => t.name === "orphan")
      .execute({});

    // Must be a string: `JSON.stringify(undefined)` is not a string, which
    // strips the required `content` off TOOL_CALL_RESULT (#2915, #3198).
    expect(typeof result).toBe("string");
    expect(result).toMatch(/orphan/);
    expect(result).toMatch(/no implementation to run/i);
  });

  it("never returns undefined from a void handler", async () => {
    // A handler with no return value is legal. `JSON.stringify(undefined)` is
    // not a string, so returning it strips the required `content` off
    // TOOL_CALL_RESULT — the original #2915 / #3198 failure.
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: [
        {
          name: "log",
          description: "log something",
          parameters: [],
          handler: () => {
            /* returns nothing */
          },
        },
      ],
    } as any);

    const tools = await toolsOf(runtime);
    const result = await tools.find((t: any) => t.name === "log").execute({});

    expect(result).not.toBeUndefined();
    expect(typeof JSON.stringify(result)).toBe("string");
  });

  it("accepts an empty actions array without failing", async () => {
    const runtime = new CopilotRuntime({
      agents: agents(),
      actions: [],
    } as any);
    await expect(toolsOf(runtime)).resolves.toBeDefined();
  });
});

describe("v1 `mcpServers` execute against the MCP client", () => {
  it("calls the MCP tool's own execute with the model's arguments", async () => {
    const execute = vi.fn().mockResolvedValue("booked");
    const createMCPClient = vi.fn().mockResolvedValue({
      tools: async () => ({
        book_flight: {
          description: "book a flight",
          schema: { parameters: { properties: { to: { type: "string" } } } },
          execute,
        },
      }),
    });

    const runtime = new CopilotRuntime({
      agents: agents(),
      mcpServers: [{ endpoint: "https://mcp.example.com" }],
      createMCPClient,
    } as any);

    const tools = await toolsOf(runtime);
    const book = tools.find((t: any) => t.name === "book_flight");
    const result = await book.execute({ to: "LIS" });

    expect(execute).toHaveBeenCalledWith({ to: "LIS" });
    expect(result).toBe("booked");
  });
});
