/* eslint-disable @typescript-eslint/no-unused-vars -- Type tests consume fixtures through typeof queries. */

import { expectTypeOf, test } from "vitest";

import {
  brand,
  check,
  checkAsync,
  number,
  optional,
  schema,
  schemaAsync,
  string,
  transform,
  transformAsync,
} from "./index.js";
import type {
  AsyncObjectInput,
  AsyncObjectOutput,
  AsyncSchemaOutput,
  Branded,
  FunctionInput,
  FunctionOutput,
  GenericTupleInput,
  GenericTupleOutput,
  InferActionInput,
  InferActionOutput,
  InternalResult,
  ObjectInput,
  ObjectOutput,
  ObjectWithRestInput,
  ObjectWithRestOutput,
  PartialEntries,
  RequiredEntries,
  SafeParseResult,
  SchemaOutput,
  StandardResult,
  TupleInput,
  TupleOutput,
  TupleWithRestInput,
  TupleWithRestOutput,
} from "./index.js";

test("action inference helpers expose each action boundary", () => {
  const action = transform((input: string) => input.length);

  expectTypeOf<InferActionInput<typeof action>>().toEqualTypeOf<string>();
  expectTypeOf<InferActionOutput<typeof action>>().toEqualTypeOf<number>();
});

test("schema output applies validation, transformation, and brand actions in order", () => {
  const actions = [
    check((input: string) => input.length > 0),
    transform((input: string) => input.length),
    brand<"Length">(),
  ] as const;

  expectTypeOf<SchemaOutput<string, typeof actions>>().toEqualTypeOf<
    Branded<number, "Length">
  >();
});

test("async schema output applies sync and async actions in order", () => {
  const actions = [
    checkAsync(async (input: string) => input.length > 0),
    transformAsync(async (input: string) => input.length),
    check((input: number) => input > 0),
  ] as const;

  expectTypeOf<
    AsyncSchemaOutput<string, typeof actions>
  >().toEqualTypeOf<number>();
});

test("object helpers preserve required, optional, defaulted, and transformed fields", () => {
  const entries = {
    age: schema(
      string(),
      transform((input: string) => input.length),
    ),
    id: string(),
    name: optional(string()),
    score: optional(number(), 0),
  };

  expectTypeOf<ObjectInput<typeof entries>>().toEqualTypeOf<{
    age: string;
    id: string;
    name?: string | undefined;
    score?: number | undefined;
  }>();
  expectTypeOf<ObjectOutput<typeof entries>>().toEqualTypeOf<{
    age: number;
    id: string;
    name?: string | undefined;
    score: number;
  }>();
});

test("async object helpers await entry output without changing object shape", () => {
  const entries = {
    count: schemaAsync(
      string(),
      transformAsync(async (input: string) => input.length),
    ),
    id: string(),
  };

  expectTypeOf<AsyncObjectInput<typeof entries>>().toEqualTypeOf<{
    count: string;
    id: string;
  }>();
  expectTypeOf<AsyncObjectOutput<typeof entries>>().toEqualTypeOf<{
    count: number;
    id: string;
  }>();
});

test("partial and required entry helpers keep wrapped schema identities", () => {
  const id = string();
  const name = optional(string());
  const entries = { id, name };
  const partialId = optional(id);

  expectTypeOf<PartialEntries<typeof entries>>().toEqualTypeOf<{
    id: typeof partialId;
    name: typeof name;
  }>();
  expectTypeOf<RequiredEntries<typeof entries>>().toEqualTypeOf<{
    id: typeof id;
    name: typeof name.wrapped;
  }>();
});

test("tuple helpers preserve position-specific sync and async types", () => {
  const transformed = schema(
    string(),
    transform((input: string) => input.length),
  );
  const items = [string(), transformed] as const;

  expectTypeOf<TupleInput<typeof items>>().toEqualTypeOf<[string, string]>();
  expectTypeOf<TupleOutput<typeof items>>().toEqualTypeOf<[string, number]>();
  expectTypeOf<GenericTupleInput<typeof items>>().toEqualTypeOf<
    [string, string]
  >();
  expectTypeOf<GenericTupleOutput<typeof items>>().toEqualTypeOf<
    [string, number]
  >();
});

test("rest helpers append the rest schema input and output types", () => {
  const items = [string(), number()] as const;
  const rest = string();
  const entries = { id: string() };

  expectTypeOf<TupleWithRestInput<typeof items, typeof rest>>().toEqualTypeOf<
    [string, number, ...string[]]
  >();
  expectTypeOf<TupleWithRestOutput<typeof items, typeof rest>>().toEqualTypeOf<
    [string, number, ...string[]]
  >();
  expectTypeOf<
    ObjectWithRestInput<typeof entries, typeof rest>
  >().toEqualTypeOf<{ id: string } & Record<string, string>>();
  expectTypeOf<
    ObjectWithRestOutput<typeof entries, typeof rest>
  >().toEqualTypeOf<{ id: string } & Record<string, string>>();
});

test("function helpers parse arguments and transform return values independently", () => {
  const arguments_ = [string(), number()] as const;
  const return_ = schema(
    string(),
    transform((input: string) => input.length),
  );

  expectTypeOf<
    FunctionInput<typeof arguments_, typeof return_>
  >().toEqualTypeOf<(name: string, count: number) => string>();
  expectTypeOf<
    FunctionOutput<typeof arguments_, typeof return_>
  >().toEqualTypeOf<(name: string, count: number) => number>();
});

test("result helpers expose exact success and failure unions", () => {
  const schema_ = string();

  expectTypeOf<InternalResult<string>>().toEqualTypeOf<
    | {
        readonly issues: undefined;
        readonly output: string;
        readonly success: true;
      }
    | {
        readonly issues: readonly import("./index.js").Issue[];
        readonly output: undefined;
        readonly success: false;
      }
  >();
  expectTypeOf<StandardResult<string>>().toEqualTypeOf<
    | { readonly value: string }
    | { readonly issues: readonly import("./index.js").StandardIssue[] }
  >();
  expectTypeOf<SafeParseResult<typeof schema_>>().toEqualTypeOf<
    | {
        readonly issues: undefined;
        readonly output: string;
        readonly success: true;
      }
    | {
        readonly issues: readonly import("./index.js").Issue[];
        readonly output: undefined;
        readonly success: false;
      }
  >();
});
