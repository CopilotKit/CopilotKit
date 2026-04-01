import { describe, it, expectTypeOf } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { type } from "arktype";
import type { StandardSchemaV1 } from "@copilotkit/shared";
import { defineTool, type ToolDefinition } from "../index";

describe("ToolDefinition type inference", () => {
  describe("defineTool with Zod", () => {
    it("infers execute args from Zod schema", () => {
      const tool = defineTool({
        name: "weather",
        description: "Get weather",
        parameters: z.object({
          city: z.string(),
          units: z.enum(["celsius", "fahrenheit"]),
        }),
        execute: async (args) => {
          // args should be fully typed
          expectTypeOf(args).toEqualTypeOf<{
            city: string;
            units: "celsius" | "fahrenheit";
          }>();
          return {};
        },
      });

      expectTypeOf(tool.name).toBeString();
      expectTypeOf(tool.description).toBeString();
      expectTypeOf(tool.parameters).toMatchTypeOf<StandardSchemaV1>();
    });

    it("infers execute args with optional Zod fields", () => {
      defineTool({
        name: "search",
        description: "Search",
        parameters: z.object({
          query: z.string(),
          limit: z.number().optional(),
        }),
        execute: async (args) => {
          expectTypeOf(args).toEqualTypeOf<{
            query: string;
            limit?: number | undefined;
          }>();
          return {};
        },
      });
    });
  });

  describe("defineTool with Valibot", () => {
    it("infers execute args from Valibot schema", () => {
      defineTool({
        name: "search",
        description: "Search",
        parameters: v.object({
          query: v.string(),
          limit: v.number(),
        }),
        execute: async (args) => {
          expectTypeOf(args).toEqualTypeOf<{
            query: string;
            limit: number;
          }>();
          return {};
        },
      });
    });

    it("infers execute args with optional Valibot fields", () => {
      defineTool({
        name: "search",
        description: "Search",
        parameters: v.object({
          query: v.string(),
          limit: v.optional(v.number()),
        }),
        execute: async (args) => {
          expectTypeOf(args).toEqualTypeOf<{
            query: string;
            limit?: number | undefined;
          }>();
          return {};
        },
      });
    });
  });

  describe("defineTool with ArkType", () => {
    it("infers execute args from ArkType schema", () => {
      defineTool({
        name: "search",
        description: "Search",
        parameters: type({
          query: "string",
          limit: "number",
        }),
        execute: async (args) => {
          expectTypeOf(args).toEqualTypeOf<{
            query: string;
            limit: number;
          }>();
          return {};
        },
      });
    });

    it("infers execute args with optional ArkType fields", () => {
      defineTool({
        name: "profile",
        description: "Profile",
        parameters: type({
          name: "string",
          "age?": "number",
        }),
        execute: async (args) => {
          expectTypeOf(args).toEqualTypeOf<{
            name: string;
            age?: number;
          }>();
          return {};
        },
      });
    });
  });

  describe("ToolDefinition interface", () => {
    it("accepts Zod schema as generic parameter", () => {
      type ZodTool = ToolDefinition<z.ZodObject<{ city: z.ZodString }>>;

      expectTypeOf<ZodTool["execute"]>().toBeFunction();
      expectTypeOf<Parameters<ZodTool["execute"]>[0]>().toEqualTypeOf<{
        city: string;
      }>();
    });

    it("default generic parameter is StandardSchemaV1", () => {
      type DefaultTool = ToolDefinition;

      expectTypeOf<
        DefaultTool["parameters"]
      >().toMatchTypeOf<StandardSchemaV1>();
    });

    it("preserves schema type through defineTool return", () => {
      const schema = z.object({ x: z.number() });
      const tool = defineTool({
        name: "t",
        description: "d",
        parameters: schema,
        execute: async () => ({}),
      });

      expectTypeOf(tool.parameters).toEqualTypeOf<typeof schema>();
    });
  });
});
