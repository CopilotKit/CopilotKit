import { expect, expectTypeOf, test } from "vitest";
import {
  array,
  assert,
  flatten,
  is,
  number,
  object,
  parser,
  safeParser,
  safeParse,
  setGlobalMessage,
  string,
  summarize,
  union,
  resetGlobalMessage,
  ValidationError,
} from "./index.js";

test("parser and safeParser create reusable parsing functions", () => {
  const parseName = parser(string());
  const parseNumber = safeParser(number());

  const name = parseName("Ada");
  const result = parseNumber("42");

  expect(name).toBe("Ada");
  expectTypeOf(name).toEqualTypeOf<string>();
  expect(result.success).toBe(false);
});

test("is and assert narrow unknown values with schema input types", () => {
  const value: unknown = "Ada";

  if (!is(string(), value)) {
    throw new Error("Expected a string");
  }
  assert(string(), value);

  expectTypeOf(value).toEqualTypeOf<string>();
  expect(value).toBe("Ada");
});

test("flatten and summarize make nested validation errors readable", () => {
  const schema = object({ names: array(string()) });
  let error: ValidationError | undefined;

  try {
    parser(schema)({ names: ["Ada", 42] });
  } catch (cause) {
    if (cause instanceof ValidationError) {
      error = cause;
    }
  }
  if (!error) {
    throw new Error("Expected a ValidationError");
  }

  expect(flatten(error)).toEqual({
    nested: { "names.1": ["Expected string"] },
    root: [],
  });
  expect(summarize(error)).toBe("names.1: Expected string");
});

test("object parsing reports every invalid sibling entry", () => {
  const schema = object({ age: number(), name: string() });

  const result = safeParse(schema, { age: "old", name: 42 });

  expect(result.success).toBe(false);
  expect(result.issues).toHaveLength(2);
  expect(result.issues?.map((issue) => issue.path)).toEqual([
    ["age"],
    ["name"],
  ]);
});

test("abortEarly returns only the first collected issue", () => {
  const schema = object({ age: number(), name: string() });

  const result = safeParse(
    schema,
    { age: "old", name: 42 },
    { abortEarly: true },
  );

  expect(result.success).toBe(false);
  expect(result.issues).toHaveLength(1);
  expect(result.issues?.[0]?.path).toEqual(["age"]);
});

test("union errors retain issues from every failed option", () => {
  const schema = union([string(), number()]);

  const result = safeParse(schema, false);

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.type).toBe("union");
  expect(result.issues?.[0]?.issues).toHaveLength(2);
});

test("global messages can localize primitive validation failures", () => {
  setGlobalMessage(
    (issue) => `Expected ${issue.expected}; received ${typeof issue.input}`,
  );

  const result = safeParse(string(), 42);
  resetGlobalMessage();

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.message).toBe("Expected string; received number");
});
