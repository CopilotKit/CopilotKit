/* eslint-disable @typescript-eslint/no-unused-vars -- Type tests consume fixtures through typeof queries. */

import { expectTypeOf, test } from "vitest";

import {
  assert,
  description,
  examples,
  flatten,
  fromJSONSchema,
  getDescription,
  getExamples,
  getMetadata,
  getTitle,
  is,
  message,
  metadata,
  number,
  object,
  parse,
  parseAsync,
  parser,
  registry,
  resetGlobalMessage,
  safeParse,
  safeParseAsync,
  safeParser,
  schema,
  setGlobalMessage,
  string,
  summarize,
  title,
  toJSONSchema,
  transform,
  ValidationError,
} from "./index.js";
import type {
  InferOutput,
  Issue,
  JsonSchema,
  SafeParseResult,
  StandardResult,
} from "./index.js";

test("parse returns the schema output type", () => {
  const schema_ = schema(
    string(),
    transform((input: string) => input.length),
  );

  expectTypeOf(parse(schema_, "42")).toEqualTypeOf<number>();
});

test("safe parse returns a schema-specific discriminated result", () => {
  const schema_ = object({ id: string(), revision: number() });
  const result = safeParse(schema_, {});

  expectTypeOf(result).toEqualTypeOf<SafeParseResult<typeof schema_>>();
  if (result.success) {
    expectTypeOf(result.output).toEqualTypeOf<{
      id: string;
      revision: number;
    }>();
    expectTypeOf(result.issues).toEqualTypeOf<undefined>();
  } else {
    expectTypeOf(result.output).toEqualTypeOf<undefined>();
    expectTypeOf(result.issues).toEqualTypeOf<readonly Issue[]>();
  }
});

test("async parse returns a promise of sync or async schema output", () => {
  const schema_ = schema(
    string(),
    transform((input: string) => input.length),
  );

  expectTypeOf(parseAsync(schema_, "42")).toEqualTypeOf<Promise<number>>();
});

test("async safe parse returns a promised schema-specific result", () => {
  const schema_ = object({ id: string() });

  expectTypeOf(safeParseAsync(schema_, {})).toEqualTypeOf<
    Promise<SafeParseResult<typeof schema_>>
  >();
});

test("parser produces an unknown-input function with schema output", () => {
  const schema_ = schema(
    string(),
    transform((input: string) => input.length),
  );
  const parseValue = parser(schema_);

  expectTypeOf(parseValue).toEqualTypeOf<(input: unknown) => number>();
});

test("safe parser produces an unknown-input safe result function", () => {
  const schema_ = object({ id: string() });
  const parseValue = safeParser(schema_);

  expectTypeOf(parseValue).toEqualTypeOf<
    (input: unknown) => SafeParseResult<typeof schema_>
  >();
});

test("is narrows unknown values to the schema input type", () => {
  const schema_ = object({ id: string() });
  const input: unknown = {};

  if (is(schema_, input)) {
    expectTypeOf(input).toEqualTypeOf<{ id: string }>();
  }
});

test("assert narrows unknown values to the schema input type", () => {
  const schema_ = object({ id: string() });
  const input: unknown = {};

  assert(schema_, input);

  expectTypeOf(input).toEqualTypeOf<{ id: string }>();
});

test("standard schema properties retain input and output contracts", () => {
  const schema_ = schema(
    string(),
    transform((input: string) => input.length),
  );
  const standard = schema_["~standard"];

  expectTypeOf(standard.types?.input).toEqualTypeOf<string | undefined>();
  expectTypeOf(standard.types?.output).toEqualTypeOf<number | undefined>();
  expectTypeOf(standard.vendor).toEqualTypeOf<"@copilotkit/schema">();
  expectTypeOf(standard.version).toEqualTypeOf<1>();
  expectTypeOf(standard.validate).parameter(0).toBeUnknown();
  expectTypeOf(standard.validate).returns.toEqualTypeOf<
    StandardResult<number> | Promise<StandardResult<number>>
  >();
});

test("metadata helpers preserve the exact schema type", () => {
  const schema_ = object({ id: string() });
  const withMetadata = metadata(schema_, { owner: "runtime" });
  const withTitle = title(schema_, "User");
  const withDescription = description(schema_, "A user record");
  const withExamples = examples(schema_, [{ id: "user-1" }]);

  expectTypeOf(withMetadata).toEqualTypeOf<typeof schema_>();
  expectTypeOf(withTitle).toEqualTypeOf<typeof schema_>();
  expectTypeOf(withDescription).toEqualTypeOf<typeof schema_>();
  expectTypeOf(withExamples).toEqualTypeOf<typeof schema_>();
  expectTypeOf(getMetadata(schema_)).toEqualTypeOf<
    Readonly<Record<string, unknown>> | undefined
  >();
  expectTypeOf(getTitle(schema_)).toEqualTypeOf<string | undefined>();
  expectTypeOf(getDescription(schema_)).toEqualTypeOf<string | undefined>();
  expectTypeOf(getExamples(schema_)).toEqualTypeOf<
    readonly unknown[] | undefined
  >();
});

test("examples require values assignable to schema output", () => {
  const schema_ = object({ id: string() });

  examples(schema_, [{ id: "user-1" }]);

  // @ts-expect-error example id must match the schema output
  examples(schema_, [{ id: 42 }]);
});

test("typed registry retains its metadata contract and fluent add return", () => {
  interface RegistryMetadata {
    readonly owner: "runtime" | "ui";
    readonly stable: boolean;
  }

  const schema_ = string();
  const schemas = registry<RegistryMetadata>();
  const added = schemas.add(schema_, { owner: "runtime", stable: true });

  expectTypeOf(added).toEqualTypeOf<typeof schemas>();
  expectTypeOf(schemas.get(schema_)).toEqualTypeOf<
    RegistryMetadata | undefined
  >();
  expectTypeOf(schemas.has(schema_)).toEqualTypeOf<boolean>();
  expectTypeOf(schemas.remove(schema_)).toEqualTypeOf<boolean>();
  expectTypeOf(schemas.clear()).toBeVoid();
});

test("registry rejects metadata outside its declared contract", () => {
  const schemas = registry<{ readonly owner: string }>();

  // @ts-expect-error owner is required
  schemas.add(string(), {});
});

test("schema metadata wrappers do not alter parsed output", () => {
  const schema_ = message(
    description(title(string(), "Name"), "Display name"),
    "Invalid name",
  );

  expectTypeOf<InferOutput<typeof schema_>>().toEqualTypeOf<string>();
});

test("JSON Schema conversion retains its public broad output type", () => {
  const jsonSchema = toJSONSchema(object({ id: string() }));

  expectTypeOf(jsonSchema).toEqualTypeOf<JsonSchema>();
  expectTypeOf(
    toJSONSchema(string(), { target: "openapi-3.0" }),
  ).toEqualTypeOf<JsonSchema>();
});

test("JSON Schema import exposes unknown input and output", () => {
  const schema_ = fromJSONSchema({
    properties: { id: { type: "string" } },
    required: ["id"],
    type: "object",
  });

  expectTypeOf(schema_["~types"]?.input).toBeUnknown();
  expectTypeOf(schema_["~types"]?.output).toBeUnknown();
});

test("issue formatting helpers retain their result contracts", () => {
  const error = new ValidationError([]);

  expectTypeOf(flatten(error)).toEqualTypeOf<{
    readonly nested: Readonly<Record<string, readonly string[]>>;
    readonly root: readonly string[];
  }>();
  expectTypeOf(summarize(error)).toEqualTypeOf<string>();
});

test("global message configuration returns void", () => {
  expectTypeOf(
    setGlobalMessage((issue) => `${issue.type}: ${issue.expected}`),
  ).toBeVoid();
  expectTypeOf(resetGlobalMessage()).toBeVoid();
});
