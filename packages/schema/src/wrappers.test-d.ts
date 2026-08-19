/* eslint-disable @typescript-eslint/no-unused-vars -- Type tests consume fixtures through typeof queries. */

import { expectTypeOf, test } from "vitest";

import {
  exactOptional,
  exactOptionalAsync,
  fallback,
  fallbackAsync,
  forward,
  getDefault,
  getDefaults,
  getFallback,
  message,
  minLength,
  nonNullable,
  nonNullableAsync,
  nonNullish,
  nonNullishAsync,
  nonOptional,
  nonOptionalAsync,
  nullable,
  nullableAsync,
  nullish,
  nullishAsync,
  object,
  objectAsync,
  optional,
  optionalAsync,
  schema,
  schemaAsync,
  string,
  transform,
  transformAsync,
  undefinedable,
  undefinedableAsync,
  unwrap,
} from "./index.js";
import type { InferInput, InferOutput } from "./index.js";

test("optional adds undefined to transformed input and output types", () => {
  const wrapped = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = optional(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    number | undefined
  >();
  expectTypeOf(schema_.wrapped).toEqualTypeOf<typeof wrapped>();
});

test("optional with a default removes undefined from output only", () => {
  const wrapped = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = optional(wrapped, 0);
  const factorySchema = optional(wrapped, () => 0);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf<InferOutput<typeof factorySchema>>().toEqualTypeOf<number>();
  expectTypeOf(schema_["~default"]).toEqualTypeOf<number | (() => number)>();
});

test("async optional adds undefined and awaits wrapped output", () => {
  const wrapped = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const schema_ = optionalAsync(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    number | undefined
  >();
  expectTypeOf(schema_["~run"]).returns.toEqualTypeOf<
    Promise<number | undefined>
  >();
});

test("async optional default removes undefined from output only", () => {
  const wrapped = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const schema_ = optionalAsync(wrapped, 0);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf(schema_["~run"]).returns.toEqualTypeOf<Promise<number>>();
});

test("exact optional keeps wrapped types while marking object optionality", () => {
  const wrapped = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = exactOptional(wrapped);
  const parent = object({ value: schema_ });

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf<InferInput<typeof parent>>().toEqualTypeOf<{
    value?: string;
  }>();
  expectTypeOf<InferOutput<typeof parent>>().toEqualTypeOf<{
    value?: number;
  }>();
});

test("async exact optional keeps wrapped types and object optionality", () => {
  const wrapped = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const schema_ = exactOptionalAsync(wrapped);
  const parent = objectAsync({ value: schema_ });

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf<InferInput<typeof parent>>().toEqualTypeOf<{
    value?: string;
  }>();
  expectTypeOf<InferOutput<typeof parent>>().toEqualTypeOf<{
    value?: number;
  }>();
});

test("undefinedable adds undefined without object optional metadata", () => {
  const wrapped = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = undefinedable(wrapped);
  const parent = object({ value: schema_ });

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    number | undefined
  >();
  expectTypeOf<InferInput<typeof parent>>().toEqualTypeOf<{
    value: string | undefined;
  }>();
  expectTypeOf<InferOutput<typeof parent>>().toEqualTypeOf<{
    value: number | undefined;
  }>();
});

test("async undefinedable adds undefined to both sides", () => {
  const wrapped = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const schema_ = undefinedableAsync(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    number | undefined
  >();
});

test("nullable and nullish add their sentinel values to both sides", () => {
  const wrapped = schema(
    string(),
    transform((input: string) => input.length),
  );
  const nullableSchema = nullable(wrapped);
  const nullishSchema = nullish(wrapped);

  expectTypeOf<InferInput<typeof nullableSchema>>().toEqualTypeOf<
    string | null
  >();
  expectTypeOf<InferOutput<typeof nullableSchema>>().toEqualTypeOf<
    number | null
  >();
  expectTypeOf<InferInput<typeof nullishSchema>>().toEqualTypeOf<
    string | null | undefined
  >();
  expectTypeOf<InferOutput<typeof nullishSchema>>().toEqualTypeOf<
    number | null | undefined
  >();
});

test("async nullable and nullish preserve awaited output types", () => {
  const wrapped = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const nullableSchema = nullableAsync(wrapped);
  const nullishSchema = nullishAsync(wrapped);

  expectTypeOf<InferInput<typeof nullableSchema>>().toEqualTypeOf<
    string | null
  >();
  expectTypeOf<InferOutput<typeof nullableSchema>>().toEqualTypeOf<
    number | null
  >();
  expectTypeOf<InferInput<typeof nullishSchema>>().toEqualTypeOf<
    string | null | undefined
  >();
  expectTypeOf<InferOutput<typeof nullishSchema>>().toEqualTypeOf<
    number | null | undefined
  >();
});

test("non optional removes undefined from transformed input and output", () => {
  const wrapped = optional(
    schema(
      string(),
      transform((input: string) => input.length),
    ),
  );
  const schema_ = nonOptional(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
});

test("non nullable removes null from transformed input and output", () => {
  const wrapped = nullable(
    schema(
      string(),
      transform((input: string) => input.length),
    ),
  );
  const schema_ = nonNullable(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
});

test("non nullish removes null and undefined from both sides", () => {
  const wrapped = nullish(
    schema(
      string(),
      transform((input: string) => input.length),
    ),
  );
  const schema_ = nonNullish(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
});

test("async non optional removes undefined from both sides", () => {
  const wrapped = optionalAsync(
    schemaAsync(
      string(),
      transformAsync(async (input: string) => input.length),
    ),
  );
  const schema_ = nonOptionalAsync(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
});

test("async non nullable removes null from both sides", () => {
  const wrapped = nullableAsync(
    schemaAsync(
      string(),
      transformAsync(async (input: string) => input.length),
    ),
  );
  const schema_ = nonNullableAsync(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
});

test("async non nullish removes null and undefined from both sides", () => {
  const wrapped = nullishAsync(
    schemaAsync(
      string(),
      transformAsync(async (input: string) => input.length),
    ),
  );
  const schema_ = nonNullishAsync(wrapped);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
});

test("fallback retains wrapped input and output types", () => {
  const wrapped = schema(
    string(),
    transform((input: string) => input.length),
  );
  const valueSchema = fallback(wrapped, 0);
  const factorySchema = fallback(wrapped, () => 0);

  expectTypeOf<InferInput<typeof valueSchema>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof valueSchema>>().toEqualTypeOf<number>();
  expectTypeOf<InferInput<typeof factorySchema>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof factorySchema>>().toEqualTypeOf<number>();
});

test("async fallback retains wrapped input and awaited output types", () => {
  const wrapped = schemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );
  const schema_ = fallbackAsync(wrapped, async () => 0);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf(schema_["~run"]).returns.toEqualTypeOf<Promise<number>>();
});

test("message preserves the wrapped schema input and output", () => {
  const wrapped = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = message(wrapped, "Not valid");

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
});

test("forward returns the exact action type", () => {
  const action = minLength(2);
  const forwarded = forward(action, ["profile", "name"]);

  expectTypeOf(forwarded).toEqualTypeOf<typeof action>();
});

test("unwrap returns the exact wrapped schema type", () => {
  const wrapped = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = optional(wrapped);

  expectTypeOf(unwrap(schema_)).toEqualTypeOf<typeof wrapped>();
});

test("default and fallback introspection retain their documented broad types", () => {
  const defaultSchema = optional(string(), "default");
  const fallbackSchema = fallback(string(), "fallback");
  const objectSchema = object({ name: defaultSchema });

  expectTypeOf(getDefault(defaultSchema)).toBeUnknown();
  expectTypeOf(getDefaults(objectSchema)).toEqualTypeOf<
    Readonly<Record<string, unknown>>
  >();
  expectTypeOf(getFallback(fallbackSchema)).toBeUnknown();
});

test("wrapper defaults and fallbacks reject incompatible output values", () => {
  // @ts-expect-error string schemas require string defaults
  optional(string(), 42);

  // @ts-expect-error string schemas require string fallbacks
  fallback(string(), 42);
});
