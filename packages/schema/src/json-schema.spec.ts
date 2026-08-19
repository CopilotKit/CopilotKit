import { expect, test } from "vitest";
import {
  array,
  fromJSONSchema,
  gtValue,
  integer,
  intersect,
  lazy,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  multipleOf,
  number,
  nullable,
  object,
  optional,
  picklist,
  parse,
  schema as defineSchema,
  record,
  regex,
  set,
  string,
  ltValue,
  tupleWithRest,
  undefinedable,
  title,
  toJSONSchema,
} from "./index.js";
import type { Schema } from "./index.js";

test("toJSONSchema converts nested typed schemas and metadata", () => {
  const schema = title(
    object({
      age: optional(number()),
      name: string(),
      status: literal("active"),
      tags: array(string()),
    }),
    "User",
  );

  const jsonSchema = toJSONSchema(schema);

  expect(jsonSchema).toEqual({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    properties: {
      age: { type: "number" },
      name: { type: "string" },
      status: { const: "active" },
      tags: { items: { type: "string" }, type: "array" },
    },
    required: ["name", "status", "tags"],
    title: "User",
    type: "object",
  });
});

test("toJSONSchema preserves schema actions, records, sets, and intersections", () => {
  const schema = intersect([
    object({
      code: defineSchema(
        string(),
        minLength(2),
        maxLength(4),
        regex(/^[A-Z]+$/),
      ),
    }),
    object({
      labels: record(string(), number()),
      tags: set(string()),
    }),
  ]);

  const jsonSchema = toJSONSchema(schema);

  expect(jsonSchema).toMatchObject({
    allOf: [
      {
        properties: {
          code: {
            maxLength: 4,
            minLength: 2,
            pattern: "^[A-Z]+$",
            type: "string",
          },
        },
      },
      {
        properties: {
          labels: {
            additionalProperties: { type: "number" },
            type: "object",
          },
          tags: {
            items: { type: "string" },
            type: "array",
            uniqueItems: true,
          },
        },
      },
    ],
  });
});

test("toJSONSchema preserves minimum and integer actions", () => {
  const schema = defineSchema(number(), minValue(5), integer());

  const jsonSchema = toJSONSchema(schema);

  expect(jsonSchema).toMatchObject({
    minimum: 5,
    type: "integer",
  });
});

test("toJSONSchema preserves numeric bounds and multiples", () => {
  const schema = defineSchema(
    number(),
    gtValue(0),
    ltValue(10),
    minValue(1),
    maxValue(9),
    multipleOf(0.5),
  );

  const jsonSchema = toJSONSchema(schema);

  expect(jsonSchema).toMatchObject({
    exclusiveMaximum: 10,
    exclusiveMinimum: 0,
    maximum: 9,
    minimum: 1,
    multipleOf: 0.5,
    type: "number",
  });
});

test("toJSONSchema rejects regex flags that JSON Schema cannot represent", () => {
  const schema = defineSchema(string(), regex(/^[a-z]+$/i));

  const convert = () => toJSONSchema(schema);

  expect(convert).toThrowError(
    "JSON Schema patterns cannot represent regular expression flags",
  );
});

test("fromJSONSchema imports common JSON Schema object trees", () => {
  const schema = fromJSONSchema({
    additionalProperties: false,
    properties: {
      age: { minimum: 0, type: "number" },
      name: { minLength: 1, type: "string" },
    },
    required: ["name"],
    type: "object",
  });

  const output = parse(schema, { age: 37, name: "Ada" });

  expect(output).toEqual({ age: 37, name: "Ada" });
  expect(() => parse(schema, { age: -1, name: "Ada" })).toThrow();
  expect(() => parse(schema, { extra: true, name: "Ada" })).toThrow();
});

test("fromJSONSchema accepts floating-point multiples within numeric tolerance", () => {
  const schema = fromJSONSchema({ multipleOf: 0.1, type: "number" });

  const output = parse(schema, 0.3);

  expect(output).toBe(0.3);
});

test("toJSONSchema emits OpenAPI 3.0 nullable schemas on request", () => {
  const jsonSchema = toJSONSchema(nullable(string()), {
    target: "openapi-3.0",
  });

  expect(jsonSchema).toEqual({
    nullable: true,
    type: "string",
  });
});

test("toJSONSchema exports presence, picklist, and rest tuple schemas", () => {
  const schema = object({
    status: picklist(["draft", "published"]),
    values: tupleWithRest([string()], number()),
    note: undefinedable(string()),
  });

  const jsonSchema = toJSONSchema(schema);

  expect(jsonSchema).toMatchObject({
    properties: {
      note: { type: "string" },
      status: {
        anyOf: [{ const: "draft" }, { const: "published" }],
      },
      values: {
        items: { type: "number" },
        minItems: 1,
        prefixItems: [{ type: "string" }],
        type: "array",
      },
    },
  });
});

interface Category {
  readonly children: Category[];
  readonly name: string;
}

test("toJSONSchema emits definitions for recursive lazy schemas", () => {
  const category: Schema<Category> = lazy(() =>
    object({
      children: array(category),
      name: string(),
    }),
  );

  const jsonSchema = toJSONSchema(category);

  expect(jsonSchema).toEqual({
    $defs: {
      schema0: {
        properties: {
          children: {
            items: { $ref: "#/$defs/schema0" },
            type: "array",
          },
          name: { type: "string" },
        },
        required: ["children", "name"],
        type: "object",
      },
    },
    $ref: "#/$defs/schema0",
    $schema: "https://json-schema.org/draft/2020-12/schema",
  });
});
