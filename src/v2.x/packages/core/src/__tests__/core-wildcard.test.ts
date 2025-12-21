import { describe, it, expect, vi, beforeEach } from "vitest";
import { CopilotKitCore } from "../core";
import { FrontendTool } from "../types";

describe("CopilotKitCore - Wildcard Tool Simple", () => {
  it("should add wildcard tool", () => {
    const core = new CopilotKitCore({
      headers: {},
      properties: {},
    });

    const wildcardTool: FrontendTool = {
      name: "*",
      handler: vi.fn(),
    };

    core.addTool(wildcardTool);
    const retrievedTool = core.getTool({ toolName: "*" });
    expect(retrievedTool).toBeDefined();
    expect(retrievedTool?.name).toBe("*");
  });

  it("should not interfere with specific tools", () => {
    const core = new CopilotKitCore({
      headers: {},
      properties: {},
    });

    const specificTool: FrontendTool = {
      name: "specific",
      handler: vi.fn(),
    };

    const wildcardTool: FrontendTool = {
      name: "*",
      handler: vi.fn(),
    };

    core.addTool(specificTool);
    core.addTool(wildcardTool);

    expect(core.getTool({ toolName: "specific" })).toBeDefined();
    expect(core.getTool({ toolName: "*" })).toBeDefined();
    expect(core.tools.length).toBe(2);
  });
});
