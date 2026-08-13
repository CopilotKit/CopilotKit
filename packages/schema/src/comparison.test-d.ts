/* eslint-disable @typescript-eslint/no-unused-vars -- Type tests consume fixtures through typeof queries. */

import { type as arkType } from "arktype";
import * as v from "valibot";
import { expectTypeOf, test } from "vitest";
import * as z from "zod/v4";

import {
  array,
  boolean,
  lazy,
  literal,
  number,
  object,
  optional,
  parseAsync,
  record,
  schema,
  schemaAsync,
  string,
  transform,
  transformAsync,
  tupleWithRest,
  union,
  variant,
} from "./index.js";
import type { InferInput, InferOutput, Schema } from "./index.js";

test("primitive schemas infer the same input and output types", () => {
  const schema_ = string();
  const arktypeSchema = arkType("string");
  const valibotSchema = v.string();
  const zodSchema = z.string();

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<typeof arktypeSchema.inferIn>().toEqualTypeOf<string>();
  expectTypeOf<v.InferInput<typeof valibotSchema>>().toEqualTypeOf<string>();
  expectTypeOf<z.input<typeof zodSchema>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<string>();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<string>();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<string>();
});

test("nested object and array schemas infer the same shape", () => {
  const schema_ = object({
    active: boolean(),
    name: string(),
    tags: array(string()),
  });
  const arktypeSchema = arkType({
    active: "boolean",
    name: "string",
    tags: "string[]",
  });
  const valibotSchema = v.object({
    active: v.boolean(),
    name: v.string(),
    tags: v.array(v.string()),
  });
  const zodSchema = z.object({
    active: z.boolean(),
    name: z.string(),
    tags: z.array(z.string()),
  });

  type User = {
    active: boolean;
    name: string;
    tags: string[];
  };

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<User>();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<User>();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<User>();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<User>();
});

test("optional schemas infer an explicit undefined input and output", () => {
  const schema_ = optional(string());
  const arktypeSchema = arkType("string | undefined");
  const valibotSchema = v.optional(v.string());
  const zodSchema = z.string().optional();

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<typeof arktypeSchema.inferIn>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<v.InferInput<typeof valibotSchema>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<z.input<typeof zodSchema>>().toEqualTypeOf<string | undefined>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<
    string | undefined
  >();
});

test("transforms infer the same string input and number output", () => {
  const schema_ = schema(
    string(),
    transform((value: string) => value.length),
  );
  const arktypeSchema = arkType("string").pipe((value) => value.length);
  const valibotSchema = v.pipe(
    v.string(),
    v.transform((value) => value.length),
  );
  const zodSchema = z.string().transform((value) => value.length);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<typeof arktypeSchema.inferIn>().toEqualTypeOf<string>();
  expectTypeOf<v.InferInput<typeof valibotSchema>>().toEqualTypeOf<string>();
  expectTypeOf<z.input<typeof zodSchema>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<number>();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<number>();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<number>();
});

test("literal unions infer the same closed union", () => {
  const schema_ = union([literal("ready"), literal("done"), number()]);
  const arktypeSchema = arkType("'ready' | 'done' | number");
  const valibotSchema = v.union([
    v.literal("ready"),
    v.literal("done"),
    v.number(),
  ]);
  const zodSchema = z.union([
    z.literal("ready"),
    z.literal("done"),
    z.number(),
  ]);

  type Status = "ready" | "done" | number;

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<Status>();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<Status>();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<Status>();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<Status>();
});

test("discriminated object unions infer the same branch union", () => {
  const schema_ = variant("kind", [
    object({ kind: literal("cat"), lives: number() }),
    object({ good: boolean(), kind: literal("dog") }),
  ]);
  const arktypeSchema = arkType({
    kind: "'cat'",
    lives: "number",
  }).or({
    good: "boolean",
    kind: "'dog'",
  });
  const valibotSchema = v.variant("kind", [
    v.object({ kind: v.literal("cat"), lives: v.number() }),
    v.object({ good: v.boolean(), kind: v.literal("dog") }),
  ]);
  const zodSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("cat"), lives: z.number() }),
    z.object({ good: z.boolean(), kind: z.literal("dog") }),
  ]);

  type Animal = { kind: "cat"; lives: number } | { good: boolean; kind: "dog" };

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<Animal>();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<Animal>();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<Animal>();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<Animal>();
});

test("tuples with rest infer the same positional output", () => {
  const schema_ = tupleWithRest([string(), number()], boolean());
  const arktypeSchema = arkType(["string", "number", "...", "boolean[]"]);
  const valibotSchema = v.tupleWithRest([v.string(), v.number()], v.boolean());
  const zodSchema = z.tuple([z.string(), z.number()], z.boolean());

  type Values = [string, number, ...boolean[]];

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<Values>();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<Values>();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<Values>();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<Values>();
});

test("records infer the same string-keyed number map", () => {
  const schema_ = record(string(), number());
  const arktypeSchema = arkType({ "[string]": "number" });
  const valibotSchema = v.record(v.string(), v.number());
  const zodSchema = z.record(z.string(), z.number());

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    Record<string, number>
  >();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<
    Record<string, number>
  >();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<
    Record<string, number>
  >();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<
    Record<string, number>
  >();
});

test("recursive schemas retain the same recursive output type", () => {
  interface TreeNode {
    children: TreeNode[];
    value: string;
  }

  const schema_: Schema<TreeNode> = lazy(() =>
    object({ children: array(schema_), value: string() }),
  );
  const arktypeSchema = arkType.module({
    node: { children: "node[]", value: "string" },
  }).node;
  const valibotSchema: v.GenericSchema<TreeNode> = v.lazy(() =>
    v.object({ children: v.array(valibotSchema), value: v.string() }),
  );
  const zodSchema: z.ZodType<TreeNode> = z.lazy(() =>
    z.object({ children: z.array(zodSchema), value: z.string() }),
  );

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<TreeNode>();
  expectTypeOf<typeof arktypeSchema.infer>().toEqualTypeOf<TreeNode>();
  expectTypeOf<v.InferOutput<typeof valibotSchema>>().toEqualTypeOf<TreeNode>();
  expectTypeOf<z.output<typeof zodSchema>>().toEqualTypeOf<TreeNode>();
});

test("async transforms return the same promised output from parse methods", () => {
  const schema_ = schemaAsync(
    string(),
    transformAsync(async (value: string) => value.length),
  );
  const arktypeSchema = arkType("string").pipe(async (value) => value.length);
  const valibotSchema = v.pipeAsync(
    v.string(),
    v.transformAsync(async (value) => value.length),
  );
  const zodSchema = z.string().transform(async (value) => value.length);

  expectTypeOf(parseAsync(schema_, "Ada")).toEqualTypeOf<Promise<number>>();
  expectTypeOf(arktypeSchema.assert("Ada")).toEqualTypeOf<Promise<number>>();
  expectTypeOf(v.parseAsync(valibotSchema, "Ada")).toEqualTypeOf<
    Promise<number>
  >();
  expectTypeOf(zodSchema.parseAsync("Ada")).toEqualTypeOf<Promise<number>>();
});
