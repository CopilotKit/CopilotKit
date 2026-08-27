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

  it("extracts optional and defaulted Zod-like fields", () => {
    const optionalString = {
      _def: {
        typeName: "ZodOptional",
        innerType: { _def: { typeName: "ZodString", description: "Label" } },
      },
    };
    const defaultNumber = {
      _def: {
        typeName: "ZodDefault",
        defaultValue: () => 3,
        innerType: { _def: { typeName: "ZodNumber" } },
      },
    };

    expect(
      extractSchemaInfo({
        _def: {
          typeName: "ZodObject",
          unknownKeys: "strict",
          shape: () => ({ label: optionalString, count: defaultNumber }),
        },
      }),
    ).toEqual([
      {
        name: "label",
        type: "string",
        description: "Label",
        required: false,
      },
      {
        name: "count",
        type: "number",
        description: undefined,
        defaultValue: 3,
        required: false,
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
