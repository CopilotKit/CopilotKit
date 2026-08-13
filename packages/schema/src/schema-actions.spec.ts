import { expect, expectTypeOf, test } from "vitest";
import {
  check,
  email,
  integer,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  parse,
  safeParse,
  schema as defineSchema,
  regex,
  string,
  trim,
  transform,
  ValidationError,
} from "./index.js";

test("schema runs transformations in order and infers the final output", () => {
  const schema = defineSchema(
    string(),
    transform((input: string) => input.trim()),
    transform((input: string) => input.length),
  );

  const output = parse(schema, "  Ada  ");

  expect(output).toBe(3);
  expectTypeOf(output).toEqualTypeOf<number>();
});

test("schema rejects actions that cannot accept the prior output type", () => {
  const base = string();
  const numberAction = transform((input: number) => input + 1);

  // @ts-expect-error A number action cannot consume a string schema output.
  const schema = defineSchema(base, numberAction);

  expect(schema).toBeDefined();
});

test("check keeps valid values and rejects values that fail its requirement", () => {
  const schema = defineSchema(
    number(),
    check((input: number) => input > 0, "Expected a positive number"),
  );

  const output = parse(schema, 1);
  const parseNegative = () => parse(schema, -1);

  expect(output).toBe(1);
  expectTypeOf(output).toEqualTypeOf<number>();
  expect(parseNegative).toThrowError(ValidationError);
  expect(parseNegative).toThrowError("Expected a positive number");
});

test("minLength validates length without widening the schema output type", () => {
  const schema = defineSchema(
    string(),
    minLength(3, "Expected at least 3 characters"),
  );

  const output = parse(schema, "Ada");
  const parseShort = () => parse(schema, "Al");

  expect(output).toBe("Ada");
  expectTypeOf(output).toEqualTypeOf<string>();
  expect(parseShort).toThrowError(ValidationError);
  expect(parseShort).toThrowError("Expected at least 3 characters");
});

test("trim removes leading and trailing whitespace", () => {
  const schema = defineSchema(string(), trim());

  const output = parse(schema, "  Ada  ");

  expect(output).toBe("Ada");
  expectTypeOf(output).toEqualTypeOf<string>();
});

test("regex keeps matching strings and rejects non-matches", () => {
  const schema = defineSchema(string(), regex(/^[A-Z][a-z]+$/));

  const output = parse(schema, "Ada");
  const parseLowercase = () => parse(schema, "ada");

  expect(output).toBe("Ada");
  expectTypeOf(output).toEqualTypeOf<string>();
  expect(parseLowercase).toThrowError(ValidationError);
});

test("email validates common email addresses", () => {
  const schema = defineSchema(string(), email());

  const output = parse(schema, "ada@example.com");
  const parseInvalid = () => parse(schema, "ada@localhost");

  expect(output).toBe("ada@example.com");
  expect(parseInvalid).toThrowError(ValidationError);
});

test("integer keeps integers and rejects fractions", () => {
  const schema = defineSchema(number(), integer());

  const output = parse(schema, 42);
  const parseFraction = () => parse(schema, 4.2);

  expect(output).toBe(42);
  expectTypeOf(output).toEqualTypeOf<number>();
  expect(parseFraction).toThrowError(ValidationError);
});

test("minValue rejects values below its requirement", () => {
  const schema = defineSchema(number(), minValue(18));

  const output = parse(schema, 37);
  const parseYoung = () => parse(schema, 17);

  expect(output).toBe(37);
  expectTypeOf(output).toEqualTypeOf<number>();
  expect(parseYoung).toThrowError(ValidationError);
});

test("maxValue rejects values above its requirement", () => {
  const schema = defineSchema(number(), maxValue(120));

  const output = parse(schema, 37);
  const parseOld = () => parse(schema, 121);

  expect(output).toBe(37);
  expectTypeOf(output).toEqualTypeOf<number>();
  expect(parseOld).toThrowError(ValidationError);
});

test("maxLength rejects strings and collections above its requirement", () => {
  const schema = defineSchema(string(), maxLength(3));

  const output = parse(schema, "Ada");
  const parseLong = () => parse(schema, "Grace");

  expect(output).toBe("Ada");
  expectTypeOf(output).toEqualTypeOf<string>();
  expect(parseLong).toThrowError(ValidationError);
});

test("schema accumulates validation issues before a transformation", () => {
  const schema = defineSchema(
    string(),
    minLength(3, "Expected at least 3 characters"),
    regex(/[A-Z]/, "Expected an uppercase character"),
    trim(),
  );

  const result = safeParse(schema, "a");

  expect(result.success).toBe(false);
  expect(result.issues?.map((issue) => issue.message)).toEqual([
    "Expected at least 3 characters",
    "Expected an uppercase character",
  ]);
});
