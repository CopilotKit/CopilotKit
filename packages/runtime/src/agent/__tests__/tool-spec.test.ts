import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { defineTool } from "../index";
import {
  STATE_DELTA_TOOL_NAME,
  STATE_SNAPSHOT_TOOL_NAME,
  stateToolSpecs,
  toolDefinitionToSpec,
  readInterruptDetails,
  withInterruptDetails,
} from "../tool-spec";

function stateSpec(name: string) {
  const spec = stateToolSpecs.find((candidate) => candidate.name === name);
  if (!spec) throw new Error(`missing state tool spec ${name}`);
  return spec;
}

const cityJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
};

describe("stateToolSpecs", () => {
  it("has exactly the snapshot and delta tools", () => {
    expect(stateToolSpecs.map((spec) => spec.name)).toEqual([
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
    ]);
  });

  it("shows the model the classic snapshot tool", () => {
    const spec = stateSpec(STATE_SNAPSHOT_TOOL_NAME);

    expect(spec.description).toBe(
      "Replace the entire application state with a new snapshot",
    );
    expect(spec.parameters).toEqual({
      type: "object",
      properties: {
        snapshot: { description: "The complete new state object" },
      },
      additionalProperties: false,
    });
  });

  it("shows the model the classic delta tool", () => {
    const spec = stateSpec(STATE_DELTA_TOOL_NAME);

    expect(spec.description).toBe(
      "Apply incremental updates to application state using JSON Patch operations",
    );
    expect(spec.parameters).toEqual({
      type: "object",
      properties: {
        delta: {
          type: "array",
          description: "Array of JSON Patch operations",
          items: {
            type: "object",
            properties: {
              op: {
                type: "string",
                enum: ["add", "replace", "remove"],
                description: "The operation to perform",
              },
              path: {
                type: "string",
                description: "JSON Pointer path (e.g., '/foo/bar')",
              },
              value: {
                description:
                  "The value to set. Required for 'add' and 'replace' operations, ignored for 'remove'.",
              },
            },
            required: ["op", "path"],
            additionalProperties: false,
          },
        },
      },
      required: ["delta"],
      additionalProperties: false,
    });
  });

  it("echoes the snapshot with success", async () => {
    const result = await stateSpec(STATE_SNAPSHOT_TOOL_NAME).execute?.({
      snapshot: { count: 2 },
    });

    expect(result).toEqual({ success: true, snapshot: { count: 2 } });
  });

  it("echoes the delta with success", async () => {
    const delta = [
      { op: "replace", path: "/count", value: 3 },
      { op: "remove", path: "/draft" },
    ];

    const result = await stateSpec(STATE_DELTA_TOOL_NAME).execute?.({ delta });

    expect(result).toEqual({
      success: true,
      delta: [
        { op: "replace", path: "/count", value: 3 },
        { op: "remove", path: "/draft" },
      ],
    });
  });
});

describe("toolDefinitionToSpec", () => {
  it("converts a Valibot tool and keeps its executor", async () => {
    const spec = toolDefinitionToSpec(
      defineTool({
        name: "getWeather",
        description: "Get the weather for a city",
        parameters: toStandardJsonSchema(v.object({ city: v.string() })),
        execute: async ({ city }) => `Sunny in ${city}`,
      }),
    );

    expect(spec).toMatchObject({
      name: "getWeather",
      description: "Get the weather for a city",
      parameters: cityJsonSchema,
    });
    expect(await spec.execute?.({ city: "Paris" })).toBe("Sunny in Paris");
  });

  it("converts a Zod tool through Standard JSON Schema", () => {
    const definition = defineTool({
      name: "getWeather",
      description: "Get the weather for a city",
      parameters: z.object({ city: z.string() }),
    });

    expect(toolDefinitionToSpec(definition).parameters).toMatchObject({
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    });
  });

  it("marks a tool object with interrupt details the SDK cannot see", () => {
    const tool = withInterruptDetails(
      { name: "approvePayment" },
      { reason: "payment_approval", message: "Approve this payment?" },
    );

    expect(readInterruptDetails(tool)).toEqual({
      reason: "payment_approval",
      message: "Approve this payment?",
    });
    expect(Object.keys(tool)).toEqual(["name"]);
    expect(readInterruptDetails({ name: "other" })).toBeUndefined();
  });

  it("carries the interrupt fields of an interrupt tool", () => {
    const spec = toolDefinitionToSpec(
      defineTool({
        name: "approvePayment",
        description: "Ask a human to approve a payment",
        parameters: toStandardJsonSchema(v.object({ amount: v.number() })),
        interrupt: true,
        interruptReason: "payment_approval",
        interruptMessage: "Approve this payment?",
      }),
    );

    expect(spec).toMatchObject({
      name: "approvePayment",
      interrupt: true,
      interruptReason: "payment_approval",
      interruptMessage: "Approve this payment?",
    });
    expect(spec.execute).toBeUndefined();
  });
});
