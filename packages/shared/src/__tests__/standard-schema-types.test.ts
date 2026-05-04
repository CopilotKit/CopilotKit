import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { type } from "arktype";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { InferSchemaOutput } from "../standard-schema";

describe("InferSchemaOutput type inference", () => {
  describe("Zod schemas", () => {
    it("infers output type from a Zod object schema", () => {
      const schema = z.object({
        city: z.string(),
        count: z.number(),
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        city: string;
        count: number;
      }>();
    });

    it("infers output type with optional fields", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().optional(),
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        name: string;
        age?: number | undefined;
      }>();
    });

    it("infers output type with enums", () => {
      const schema = z.object({
        unit: z.enum(["celsius", "fahrenheit"]),
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        unit: "celsius" | "fahrenheit";
      }>();
    });

    it("infers output type with nested objects", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string(),
        }),
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        user: { name: string; email: string };
      }>();
    });

    it("infers output type with arrays", () => {
      const schema = z.object({
        tags: z.array(z.string()),
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        tags: string[];
      }>();
    });
  });

  describe("Valibot schemas", () => {
    it("infers output type from a Valibot object schema", () => {
      const schema = v.object({
        query: v.string(),
        limit: v.number(),
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        query: string;
        limit: number;
      }>();
    });

    it("infers output type with optional fields", () => {
      const schema = v.object({
        name: v.string(),
        age: v.optional(v.number()),
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        name: string;
        age?: number | undefined;
      }>();
    });

    it("infers output type with nested objects", () => {
      const schema = v.object({
        user: v.object({
          name: v.string(),
          email: v.string(),
        }),
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        user: { name: string; email: string };
      }>();
    });
  });

  describe("ArkType schemas", () => {
    it("infers output type from an ArkType object schema", () => {
      const schema = type({
        query: "string",
        limit: "number",
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        query: string;
        limit: number;
      }>();
    });

    it("infers output type with optional fields", () => {
      const schema = type({
        name: "string",
        "age?": "number",
      });

      expectTypeOf<InferSchemaOutput<typeof schema>>().toEqualTypeOf<{
        name: string;
        age?: number;
      }>();
    });
  });

  describe("StandardSchemaV1 compatibility", () => {
    it("all schema types satisfy StandardSchemaV1", () => {
      expectTypeOf(
        z.object({ a: z.string() }),
      ).toMatchTypeOf<StandardSchemaV1>();
      expectTypeOf(
        v.object({ a: v.string() }),
      ).toMatchTypeOf<StandardSchemaV1>();
      expectTypeOf(type({ a: "string" })).toMatchTypeOf<StandardSchemaV1>();
    });
  });
});
