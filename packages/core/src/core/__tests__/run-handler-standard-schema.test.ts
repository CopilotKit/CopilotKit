import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";
import type { StandardSchemaV1 } from "@copilotkit/shared";

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

describe("RunHandler Standard Schema support", () => {
  describe("Zod schemas (existing behavior)", () => {
    it("generates JSON schema from a zod object schema", () => {
      const runHandler = createRunHandler();
      runHandler.initialize([
        {
          name: "weather",
          parameters: z.object({
            city: z.string(),
            units: z.enum(["celsius", "fahrenheit"]).optional(),
          }),
        },
      ]);

      const [tool] = runHandler.buildFrontendTools();
      expect(tool.parameters).toHaveProperty("type", "object");
      expect(tool.parameters).toHaveProperty("properties.city.type", "string");
      expect(tool.parameters.required).toContain("city");
    });
  });

  describe("Valibot schemas (via toStandardJsonSchema)", () => {
    it("generates JSON schema from a valibot object schema", () => {
      const runHandler = createRunHandler();
      const schema = toStandardJsonSchema(
        v.object({
          query: v.string(),
          limit: v.optional(v.number()),
        }),
      );

      runHandler.initialize([
        {
          name: "search",
          parameters: schema,
        },
      ]);

      const [tool] = runHandler.buildFrontendTools();
      expect(tool.parameters).toHaveProperty("type", "object");
      expect(tool.parameters).toHaveProperty("properties.query.type", "string");
      expect(tool.parameters.required).toContain("query");
    });

    it("handles a valibot schema with nested objects", () => {
      const runHandler = createRunHandler();
      const schema = toStandardJsonSchema(
        v.object({
          user: v.object({
            name: v.string(),
            age: v.number(),
          }),
        }),
      );

      runHandler.initialize([
        {
          name: "createUser",
          parameters: schema,
        },
      ]);

      const [tool] = runHandler.buildFrontendTools();
      expect(tool.parameters).toHaveProperty("type", "object");
      expect(tool.parameters).toHaveProperty("properties.user");
      expect(tool.parameters).toHaveProperty(
        "properties.user.properties.name.type",
        "string",
      );
    });
  });

  describe("ArkType schemas (native Standard JSON Schema V1)", () => {
    it("generates JSON schema from an arktype schema", () => {
      const runHandler = createRunHandler();
      const schema = type({
        query: "string",
        limit: "number",
      });

      runHandler.initialize([
        {
          name: "search",
          parameters: schema,
        },
      ]);

      const [tool] = runHandler.buildFrontendTools();
      expect(tool.parameters).toHaveProperty("type", "object");
      expect(tool.parameters).toHaveProperty("properties.query.type", "string");
      expect(tool.parameters).toHaveProperty("properties.limit.type", "number");
    });

    it("generates correct required fields", () => {
      const runHandler = createRunHandler();
      const schema = type({
        name: "string",
        "age?": "number",
      });

      runHandler.initialize([
        {
          name: "profile",
          parameters: schema,
        },
      ]);

      const [tool] = runHandler.buildFrontendTools();
      expect(tool.parameters).toHaveProperty("type", "object");
      expect(tool.parameters.required).toContain("name");
    });
  });

  describe("Mixed schema types", () => {
    it("handles tools with different schema libraries in the same registry", () => {
      const runHandler = createRunHandler();
      runHandler.initialize([
        {
          name: "zodTool",
          parameters: z.object({ city: z.string() }),
        },
        {
          name: "valibotTool",
          parameters: toStandardJsonSchema(v.object({ query: v.string() })),
        },
        {
          name: "arktypeTool",
          parameters: type({
            id: "string",
          }),
        },
        {
          name: "noSchemaTool",
          // No parameters
        },
      ]);

      const tools: any[] = runHandler.buildFrontendTools();
      expect(tools).toHaveLength(4);

      // Each tool should have a valid parameters object with type "object"
      for (const tool of tools) {
        expect(tool.parameters).toHaveProperty("type", "object");
        expect(tool.parameters).toHaveProperty("properties");
      }

      // Verify specific tools have their expected properties
      const zodTool = tools.find((t) => t.name === "zodTool");
      expect(zodTool?.parameters).toHaveProperty(
        "properties.city.type",
        "string",
      );

      const valibotTool = tools.find((t) => t.name === "valibotTool");
      expect(valibotTool?.parameters).toHaveProperty(
        "properties.query.type",
        "string",
      );

      const arktypeTool = tools.find((t) => t.name === "arktypeTool");
      expect(arktypeTool?.parameters).toHaveProperty(
        "properties.id.type",
        "string",
      );
    });
  });
});
