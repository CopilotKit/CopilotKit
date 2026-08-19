/* eslint-disable @typescript-eslint/no-unused-vars -- Type tests consume fixtures through typeof queries. */

import { expectTypeOf, test } from "vitest";

import {
  array,
  boolean,
  check,
  checkAsync,
  intersect,
  intersectAsync,
  lazy,
  lazyAsync,
  literal,
  minLength,
  number,
  object,
  objectAsync,
  readonly_,
  schema,
  schemaAsync,
  string,
  transform,
  transformAsync,
  union,
  unionAsync,
  variant,
  variantAsync,
  brand,
} from "./index.js";
import type { Branded, InferInput, InferOutput, Schema } from "./index.js";

test("union infers the input and output union of every option", () => {
  const transformed = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = union([literal("ready"), number(), transformed]);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    "ready" | number | string
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<"ready" | number>();
  expectTypeOf(schema_.options).toEqualTypeOf<
    readonly [
      ReturnType<typeof literal<"ready">>,
      ReturnType<typeof number>,
      typeof transformed,
    ]
  >();
});

test("async union awaits async option outputs without widening sync options", () => {
  const transformed = schemaAsync(
    string(),
    transformAsync(async (input: string) => input === "true"),
  );
  const schema_ = unionAsync([number(), transformed]);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<number | string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number | boolean>();
});

test("variant preserves a discriminated object union", () => {
  const cat = object({
    kind: literal("cat"),
    lives: number(),
  });
  const dog = object({
    good: boolean(),
    kind: literal("dog"),
  });
  const schema_ = variant("kind", [cat, dog]);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    { kind: "cat"; lives: number } | { good: boolean; kind: "dog" }
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    { kind: "cat"; lives: number } | { good: boolean; kind: "dog" }
  >();
  expectTypeOf(schema_.discriminator).toEqualTypeOf<string>();
  expectTypeOf(schema_.options).toEqualTypeOf<
    readonly [typeof cat, typeof dog]
  >();
});

test("async variant preserves transformed discriminated object outputs", () => {
  const cat = objectAsync({
    kind: literal("cat"),
    lives: schemaAsync(
      string(),
      transformAsync(async (input: string) => input.length),
    ),
  });
  const dog = objectAsync({
    good: boolean(),
    kind: literal("dog"),
  });
  const schema_ = variantAsync("kind", [cat, dog]);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    { kind: "cat"; lives: string } | { good: boolean; kind: "dog" }
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    { kind: "cat"; lives: number } | { good: boolean; kind: "dog" }
  >();
});

test("intersect computes input and output intersections", () => {
  const transformed = object({
    count: schema(
      string(),
      transform((input: string) => input.length),
    ),
  });
  const schema_ = intersect([
    object({ id: string() }),
    object({ active: boolean() }),
    transformed,
  ]);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    { id: string } & { active: boolean } & { count: string }
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    { id: string } & { active: boolean } & { count: number }
  >();
});

test("async intersect awaits option outputs and keeps their intersection", () => {
  const transformed = objectAsync({
    count: schemaAsync(
      string(),
      transformAsync(async (input: string) => input.length),
    ),
  });
  const schema_ = intersectAsync([
    object({ id: string() }),
    objectAsync({ active: boolean() }),
    transformed,
  ]);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    { id: string } & { active: boolean } & { count: string }
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    { id: string } & { active: boolean } & { count: number }
  >();
});

test("lazy retains explicit recursive schema input and output types", () => {
  interface Node {
    children: Node[];
    value: string;
  }

  const nodeSchema: Schema<Node> = lazy(() =>
    object({
      children: array(nodeSchema),
      value: string(),
    }),
  );

  expectTypeOf<InferInput<typeof nodeSchema>>().toEqualTypeOf<Node>();
  expectTypeOf<InferOutput<typeof nodeSchema>>().toEqualTypeOf<Node>();
});

test("lazy carries a wrapped schema transformation through both sides", () => {
  const inner = schema(
    string(),
    transform((input: string) => input.length),
  );
  const schema_ = lazy(() => inner);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf(schema_.getSchema).returns.toEqualTypeOf<typeof inner>();
});

test("async lazy retains explicit input and output types", () => {
  const schema_ = lazyAsync<string, number>(async () =>
    schemaAsync(
      string(),
      transformAsync(async (input: string) => input.length),
    ),
  );

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
});

test("schema threads transformations through ordered actions", () => {
  const trimAction = transform((input: string) => input.trim());
  const lengthAction = transform((input: string) => input.length);
  const schema_ = schema(
    string(),
    minLength(1),
    trimAction,
    check((input: string) => input.length > 0),
    lengthAction,
    check((input: number) => input > 0),
  );

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<number>();
  expectTypeOf(schema_.actions).toEqualTypeOf<
    readonly [
      ReturnType<typeof minLength>,
      typeof trimAction,
      ReturnType<typeof check<string>>,
      typeof lengthAction,
      ReturnType<typeof check<number>>,
    ]
  >();
});

test("schema applies brands and readonly modifiers to the current output", () => {
  const idSchema = schema(string(), brand<"UserId">());
  const readonlySchema = schema(
    object({ id: string(), revision: number() }),
    readonly_(),
  );

  expectTypeOf<InferInput<typeof idSchema>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof idSchema>>().toEqualTypeOf<
    Branded<string, "UserId">
  >();
  expectTypeOf<InferOutput<typeof readonlySchema>>().toEqualTypeOf<
    Readonly<{ id: string; revision: number }>
  >();
});

test("async schema threads sync and async actions in order", () => {
  const schema_ = schemaAsync(
    string(),
    check((input: string) => input.length > 0),
    transformAsync(async (input: string) => input.length),
    checkAsync(async (input: number) => input > 0),
    transform((input: number) => input > 10),
  );

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<boolean>();
  expectTypeOf(schema_["~run"]).returns.toEqualTypeOf<Promise<boolean>>();
});

test("composition rejects invalid arity and action ordering", () => {
  // @ts-expect-error unions require at least one option
  union([]);

  // @ts-expect-error intersections require at least two options
  intersect([string()]);

  // @ts-expect-error variants require at least two object options
  variant("kind", [object({ kind: literal("only") })]);

  schema(
    string(),
    // @ts-expect-error minLength cannot run after a number transformation
    transform((input: string) => input.length),
    minLength(1),
  );
});
