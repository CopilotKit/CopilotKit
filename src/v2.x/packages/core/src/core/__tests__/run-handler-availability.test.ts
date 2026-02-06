import { describe, expect, it } from "vitest";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

describe("RunHandler availability", () => {
  it("excludes disabled tools from advertised frontend tools", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      { name: "enabledTool", available: "enabled" },
      { name: "disabledTool", available: "disabled" },
    ] as any);

    const advertised = runHandler.buildFrontendTools();
    expect(advertised.map((tool) => tool.name)).toEqual(["enabledTool"]);
  });

  it("does not return disabled tools from getTool", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "disabledTool", available: "disabled" }] as any);

    expect(runHandler.getTool({ toolName: "disabledTool" })).toBeUndefined();
  });
});
