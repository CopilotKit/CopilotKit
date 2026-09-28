import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";
import type { FrontendTool } from "../../types";

function buildTools(tools: FrontendTool[]) {
  const runHandler = new RunHandler({} as CopilotKitCore);
  runHandler.initialize(tools);
  return runHandler.buildFrontendTools();
}

describe("RunHandler human-in-the-loop tool metadata", () => {
  it("marks human-in-the-loop tools for the runtime", () => {
    const [tool] = buildTools([
      {
        type: "human-in-the-loop",
        name: "approve_refund",
        description: "Ask the user to approve a refund",
        parameters: z.object({ amount: z.number() }),
      },
    ]);

    expect(tool).toMatchObject({
      name: "approve_refund",
      description: "Ask the user to approve a refund",
      metadata: { copilotkit: { interaction: "human-in-the-loop" } },
    });
  });

  it("keeps ordinary frontend tools free of metadata", () => {
    const tools = buildTools([
      { name: "chart", description: "renders a chart" },
      { type: "frontend", name: "map", description: "renders a map" },
    ]);

    for (const tool of tools) {
      expect(tool).not.toHaveProperty("metadata");
    }
  });

  it("never forwards metadata the tool type does not declare", () => {
    // FrontendTool has no `metadata` field, so anything an app left on the
    // object is not meant for the agent (or its model provider).
    const [hitl, plain] = buildTools([
      {
        type: "human-in-the-loop",
        name: "confirm",
        metadata: { owner: "app", copilotkit: { secret: "x" } },
      } as FrontendTool,
      { name: "chart", metadata: { internal: true } } as FrontendTool,
    ]);

    expect(hitl!.metadata).toEqual({
      copilotkit: { interaction: "human-in-the-loop" },
    });
    expect(plain).not.toHaveProperty("metadata");
  });
});
