import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotKitCore } from "../core";

describe("CopilotKitCore Basic", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
  });

  it("should create an instance", () => {
    expect(copilotKitCore).toBeDefined();
    expect(copilotKitCore.agents).toEqual({});
    expect(copilotKitCore.tools).toEqual([]);
  });

  it("should add a tool", () => {
    const tool = {
      name: "testTool",
      handler: vi.fn(),
    };

    copilotKitCore.addTool(tool);

    expect(copilotKitCore.getTool({ toolName: "testTool" })).toBe(tool);
  });
});
