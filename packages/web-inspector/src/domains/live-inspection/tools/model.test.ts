import { AbstractAgent } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { createLiveInspectionState } from "../state.js";
import {
  extractSchemaInfo,
  extractTools,
  refreshToolsSnapshot,
} from "./model.js";

class ToolAgent extends AbstractAgent {
  toolHandlers = {
    handler: {
      tool: {
        description: "Handles work",
        parameters: { type: "object", properties: {} },
      },
    },
  };

  toolRenderers = {
    handler: { description: "Duplicate renderer" },
    renderer: { description: "Renders work" },
  };

  run(): never {
    throw new Error("ToolAgent does not run");
  }
}

describe("live tool model", () => {
  it("combines core and agent tools, deduplicates handlers, and sorts", () => {
    const tools = extractTools({
      tools: [{ name: "global", description: "Global tool" }],
      agents: { alpha: new ToolAgent({ agentId: "alpha" }) },
    });

    expect(
      tools.map(({ agentId, name, type }) => [agentId, name, type]),
    ).toEqual([
      ["", "global", "handler"],
      ["alpha", "handler", "handler"],
      ["alpha", "renderer", "renderer"],
    ]);
    expect(tools[1]).toMatchObject({
      description: "Handles work",
      parameters: { type: "object", properties: {} },
    });
  });

  it("extracts JSON Schema fields without changing required or enum metadata", () => {
    expect(
      extractSchemaInfo({
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", description: "Search text" },
          limit: { type: "number", default: 10, enum: [5, 10] },
        },
      }),
    ).toEqual([
      {
        name: "query",
        type: "string",
        description: "Search text",
        required: true,
        defaultValue: undefined,
        enum: undefined,
      },
      {
        name: "limit",
        type: "number",
        description: undefined,
        required: false,
        defaultValue: 10,
        enum: [5, 10],
      },
    ]);
  });

  it("describes a Standard Schema tool's parameters through its JSON Schema", () => {
    const parameters = {
      "~standard": {
        version: 1,
        vendor: "zod",
        validate: (value: unknown) => ({ value }),
        jsonSchema: {
          input: () => ({
            type: "object",
            properties: {
              city: { type: "string", description: "City name" },
              units: { type: "string", enum: ["c", "f"], default: "c" },
            },
            required: ["city"],
          }),
        },
      },
    };

    expect(extractSchemaInfo(parameters)).toEqual([
      {
        name: "city",
        type: "string",
        description: "City name",
        required: true,
        defaultValue: undefined,
        enum: undefined,
      },
      {
        name: "units",
        type: "string",
        description: undefined,
        required: false,
        defaultValue: "c",
        enum: ["c", "f"],
      },
    ]);
  });

  it("updates the cached snapshot only when the visible signature changes", () => {
    const state = createLiveInspectionState();
    const source = { tools: [{ name: "search" }], agents: {} };

    expect(refreshToolsSnapshot(state, source)).toBe(true);
    expect(refreshToolsSnapshot(state, source)).toBe(false);
    expect(refreshToolsSnapshot(state, null)).toBe(true);
    expect(state.cachedTools).toEqual([]);
  });
});
