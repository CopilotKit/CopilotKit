import { describe, expect, it } from "vitest";
import { schemaToJsonSchema } from "@copilotkit/shared";
import {
  GENERATE_SANDBOXED_UI_ARGS_SCHEMA,
  OPEN_GENERATIVE_UI_CONTENT_SCHEMA,
} from "../schemas";
import {
  buildOpenGenerativeUIContexts,
  createOpenGenerativeUITool,
} from "../tool";
import { DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL } from "../content";

describe("Open Generative UI schemas", () => {
  const validate = (value: unknown) =>
    OPEN_GENERATIVE_UI_CONTENT_SCHEMA["~standard"].validate(value);

  it("keeps known fields and drops unknown ones", () => {
    expect(validate({ html: ["<p>"], generating: false, extra: 1 })).toEqual({
      value: { html: ["<p>"], generating: false },
    });
  });

  it("reports a field of the wrong type", () => {
    expect(validate({ html: "not-an-array" })).toEqual({
      issues: [{ message: "Expected string[]", path: ["html"] }],
    });
  });

  it("rejects content that is not an object", () => {
    expect(validate(null)).toEqual({
      issues: [{ message: "Expected an object" }],
    });
  });

  it("describes the tool arguments as the same JSON Schema zod produced", () => {
    expect(schemaToJsonSchema(GENERATE_SANDBOXED_UI_ARGS_SCHEMA)).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        initialHeight: { type: "number" },
        placeholderMessages: { type: "array", items: { type: "string" } },
        css: { type: "string" },
        html: { type: "string" },
        jsFunctions: { type: "string" },
        jsExpressions: { type: "array", items: { type: "string" } },
      },
    });
  });
});

describe("createOpenGenerativeUITool", () => {
  it("acknowledges the call so the activity owns the UI, and is safe to replay", async () => {
    const tool = createOpenGenerativeUITool();
    expect(tool.name).toBe("generateSandboxedUi");
    expect(tool.reconnectBehavior).toBe("resume-pending");
    expect(tool.followUp).toBe(true);
    expect(await tool.handler()).toBe("UI generated");
  });
});

describe("buildOpenGenerativeUIContexts", () => {
  it("sends the default design skill when none is set", () => {
    expect(buildOpenGenerativeUIContexts({ sandboxFunctions: [] })).toEqual([
      {
        description:
          "Design guidelines for the generateSandboxedUi tool. Follow these when building UI.",
        value: DEFAULT_OPEN_GENERATIVE_UI_DESIGN_SKILL,
      },
    ]);
  });

  it("describes sandbox functions with the await call form", () => {
    const [, functions] = buildOpenGenerativeUIContexts({
      designSkill: "flat",
      sandboxFunctions: [
        {
          name: "addToCart",
          description: "Adds an item",
          parameters: GENERATE_SANDBOXED_UI_ARGS_SCHEMA,
        },
      ],
    });
    expect(functions!.description).toBe(
      "Sandbox functions available in generated sandboxed UI code. Call via: await Websandbox.connection.remote.<functionName>(args)",
    );
    expect(JSON.parse(functions!.value)[0]).toMatchObject({
      name: "addToCart",
      description: "Adds an item",
      parameters: { type: "object" },
    });
  });
});
