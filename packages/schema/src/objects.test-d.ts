/* eslint-disable @typescript-eslint/no-unused-vars -- Type tests consume fixtures through typeof queries. */

import { expectTypeOf, test } from "vitest";

import {
  boolean,
  exactOptional,
  extend,
  keyof_,
  looseObject,
  looseObjectAsync,
  merge,
  number,
  object,
  objectAsync,
  objectWithRest,
  objectWithRestAsync,
  omit,
  optional,
  optionalAsync,
  partial,
  partialAsync,
  pick,
  required,
  requiredAsync,
  schema,
  schemaAsync,
  strictObject,
  strictObjectAsync,
  string,
  transform,
  transformAsync,
} from "./index.js";
import type { InferInput, InferOutput } from "./index.js";

test("object infers distinct input and output types for every entry kind", () => {
  const stringLength = schema(
    string(),
    transform((value: string) => value.length),
  );
  const entries = {
    age: stringLength,
    exact: exactOptional(number()),
    id: string(),
    name: optional(string()),
    score: optional(stringLength, 0),
  };
  const objectSchema = object(entries);

  expectTypeOf<InferInput<typeof objectSchema>>().toEqualTypeOf<{
    age: string;
    exact?: number;
    id: string;
    name?: string | undefined;
    score?: string | undefined;
  }>();
  expectTypeOf<InferOutput<typeof objectSchema>>().toEqualTypeOf<{
    age: number;
    exact?: number;
    id: string;
    name?: string | undefined;
    score: number;
  }>();
  expectTypeOf(objectSchema.entries).toEqualTypeOf<typeof entries>();
});

test("strict object retains the base object input and output types", () => {
  const schema_ = strictObject({
    id: string(),
    revision: optional(number()),
  });

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<{
    id: string;
    revision?: number | undefined;
  }>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<{
    id: string;
    revision?: number | undefined;
  }>();
});

test("loose object adds unknown keys without widening known entries", () => {
  const schema_ = looseObject({
    count: schema(
      string(),
      transform((value: string) => value.length),
    ),
    id: string(),
  });

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    { count: string; id: string } & Record<string, unknown>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    { count: number; id: string } & Record<string, unknown>
  >();
});

test("object with rest preserves known fields and transforms rest values", () => {
  const rest = schema(
    string(),
    transform((value: string) => value.length),
  );
  const schema_ = objectWithRest({ id: string() }, rest);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    { id: string } & Record<string, string>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    { id: string } & Record<string, string | number>
  >();
});

test("async object mixes sync and async entries without losing inference", () => {
  const asyncLength = schemaAsync(
    string(),
    transformAsync(async (value: string) => value.length),
  );
  const schema_ = objectAsync({
    id: string(),
    name: optionalAsync(string()),
    score: asyncLength,
  });

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<{
    id: string;
    name?: string | undefined;
    score: string;
  }>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<{
    id: string;
    name?: string | undefined;
    score: number;
  }>();
  expectTypeOf(schema_["~run"]).returns.toEqualTypeOf<
    Promise<{ id: string; name?: string | undefined; score: number }>
  >();
});

test("strict async object retains its known entry types", () => {
  const schema_ = strictObjectAsync({
    id: string(),
    revision: optionalAsync(number()),
  });

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<{
    id: string;
    revision?: number | undefined;
  }>();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<{
    id: string;
    revision?: number | undefined;
  }>();
});

test("loose async object adds unknown keys to both sides", () => {
  const schema_ = looseObjectAsync({
    count: schemaAsync(
      string(),
      transformAsync(async (value: string) => value.length),
    ),
  });

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    { count: string } & Record<string, unknown>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    { count: number } & Record<string, unknown>
  >();
});

test("async object with rest keeps transformed rest outputs", () => {
  const rest = schemaAsync(
    string(),
    transformAsync(async (value: string) => value.length),
  );
  const schema_ = objectWithRestAsync({ id: string() }, rest);

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    { id: string } & Record<string, string>
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    { id: string } & Record<string, string | number>
  >();
});

test("pick and omit retain only the selected entry types", () => {
  const base = object({
    active: optional(number()),
    id: string(),
    name: string(),
  });
  const picked = pick(base, ["id", "active"]);
  const omitted = omit(base, ["name"]);

  expectTypeOf<InferOutput<typeof picked>>().toEqualTypeOf<{
    active?: number | undefined;
    id: string;
  }>();
  expectTypeOf<InferOutput<typeof omitted>>().toEqualTypeOf<{
    active?: number | undefined;
    id: string;
  }>();
});

test("partial and required update all object property modifiers", () => {
  const base = object({
    id: string(),
    name: optional(string()),
  });
  const partialSchema = partial(base);
  const requiredSchema = required(base);

  expectTypeOf<InferInput<typeof partialSchema>>().toEqualTypeOf<{
    id?: string | undefined;
    name?: string | undefined;
  }>();
  expectTypeOf<InferOutput<typeof partialSchema>>().toEqualTypeOf<{
    id?: string | undefined;
    name?: string | undefined;
  }>();
  expectTypeOf<InferInput<typeof requiredSchema>>().toEqualTypeOf<{
    id: string;
    name: string;
  }>();
  expectTypeOf<InferOutput<typeof requiredSchema>>().toEqualTypeOf<{
    id: string;
    name: string;
  }>();
});

test("selected partial and required only update named keys", () => {
  const base = object({
    id: string(),
    name: optional(string()),
    revision: optional(number()),
  });
  const partialSchema = partial(base, ["id"]);
  const requiredSchema = required(base, ["name"]);

  expectTypeOf<InferOutput<typeof partialSchema>>().toEqualTypeOf<{
    id?: string | undefined;
    name?: string | undefined;
    revision?: number | undefined;
  }>();
  expectTypeOf<InferOutput<typeof requiredSchema>>().toEqualTypeOf<{
    id: string;
    name: string;
    revision?: number | undefined;
  }>();
});

test("async partial and required update async object property modifiers", () => {
  const base = objectAsync({
    id: string(),
    name: optionalAsync(string()),
  });
  const partialSchema = partialAsync(base);
  const requiredSchema = requiredAsync(base);

  expectTypeOf<InferOutput<typeof partialSchema>>().toEqualTypeOf<{
    id?: string | undefined;
    name?: string | undefined;
  }>();
  expectTypeOf<InferOutput<typeof requiredSchema>>().toEqualTypeOf<{
    id: string;
    name: string;
  }>();
});

test("extend replaces conflicting entries and adds new entries", () => {
  const base = object({ id: string(), value: string() });
  const schema_ = extend(base, {
    active: optional(string()),
    value: number(),
  });

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<{
    active?: string | undefined;
    id: string;
    value: number;
  }>();
});

test("merge uses right-hand entries on conflicts", () => {
  const left = object({ id: string(), value: string() });
  const right = object({ active: boolean(), value: number() });
  const schema_ = merge(left, right);

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<{
    active: boolean;
    id: string;
    value: number;
  }>();
});

test("object key schema preserves the exact string key union", () => {
  const schema_ = keyof_(
    object({
      active: boolean(),
      id: string(),
      revision: number(),
    }),
  );

  expectTypeOf<InferInput<typeof schema_>>().toEqualTypeOf<
    "active" | "id" | "revision"
  >();
  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<
    "active" | "id" | "revision"
  >();
});

test("object utilities reject keys absent from the entry map", () => {
  const base = object({ id: string(), name: string() });

  // @ts-expect-error unknown keys cannot be picked
  pick(base, ["missing"]);

  // @ts-expect-error unknown keys cannot be omitted
  omit(base, ["missing"]);

  // @ts-expect-error unknown keys cannot be made partial
  partial(base, ["missing"]);

  // @ts-expect-error unknown keys cannot be made required
  required(base, ["missing"]);
});
