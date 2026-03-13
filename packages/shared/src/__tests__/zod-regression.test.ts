/**
 * Regression tests proving that `schemaToJsonSchema` produces identical output
 * to a direct `zodToJsonSchema` call for all common Zod patterns.
 *
 * These tests exist to guarantee that the Standard Schema migration did not
 * change the JSON Schema output for existing Zod users.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { schemaToJsonSchema } from "../standard-schema";

/**
 * Helper: call zodToJsonSchema the same way the old code path did, then
 * compare with the new schemaToJsonSchema path.
 */
function expectIdenticalOutput(schema: z.ZodTypeAny) {
  const direct = zodToJsonSchema(schema, { $refStrategy: "none" });
  const migrated = schemaToJsonSchema(schema, { zodToJsonSchema });
  expect(migrated).toEqual(direct);
}

describe("Zod regression — schemaToJsonSchema produces identical output to direct zodToJsonSchema", () => {
  describe("simple object schemas", () => {
    it("required string and number fields", () => {
      expectIdenticalOutput(z.object({ name: z.string(), age: z.number() }));
    });

    it("optional fields", () => {
      expectIdenticalOutput(
        z.object({
          city: z.string(),
          units: z.enum(["celsius", "fahrenheit"]).optional(),
        }),
      );
    });

    it("empty object", () => {
      expectIdenticalOutput(z.object({}));
    });

    it("object with default values", () => {
      expectIdenticalOutput(
        z.object({
          page: z.number().default(1),
          perPage: z.number().default(20),
          query: z.string(),
        }),
      );
    });
  });

  describe("nested objects", () => {
    it("single level nesting", () => {
      expectIdenticalOutput(
        z.object({
          user: z.object({ name: z.string(), email: z.string() }),
        }),
      );
    });

    it("deep nesting", () => {
      expectIdenticalOutput(
        z.object({
          level1: z.object({
            level2: z.object({
              level3: z.object({
                value: z.boolean(),
              }),
            }),
          }),
        }),
      );
    });
  });

  describe("arrays", () => {
    it("string array", () => {
      expectIdenticalOutput(z.object({ tags: z.array(z.string()) }));
    });

    it("object array", () => {
      expectIdenticalOutput(
        z.object({
          items: z.array(z.object({ id: z.number(), label: z.string() })),
        }),
      );
    });

    it("nested arrays", () => {
      expectIdenticalOutput(z.object({ matrix: z.array(z.array(z.number())) }));
    });
  });

  describe("enums and literals", () => {
    it("z.enum", () => {
      expectIdenticalOutput(
        z.object({ status: z.enum(["active", "inactive", "pending"]) }),
      );
    });

    it("z.literal string", () => {
      expectIdenticalOutput(z.object({ type: z.literal("user") }));
    });

    it("z.literal number", () => {
      expectIdenticalOutput(z.object({ version: z.literal(2) }));
    });

    it("z.nativeEnum", () => {
      enum Color {
        Red = "red",
        Green = "green",
        Blue = "blue",
      }
      expectIdenticalOutput(z.object({ color: z.nativeEnum(Color) }));
    });
  });

  describe("unions and discriminated unions", () => {
    it("z.union of primitives", () => {
      expectIdenticalOutput(
        z.object({ value: z.union([z.string(), z.number()]) }),
      );
    });

    it("z.union of objects", () => {
      expectIdenticalOutput(
        z.object({
          result: z.union([
            z.object({ ok: z.literal(true), data: z.string() }),
            z.object({ ok: z.literal(false), error: z.string() }),
          ]),
        }),
      );
    });

    it("z.discriminatedUnion", () => {
      expectIdenticalOutput(
        z.object({
          event: z.discriminatedUnion("type", [
            z.object({
              type: z.literal("click"),
              x: z.number(),
              y: z.number(),
            }),
            z.object({ type: z.literal("keypress"), key: z.string() }),
          ]),
        }),
      );
    });
  });

  describe("nullable and nullish", () => {
    it("z.nullable", () => {
      expectIdenticalOutput(z.object({ bio: z.string().nullable() }));
    });

    it("z.nullish (optional + nullable)", () => {
      expectIdenticalOutput(z.object({ nickname: z.string().nullish() }));
    });
  });

  describe("records and tuples", () => {
    it("z.record", () => {
      expectIdenticalOutput(
        z.object({ metadata: z.record(z.string(), z.unknown()) }),
      );
    });

    it("z.tuple", () => {
      expectIdenticalOutput(
        z.object({ point: z.tuple([z.number(), z.number()]) }),
      );
    });
  });

  describe("intersections", () => {
    it("z.intersection", () => {
      expectIdenticalOutput(
        z.intersection(
          z.object({ id: z.number() }),
          z.object({ name: z.string() }),
        ),
      );
    });
  });

  describe("string constraints", () => {
    it("z.string with min/max", () => {
      expectIdenticalOutput(z.object({ username: z.string().min(3).max(20) }));
    });

    it("z.string with email", () => {
      expectIdenticalOutput(z.object({ email: z.string().email() }));
    });

    it("z.string with url", () => {
      expectIdenticalOutput(z.object({ website: z.string().url() }));
    });

    it("z.string with regex", () => {
      expectIdenticalOutput(
        z.object({ code: z.string().regex(/^[A-Z]{3}-\d{4}$/) }),
      );
    });
  });

  describe("number constraints", () => {
    it("z.number with min/max", () => {
      expectIdenticalOutput(z.object({ score: z.number().min(0).max(100) }));
    });

    it("z.number.int", () => {
      expectIdenticalOutput(z.object({ count: z.number().int() }));
    });

    it("z.number.positive", () => {
      expectIdenticalOutput(z.object({ amount: z.number().positive() }));
    });
  });

  describe("catchall and passthrough", () => {
    it("z.object with catchall", () => {
      expectIdenticalOutput(z.object({}).catchall(z.string()));
    });

    it("z.object with passthrough", () => {
      expectIdenticalOutput(z.object({ id: z.number() }).passthrough());
    });
  });

  describe("z.any and z.unknown", () => {
    it("z.any", () => {
      expectIdenticalOutput(z.any());
    });

    it("z.unknown", () => {
      expectIdenticalOutput(z.unknown());
    });

    it("object with z.any field", () => {
      expectIdenticalOutput(z.object({ data: z.any() }));
    });
  });

  describe("complex real-world schemas", () => {
    it("tool-like schema with multiple field types", () => {
      expectIdenticalOutput(
        z.object({
          query: z.string().describe("Search query"),
          filters: z
            .object({
              category: z.enum(["books", "movies", "music"]).optional(),
              minRating: z.number().min(0).max(5).optional(),
              tags: z.array(z.string()).optional(),
            })
            .optional(),
          pagination: z
            .object({
              page: z.number().int().positive().default(1),
              perPage: z.number().int().positive().default(20),
            })
            .optional(),
          sortBy: z.enum(["relevance", "date", "rating"]).default("relevance"),
        }),
      );
    });

    it("CopilotKit-like weather tool schema", () => {
      expectIdenticalOutput(
        z.object({
          city: z.string().describe("The city to get weather for"),
          units: z
            .enum(["celsius", "fahrenheit"])
            .optional()
            .describe("Temperature units"),
        }),
      );
    });

    it("agent-like action schema with nested results", () => {
      expectIdenticalOutput(
        z.object({
          action: z.discriminatedUnion("type", [
            z.object({
              type: z.literal("search"),
              query: z.string(),
              maxResults: z.number().int().optional(),
            }),
            z.object({
              type: z.literal("navigate"),
              url: z.string().url(),
            }),
            z.object({
              type: z.literal("execute"),
              code: z.string(),
              language: z.enum(["javascript", "python", "shell"]),
            }),
          ]),
          context: z.record(z.string(), z.unknown()).optional(),
        }),
      );
    });
  });

  describe("described schemas (common in tool definitions)", () => {
    it("preserves .describe() metadata", () => {
      expectIdenticalOutput(
        z
          .object({
            city: z.string().describe("The city name"),
            count: z.number().describe("Number of results"),
          })
          .describe("Weather tool parameters"),
      );
    });
  });
});
