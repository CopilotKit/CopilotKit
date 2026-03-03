import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

describe("RunHandler tool available filtering", () => {
  it("excludes tools with available: false from buildFrontendTools", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "enabledTool",
        description: "An enabled tool",
        parameters: z.object({ x: z.string() }),
      },
      {
        name: "disabledTool",
        description: "A disabled tool",
        available: false,
        parameters: z.object({ y: z.string() }),
      },
    ]);

    const tools = runHandler.buildFrontendTools();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("enabledTool");
    expect(toolNames).not.toContain("disabledTool");
    expect(tools).toHaveLength(1);
  });

  it("includes tools with available: true", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "explicitEnabled",
        description: "Explicitly enabled",
        available: true,
        parameters: z.object({ a: z.string() }),
      },
    ]);

    const tools = runHandler.buildFrontendTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("explicitEnabled");
  });

  it("includes tools with no available property (defaults to enabled)", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "defaultTool",
        description: "Default availability",
      },
    ]);

    const tools = runHandler.buildFrontendTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("defaultTool");
  });

  it("filters disabled tools even when agentId matches", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "agentTool",
        description: "Agent-scoped disabled tool",
        available: false,
        agentId: "myAgent",
        parameters: z.object({ z: z.string() }),
      },
      {
        name: "agentToolEnabled",
        description: "Agent-scoped enabled tool",
        agentId: "myAgent",
      },
    ]);

    const tools = runHandler.buildFrontendTools("myAgent");
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).not.toContain("agentTool");
    expect(toolNames).toContain("agentToolEnabled");
    expect(tools).toHaveLength(1);
  });
});
