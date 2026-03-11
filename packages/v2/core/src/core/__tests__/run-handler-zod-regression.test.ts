/**
 * Regression tests proving that RunHandler.buildFrontendTools() produces
 * identical tool schemas for Zod after the Standard Schema migration.
 *
 * These tests specifically verify:
 * 1. Complex Zod schemas still generate correct JSON Schema via the new code path
 * 2. additionalProperties stripping still works
 * 3. $schema key is still removed
 * 4. Edge cases (no parameters, empty object, nested) behave identically
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

function buildSingleToolSchema(params?: z.ZodTypeAny): Record<string, unknown> {
  const runHandler = createRunHandler();
  runHandler.initialize([
    { name: "test", ...(params ? { parameters: params } : {}) },
  ]);
  const [tool] = runHandler.buildFrontendTools();
  return tool.parameters;
}

describe("RunHandler Zod regression — tool schema generation", () => {
  describe("additionalProperties stripping (critical regression)", () => {
    it("strips top-level additionalProperties from simple object", () => {
      const schema = buildSingleToolSchema(z.object({ foo: z.string() }));
      expect(schema).toEqual({
        type: "object",
        properties: { foo: { type: "string" } },
        required: ["foo"],
      });
      expect(schema).not.toHaveProperty("additionalProperties");
    });

    it("strips additionalProperties from nested objects", () => {
      const schema = buildSingleToolSchema(
        z.object({
          user: z.object({ name: z.string(), age: z.number() }),
        }),
      );
      expect(schema).not.toHaveProperty("additionalProperties");
      expect(schema).not.toHaveProperty("properties.user.additionalProperties");
    });

    it("strips additionalProperties from catchall schemas", () => {
      const schema = buildSingleToolSchema(z.object({}).catchall(z.string()));
      expect(schema).not.toHaveProperty("additionalProperties");
    });

    it("strips additionalProperties from passthrough schemas", () => {
      const schema = buildSingleToolSchema(
        z.object({ id: z.number() }).passthrough(),
      );
      expect(schema).not.toHaveProperty("additionalProperties");
    });

    it("strips additionalProperties deep inside union members", () => {
      const schema = buildSingleToolSchema(
        z.object({
          data: z.union([
            z.object({ type: z.literal("a"), val: z.string() }),
            z.object({ type: z.literal("b"), val: z.number() }),
          ]),
        }),
      );
      // Check the anyOf/oneOf members don't have additionalProperties
      const data = (schema as any).properties.data;
      const variants = data.anyOf || data.oneOf || [];
      for (const variant of variants) {
        expect(variant).not.toHaveProperty("additionalProperties");
      }
    });

    it("strips additionalProperties inside arrays of objects", () => {
      const schema = buildSingleToolSchema(
        z.object({
          items: z.array(z.object({ name: z.string() })),
        }),
      );
      const itemSchema = (schema as any).properties.items.items;
      expect(itemSchema).not.toHaveProperty("additionalProperties");
    });
  });

  describe("$schema key removal", () => {
    it("does not include $schema in output", () => {
      const schema = buildSingleToolSchema(z.object({ a: z.string() }));
      expect(schema).not.toHaveProperty("$schema");
    });
  });

  describe("empty/missing parameters", () => {
    it("returns empty schema for tools without parameters", () => {
      const schema = buildSingleToolSchema(undefined);
      expect(schema).toEqual({
        type: "object",
        properties: {},
      });
    });

    it("returns correct schema for empty z.object", () => {
      const schema = buildSingleToolSchema(z.object({}));
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties");
    });
  });

  describe("complex Zod patterns produce valid tool schemas", () => {
    it("optional fields", () => {
      const schema = buildSingleToolSchema(
        z.object({
          city: z.string(),
          units: z.enum(["celsius", "fahrenheit"]).optional(),
        }),
      );
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties.city.type", "string");
      expect(schema.required).toContain("city");
      expect(schema.required).not.toContain("units");
    });

    it("nested objects with arrays", () => {
      const schema = buildSingleToolSchema(
        z.object({
          users: z.array(
            z.object({
              name: z.string(),
              roles: z.array(z.enum(["admin", "user", "viewer"])),
            }),
          ),
        }),
      );
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties.users.type", "array");
      const itemProps = (schema as any).properties.users.items.properties;
      expect(itemProps.name).toHaveProperty("type", "string");
      expect(itemProps.roles).toHaveProperty("type", "array");
    });

    it("discriminated union", () => {
      const schema = buildSingleToolSchema(
        z.object({
          event: z.discriminatedUnion("type", [
            z.object({
              type: z.literal("click"),
              x: z.number(),
              y: z.number(),
            }),
            z.object({
              type: z.literal("keypress"),
              key: z.string(),
            }),
          ]),
        }),
      );
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties.event");
    });

    it("nullable fields", () => {
      const schema = buildSingleToolSchema(
        z.object({ bio: z.string().nullable() }),
      );
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties.bio");
    });

    it("record fields", () => {
      const schema = buildSingleToolSchema(
        z.object({ meta: z.record(z.string(), z.string()) }),
      );
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties.meta");
    });

    it("described fields", () => {
      const schema = buildSingleToolSchema(
        z.object({
          query: z.string().describe("The search query"),
          limit: z.number().describe("Max results").optional(),
        }),
      );
      expect(schema).toHaveProperty(
        "properties.query.description",
        "The search query",
      );
      expect(schema).toHaveProperty(
        "properties.limit.description",
        "Max results",
      );
    });

    it("string constraints", () => {
      const schema = buildSingleToolSchema(
        z.object({
          email: z.string().email(),
          username: z.string().min(3).max(20),
        }),
      );
      expect(schema).toHaveProperty("properties.email.type", "string");
      expect(schema).toHaveProperty("properties.username.type", "string");
    });

    it("number constraints", () => {
      const schema = buildSingleToolSchema(
        z.object({
          score: z.number().min(0).max(100),
          count: z.number().int().positive(),
        }),
      );
      expect(schema).toHaveProperty("properties.score.type", "number");
      expect(schema).toHaveProperty("properties.count.type", "integer");
    });

    it("default values", () => {
      const schema = buildSingleToolSchema(
        z.object({
          page: z.number().default(1),
          query: z.string(),
        }),
      );
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties.page");
      expect(schema).toHaveProperty("properties.query");
    });

    it("CopilotKit-like real-world tool schema", () => {
      const schema = buildSingleToolSchema(
        z.object({
          query: z.string().describe("Search query"),
          filters: z
            .object({
              category: z.enum(["books", "movies", "music"]).optional(),
              minRating: z.number().min(0).max(5).optional(),
              tags: z.array(z.string()).optional(),
            })
            .optional(),
          sortBy: z.enum(["relevance", "date", "rating"]).default("relevance"),
        }),
      );
      expect(schema).toHaveProperty("type", "object");
      expect(schema).toHaveProperty("properties.query.type", "string");
      expect(schema).toHaveProperty("properties.filters");
      expect(schema).toHaveProperty("properties.sortBy");
      expect(schema.required).toContain("query");
      // No additionalProperties anywhere
      expect(schema).not.toHaveProperty("additionalProperties");
    });
  });

  describe("multiple Zod tools in same registry", () => {
    it("all tools produce valid schemas", () => {
      const runHandler = createRunHandler();
      runHandler.initialize([
        {
          name: "weather",
          parameters: z.object({
            city: z.string(),
            units: z.enum(["celsius", "fahrenheit"]).optional(),
          }),
        },
        {
          name: "search",
          parameters: z.object({
            query: z.string(),
            limit: z.number().int().positive().optional(),
          }),
        },
        {
          name: "noParams",
        },
      ]);

      const tools: any[] = runHandler.buildFrontendTools();
      expect(tools).toHaveLength(3);

      const weather = tools.find((t) => t.name === "weather");
      expect(weather.parameters).toHaveProperty(
        "properties.city.type",
        "string",
      );
      expect(weather.parameters.required).toContain("city");

      const search = tools.find((t) => t.name === "search");
      expect(search.parameters).toHaveProperty(
        "properties.query.type",
        "string",
      );
      expect(search.parameters.required).toContain("query");

      const noParams = tools.find((t) => t.name === "noParams");
      expect(noParams.parameters).toEqual({
        type: "object",
        properties: {},
      });
    });
  });
});
