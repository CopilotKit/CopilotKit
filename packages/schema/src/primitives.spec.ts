import { expect, expectTypeOf, test } from "vitest";
import {
  boolean,
  bigint,
  date,
  instance,
  literal,
  never,
  null_,
  number,
  parse,
  string,
  undefined_,
  unknown,
  ValidationError,
} from "./index.js";
import type { Schema } from "./index.js";

test("string parses a string without changing its value or type", () => {
  const schema = string();

  const output = parse(schema, "Ada");

  expect(output).toBe("Ada");
  expectTypeOf(output).toEqualTypeOf<string>();
});

test("string rejects non-string input with a structured issue", () => {
  const schema = string();
  let thrown: unknown;

  try {
    parse(schema, 42);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ValidationError);
  if (!(thrown instanceof ValidationError)) {
    throw new Error("Expected parse to throw ValidationError");
  }
  expect(thrown.issues).toEqual([
    {
      expected: "string",
      input: 42,
      message: "Expected string",
      path: [],
      type: "string",
    },
  ]);
});

test("number parses a number without changing its value or type", () => {
  const schema = number();

  const output = parse(schema, 42);

  expect(output).toBe(42);
  expectTypeOf(output).toEqualTypeOf<number>();
});

test("number rejects non-number input", () => {
  const schema = number();

  const parseText = () => parse(schema, "42");

  expect(parseText).toThrowError(ValidationError);
  expect(parseText).toThrowError("Expected number");
});

test("number rejects NaN", () => {
  const schema = number();

  const parseNaN = () => parse(schema, Number.NaN);

  expect(parseNaN).toThrowError(ValidationError);
  expect(parseNaN).toThrowError("Expected number");
});

test("boolean parses a boolean without changing its value or type", () => {
  const schema = boolean();

  const output = parse(schema, true);

  expect(output).toBe(true);
  expectTypeOf(output).toEqualTypeOf<boolean>();
});

test("boolean rejects non-boolean input", () => {
  const schema = boolean();

  const parseNumber = () => parse(schema, 1);

  expect(parseNumber).toThrowError(ValidationError);
  expect(parseNumber).toThrowError("Expected boolean");
});

test("literal accepts only its exact value and preserves its literal type", () => {
  const schema = literal("ready");

  const output = parse(schema, "ready");
  const parseOther = () => parse(schema, "pending");

  expect(output).toBe("ready");
  expectTypeOf(output).toEqualTypeOf<"ready">();
  expect(parseOther).toThrowError(ValidationError);
});

test("bigint accepts only bigint values and preserves its type", () => {
  const schema = bigint();

  const output = parse(schema, 42n);
  const parseNumber = () => parse(schema, 42);

  expect(output).toBe(42n);
  expectTypeOf(output).toEqualTypeOf<bigint>();
  expect(parseNumber).toThrowError(ValidationError);
});

test("date accepts valid Date instances and rejects invalid dates", () => {
  const schema = date();
  const input = new Date("2026-07-23T00:00:00.000Z");

  const output = parse(schema, input);
  const parseInvalid = () => parse(schema, new Date(Number.NaN));

  expect(output).toBe(input);
  expectTypeOf(output).toEqualTypeOf<Date>();
  expect(parseInvalid).toThrowError(ValidationError);
});

test("unknown accepts any input without weakening its output to any", () => {
  const schema = unknown();
  const input = { answer: 42 };

  const output = parse(schema, input);

  expect(output).toBe(input);
  expectTypeOf(output).toEqualTypeOf<unknown>();
});

test("never rejects every input and exposes a never output type", () => {
  const schema = never();

  const parseInput = () => parse(schema, "Ada");

  expect(parseInput).toThrowError(ValidationError);
  expectTypeOf(schema).toMatchTypeOf<Schema<never>>();
});

test("null_ accepts only null", () => {
  const schema = null_();

  const output = parse(schema, null);
  const parseUndefined = () => parse(schema, undefined);

  expect(output).toBeNull();
  expectTypeOf(output).toEqualTypeOf<null>();
  expect(parseUndefined).toThrowError(ValidationError);
});

test("undefined_ accepts only undefined", () => {
  const schema = undefined_();

  const output = parse(schema, undefined);
  const parseNull = () => parse(schema, null);

  expect(output).toBeUndefined();
  expectTypeOf(output).toEqualTypeOf<undefined>();
  expect(parseNull).toThrowError(ValidationError);
});

test("instance accepts only instances of the selected class", () => {
  const schema = instance(URL);
  const input = new URL("https://copilotkit.ai");

  const output = parse(schema, input);
  const parseObject = () => parse(schema, { href: input.href });

  expect(output).toBe(input);
  expectTypeOf(output).toEqualTypeOf<URL>();
  expect(parseObject).toThrowError(ValidationError);
});
