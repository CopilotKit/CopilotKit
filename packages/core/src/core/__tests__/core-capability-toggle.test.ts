import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CopilotKitCore } from "../core";

function createCore(): CopilotKitCore {
  return new CopilotKitCore({
    tools: [
      {
        name: "chart",
        description: "renders a chart",
        parameters: z.object({}),
      },
      { name: "map", description: "renders a map", parameters: z.object({}) },
    ],
  });
}

describe("CopilotKitCore capability toggle delegation", () => {
  it("disables a tool through the public core API", () => {
    const core = createCore();
    expect(core.isToolEnabled("map")).toBe(true);

    core.setToolEnabled("map", false);

    expect(core.isToolEnabled("map")).toBe(false);
    // core.tools still lists the disabled tool (registry is unchanged)...
    expect(core.tools.map((t) => t.name)).toContain("map");
  });

  it("re-enables a tool through the public core API", () => {
    const core = createCore();
    core.setToolEnabled("map", false);
    core.setToolEnabled("map", true);
    expect(core.isToolEnabled("map")).toBe(true);
  });
});
