/* eslint-disable @typescript-eslint/no-unused-vars -- Type tests consume fixtures through typeof queries. */

import { expectTypeOf, test } from "vitest";

import {
  array,
  arrayAsync,
  codec,
  codecAsync,
  coerceNumber,
  date,
  decode,
  decodeAsync,
  encode,
  encodeAsync,
  function_,
  functionAsync,
  map,
  mapAsync,
  number,
  picklist,
  promise,
  record,
  recordAsync,
  schema,
  schemaAsync,
  set,
  setAsync,
  string,
  transform,
  transformAsync,
  tuple,
  tupleAsync,
  tupleWithRest,
  tupleWithRestAsync,
} from "./index.js";
import type { InferInput, InferOutput } from "./index.js";

test("array carries transformed item input and output types", () => {
  const item = schema(
    string(),
    transform((value: string) => value.length),
  );
  const schema_ = array(item);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string[]>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number[]>();
  expectTypeOf(schema_.item).toEqualTypeOf<typeof item>();
});

test("async array accepts sync or async items and awaits their outputs", () => {
  const item = schemaAsync(
    string(),
    transformAsync(async (value: string) => value.length),
  );
  const schema_ = arrayAsync(item);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string[]>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number[]>();
  expectTypeOf(schema_["~run"]).returns.toEqualTypeOf<Promise<number[]>>();
  expectTypeOf(schema_.item).toEqualTypeOf<typeof item>();
});

test("tuple preserves position-specific transformed types", () => {
  const transformed = schema(
    string(),
    transform((value: string) => value.length),
  );
  const schema_ = tuple([string(), transformed, coerceNumber()]);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    [string, string, unknown]
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    [string, number, number]
  >();
  expectTypeOf(schema_.items).toEqualTypeOf<
    readonly [
      ReturnType<typeof string>,
      typeof transformed,
      ReturnType<typeof coerceNumber>,
    ]
  >();
});

test("async tuple preserves positions across sync and async items", () => {
  const transformed = schemaAsync(
    string(),
    transformAsync(async (value: string) => value.length),
  );
  const schema_ = tupleAsync([string(), transformed, coerceNumber()]);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    [string, string, unknown]
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    [string, number, number]
  >();
});

test("tuple with rest retains fixed positions and trailing item types", () => {
  const rest = schema(
    string(),
    transform((value: string) => value.length),
  );
  const schema_ = tupleWithRest([string(), number()], rest);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    [string, number, ...string[]]
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    [string, number, ...number[]]
  >();
  expectTypeOf(schema_.rest).toEqualTypeOf<typeof rest>();
});

test("async tuple with rest awaits fixed and trailing item outputs", () => {
  const fixed = schemaAsync(
    string(),
    transformAsync(async (value: string) => value.length),
  );
  const rest = schemaAsync(
    string(),
    transformAsync(async (value: string) => value === "true"),
  );
  const schema_ = tupleWithRestAsync([fixed, number()], rest);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    [string, number, ...string[]]
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    [number, number, ...boolean[]]
  >();
});

test("record preserves finite key unions and transformed value types", () => {
  const key = picklist(["name", "status"] as const);
  const value = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = record(key, value);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    Partial<Record<"name" | "status", string>>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    Partial<Record<"name" | "status", number>>
  >();
  expectTypeOf(schema_.key).toEqualTypeOf<typeof key>();
  expectTypeOf(schema_.value).toEqualTypeOf<typeof value>();
});

test("async record awaits key and value schema outputs", () => {
  const key = picklist(["name", "status"] as const);
  const value = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const schema_ = recordAsync(key, value);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    Partial<Record<"name" | "status", string>>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    Partial<Record<"name" | "status", number>>
  >();
});

test("map preserves distinct key and value input and output types", () => {
  const key = schema(
    string(),
    transform((input: string) => input.length),
  );
  const value = schema(
    string(),
    transform((input: string) => input === "yes"),
  );
  const schema_ = map(key, value);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    Map<string, string>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    Map<number, boolean>
  >();
});

test("async map awaits distinct key and value outputs", () => {
  const key = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const value = schemaAsync(
    string(),
    transformAsync(async (input: string) => input === "yes"),
  );
  const schema_ = mapAsync(key, value);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    Map<string, string>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    Map<number, boolean>
  >();
});

test("set preserves transformed item input and output types", () => {
  const item = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = set(item);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<Set<string>>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<Set<number>>();
  expectTypeOf(schema_.item).toEqualTypeOf<typeof item>();
});

test("async set awaits transformed item outputs", () => {
  const item = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const schema_ = setAsync(item);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<Set<string>>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<Set<number>>();
});

test("function schema separates callable input and output return types", () => {
  const returnSchema = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = function_([string(), coerceNumber()], returnSchema);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    (name: string, count: unknown) => string
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    (name: string, count: unknown) => number
  >();
});

test("async function schema returns a promise of the parsed return type", () => {
  const returnSchema = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const schema_ = functionAsync([string(), coerceNumber()], returnSchema);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    (name: string, count: unknown) => string | PromiseLike<string>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    (name: string, count: unknown) => Promise<number>
  >();
});

test("promise schema converts its resolved item output", () => {
  const item = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = promise(item);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    PromiseLike<string>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<Promise<number>>();
});

test("codec exposes encoded input and decoded output types", () => {
  const schema_ = codec(
    string(),
    number(),
    (input) => Number(input),
    (output) => String(output),
  );

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf(decode(schema_, "42")).toEqualTypeOf<number>();
  expectTypeOf(encode(schema_, 42)).toEqualTypeOf<string>();
  expectTypeOf(schema_["~encode"]).parameter(0).toEqualTypeOf<number>();
  expectTypeOf(schema_["~encode"]).returns.toEqualTypeOf<string>();
});

test("async codec awaits decode and encode operations", () => {
  const schema_ = codecAsync(
    string(),
    number(),
    async (input) => Number(input),
    async (output) => String(output),
  );

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf(decodeAsync(schema_, "42")).toEqualTypeOf<Promise<number>>();
  expectTypeOf(encodeAsync(schema_, 42)).toEqualTypeOf<Promise<string>>();
  expectTypeOf(schema_["~encode"]).parameter(0).toEqualTypeOf<number>();
  expectTypeOf(schema_["~encode"]).returns.toEqualTypeOf<Promise<string>>();
});

test("collection constructors reject structurally invalid schema lists", () => {
  // @ts-expect-error tuple items must be schemas
  tuple([string(), "not-a-schema"]);

  // @ts-expect-error record keys must produce property keys
  record(date(), string());
});
