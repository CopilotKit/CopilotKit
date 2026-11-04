import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { ɵregisterFrontendTools } from "../frontend-tool-registration";
import type { ɵFrontendToolRenderer } from "../frontend-tool-registration";

type Tool = {
  name: string;
  agentId?: string;
  description?: string;
  render?: string;
};

function setup() {
  const core = new CopilotKitCore({});
  const renderers: ɵFrontendToolRenderer<string>[] = [];
  const register = (tools: Tool[]) =>
    ɵregisterFrontendTools(core, tools, (renderer) => renderers.push(renderer));
  return { core, renderers, register };
}

describe("ɵregisterFrontendTools", () => {
  afterEach(() => vi.restoreAllMocks());

  it("registers each tool and a renderer for each tool with a render", () => {
    const { core, renderers, register } = setup();

    register([
      { name: "search", render: "search-card" },
      { name: "plain", agentId: "research" },
    ]);

    expect(core.getTool({ toolName: "search" })?.name).toBe("search");
    expect(core.getTool({ toolName: "plain", agentId: "research" })?.name).toBe(
      "plain",
    );
    expect(renderers).toEqual([
      {
        name: "search",
        args: undefined,
        agentId: undefined,
        render: "search-card",
      },
    ]);
  });

  it("uses the last entry for a repeated name and agent, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { core, register } = setup();

    register([
      { name: "search", description: "first" },
      { name: "search", description: "second" },
    ]);

    expect(core.getTool({ toolName: "search" })?.description).toBe("second");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("listed more than once"),
    );
  });

  it("warns when it hides a tool, and brings that tool back when removed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { core, register } = setup();
    core.addTool({ name: "search", description: "provider" });

    const unregister = register([{ name: "search", description: "hook" }]);
    expect(core.getTool({ toolName: "search" })?.description).toBe("hook");
    expect(warn).toHaveBeenCalledWith(
      "Tool 'search' already exists for agent 'global'. Overriding with latest registration.",
    );

    unregister();
    expect(core.getTool({ toolName: "search" })?.description).toBe("provider");
  });
});
