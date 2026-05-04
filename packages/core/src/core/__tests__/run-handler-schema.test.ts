import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

describe("RunHandler tool schema generation", () => {
  it("strips boolean additionalProperties emitted by zod-to-json-schema", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "sample",
        parameters: z.object({
          foo: z.string(),
        }),
      },
    ]);

    const [tool] = runHandler.buildFrontendTools();
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        foo: { type: "string" },
      },
      required: ["foo"],
    });
  });

  it("removes additionalProperties even for catchalls", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "catchall",
        parameters: z.object({}).catchall(z.string()),
      },
    ]);

    const [tool] = runHandler.buildFrontendTools();
    expect(tool.parameters).not.toHaveProperty("additionalProperties");
  });

  it("returns an empty schema for tools without parameters", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "noSchema",
      },
    ]);

    const [tool] = runHandler.buildFrontendTools();
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {},
    });
  });
});
