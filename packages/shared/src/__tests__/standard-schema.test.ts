import { describe, it, expect } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import { zodToJsonSchema } from "zod-to-json-schema";
import { schemaToJsonSchema } from "../standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";

describe("schemaToJsonSchema", () => {
  describe("Zod schemas (via injected zodToJsonSchema)", () => {
    it("converts a simple zod object schema", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const result = schemaToJsonSchema(schema, { zodToJsonSchema });

      expect(result).toHaveProperty("type", "object");
      expect(result).toHaveProperty("properties.name.type", "string");
      expect(result).toHaveProperty("properties.age.type", "number");
      expect(result).toHaveProperty("required");
      expect(result.required).toContain("name");
      expect(result.required).toContain("age");
    });

    it("converts a zod schema with optional fields", () => {
      const schema = z.object({
        city: z.string(),
        units: z.enum(["celsius", "fahrenheit"]).optional(),
      });

      const result = schemaToJsonSchema(schema, { zodToJsonSchema });

      expect(result).toHaveProperty("type", "object");
      expect(result).toHaveProperty("properties.city.type", "string");
      expect(result.required).toContain("city");
      expect(result.required).not.toContain("units");
    });

    it("has vendor 'zod' on ~standard", () => {
      const schema = z.object({ foo: z.string() });
      expect(schema["~standard"].vendor).toBe("zod");
    });
  });

  describe("Valibot schemas (via toStandardJsonSchema wrapper)", () => {
    it("has vendor 'valibot' on ~standard", () => {
      const schema = v.object({ name: v.string() });
      expect(schema["~standard"].vendor).toBe("valibot");
    });

    it("satisfies StandardSchemaV1", () => {
      const schema = v.object({ name: v.string() });
      const _: StandardSchemaV1 = schema;
      expect(_["~standard"].version).toBe(1);
    });

    it("raw valibot schema throws (no ~standard.jsonSchema)", () => {
      const schema = v.object({ name: v.string() });
      expect(() => schemaToJsonSchema(schema)).toThrow(
        /Cannot convert schema to JSON Schema/,
      );
    });

    it("converts a valibot schema wrapped with toStandardJsonSchema", () => {
      const schema = toStandardJsonSchema(
        v.object({
          name: v.string(),
          age: v.number(),
        }),
      );

      const result = schemaToJsonSchema(schema);

      expect(result).toHaveProperty("type", "object");
      expect(result).toHaveProperty("properties.name.type", "string");
      expect(result).toHaveProperty("properties.age.type", "number");
      expect(result.required).toContain("name");
      expect(result.required).toContain("age");
    });

    it("converts a valibot schema with optional fields", () => {
      const schema = toStandardJsonSchema(
        v.object({
          city: v.string(),
          units: v.optional(v.picklist(["celsius", "fahrenheit"])),
        }),
      );

      const result = schemaToJsonSchema(schema);

      expect(result).toHaveProperty("type", "object");
      expect(result).toHaveProperty("properties.city");
      expect(result.required).toContain("city");
    });
  });

  describe("ArkType schemas (native ~standard.jsonSchema)", () => {
    it("has vendor 'arktype' on ~standard", () => {
      const schema = type({ name: "string" });
      expect(schema["~standard"].vendor).toBe("arktype");
    });

    it("satisfies StandardSchemaV1", () => {
      const schema = type({ name: "string" });
      const _: StandardSchemaV1 = schema;
      expect(_["~standard"].version).toBe(1);
    });

    it("natively implements ~standard.jsonSchema", () => {
      const schema = type({ name: "string" });
      const props = schema["~standard"];
      expect(props.jsonSchema).toBeDefined();
      expect(typeof props.jsonSchema.input).toBe("function");
    });

    it("converts an arktype schema directly", () => {
      const schema = type({
        name: "string",
        age: "number",
      });

      const result = schemaToJsonSchema(schema);

      expect(result).toHaveProperty("type", "object");
      expect(result).toHaveProperty("properties.name.type", "string");
      expect(result).toHaveProperty("properties.age.type", "number");
      expect(result.required).toContain("name");
      expect(result.required).toContain("age");
    });

    it("converts an arktype schema without needing zodToJsonSchema fallback", () => {
      const schema = type({ query: "string" });

      // No zodToJsonSchema option needed — arktype uses Standard JSON Schema V1 natively
      const result = schemaToJsonSchema(schema);

      expect(result).toHaveProperty("type", "object");
      expect(result).toHaveProperty("properties.query.type", "string");
    });
  });

  describe("Standard JSON Schema V1 protocol (mock)", () => {
    it("uses ~standard.jsonSchema.input() when present", () => {
      const mockSchema: StandardSchemaV1 & {
        "~standard": StandardSchemaV1["~standard"] & {
          jsonSchema: {
            input: (opts: { target: string }) => Record<string, unknown>;
          };
        };
      } = {
        "~standard": {
          version: 1,
          vendor: "mock-lib",
          validate: (value: unknown) => ({ value }),
          jsonSchema: {
            input: (opts: { target: string }) => ({
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
              $generatedBy: "mock-lib",
              $target: opts.target,
            }),
          },
        },
      };

      const result = schemaToJsonSchema(mockSchema);

      expect(result).toEqual({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        $generatedBy: "mock-lib",
        $target: "draft-07",
      });
    });

    it("prefers ~standard.jsonSchema over zodToJsonSchema fallback", () => {
      const mockSchema = {
        "~standard": {
          version: 1,
          vendor: "zod",
          validate: (value: unknown) => ({ value }),
          jsonSchema: {
            input: () => ({
              type: "object",
              properties: { fromJsonSchema: { type: "boolean" } },
            }),
          },
        },
      };

      const zodFallback = () => ({
        type: "object",
        properties: { fromZodFallback: { type: "boolean" } },
      });

      const result = schemaToJsonSchema(mockSchema, {
        zodToJsonSchema: zodFallback,
      });

      // Should use ~standard.jsonSchema, not the zod fallback
      expect(result).toHaveProperty("properties.fromJsonSchema");
      expect(result).not.toHaveProperty("properties.fromZodFallback");
    });
  });

  describe("Zod v4 schemas (via toJSONSchema method)", () => {
    it("calls toJSONSchema() when the method exists on the schema", () => {
      const expectedOutput = {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      };

      const mockZod4Schema: StandardSchemaV1 = {
        "~standard": {
          version: 1,
          vendor: "zod",
          validate: (value: unknown) => ({ value }),
        },
        toJSONSchema: () => expectedOutput,
      } as any;

      const result = schemaToJsonSchema(mockZod4Schema);
      expect(result).toEqual(expectedOutput);
    });

    it("uses toJSONSchema() even without zodToJsonSchema option", () => {
      const mockZod4Schema: StandardSchemaV1 = {
        "~standard": {
          version: 1,
          vendor: "zod",
          validate: (value: unknown) => ({ value }),
        },
        toJSONSchema: () => ({
          type: "object",
          properties: { city: { type: "string" } },
        }),
      } as any;

      // No options passed — toJSONSchema() should still work
      const result = schemaToJsonSchema(mockZod4Schema);
      expect(result).toHaveProperty("properties.city.type", "string");
    });

    it("prefers toJSONSchema() over zodToJsonSchema fallback for Zod v4", () => {
      const mockZod4Schema: StandardSchemaV1 = {
        "~standard": {
          version: 1,
          vendor: "zod",
          validate: (value: unknown) => ({ value }),
        },
        toJSONSchema: () => ({
          type: "object",
          properties: { fromNative: { type: "boolean" } },
        }),
      } as any;

      const zodFallback = () => ({
        type: "object",
        properties: { fromFallback: { type: "boolean" } },
      });

      const result = schemaToJsonSchema(mockZod4Schema, {
        zodToJsonSchema: zodFallback,
      });

      expect(result).toHaveProperty("properties.fromNative");
      expect(result).not.toHaveProperty("properties.fromFallback");
    });

    it("prefers ~standard.jsonSchema over toJSONSchema()", () => {
      const mockSchema = {
        "~standard": {
          version: 1,
          vendor: "zod",
          validate: (value: unknown) => ({ value }),
          jsonSchema: {
            input: () => ({
              type: "object",
              properties: { fromStandard: { type: "boolean" } },
            }),
          },
        },
        toJSONSchema: () => ({
          type: "object",
          properties: { fromToJSONSchema: { type: "boolean" } },
        }),
      };

      const result = schemaToJsonSchema(mockSchema);

      // Standard JSON Schema V1 should take priority
      expect(result).toHaveProperty("properties.fromStandard");
      expect(result).not.toHaveProperty("properties.fromToJSONSchema");
    });
  });

  describe("Error handling", () => {
    it("throws when schema has no jsonSchema support and no zodToJsonSchema", () => {
      const mockSchema: StandardSchemaV1 = {
        "~standard": {
          version: 1,
          vendor: "unknown-lib",
          validate: (value: unknown) => ({ value }),
        },
      };

      expect(() => schemaToJsonSchema(mockSchema)).toThrow(
        /Cannot convert schema to JSON Schema/,
      );
      expect(() => schemaToJsonSchema(mockSchema)).toThrow(/unknown-lib/);
    });

    it("throws for non-zod vendor when zodToJsonSchema is not provided", () => {
      const mockSchema: StandardSchemaV1 = {
        "~standard": {
          version: 1,
          vendor: "some-other-lib",
          validate: (value: unknown) => ({ value }),
        },
      };

      expect(() => schemaToJsonSchema(mockSchema)).toThrow(
        /no zodToJsonSchema fallback/,
      );
    });

    it("uses zodToJsonSchema fallback for zod vendor schemas", () => {
      const mockZodSchema: StandardSchemaV1 = {
        "~standard": {
          version: 1,
          vendor: "zod",
          validate: (value: unknown) => ({ value }),
        },
      };

      const fallback = () => ({
        type: "object",
        properties: { test: { type: "string" } },
      });

      const result = schemaToJsonSchema(mockZodSchema, {
        zodToJsonSchema: fallback,
      });

      expect(result).toEqual({
        type: "object",
        properties: { test: { type: "string" } },
      });
    });
  });
});
