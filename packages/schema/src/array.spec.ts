import { expect, expectTypeOf, test } from "vitest";
import { array, parse, string, ValidationError } from "./index.js";

test("array parses every item without changing its value or type", () => {
  const schema = array(string());

  const output = parse(schema, ["Ada", "Grace"]);

  expect(output).toEqual(["Ada", "Grace"]);
  expectTypeOf(output).toEqualTypeOf<string[]>();
});

test("array rejects non-array input", () => {
  const schema = array(string());

  const parseObject = () => parse(schema, { 0: "Ada" });

  expect(parseObject).toThrowError(ValidationError);
  expect(parseObject).toThrowError("Expected array");
});

test("array adds the failing item index to nested issue paths", () => {
  const schema = array(string());
  let thrown: unknown;

  try {
    parse(schema, ["Ada", 42]);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ValidationError);
  if (!(thrown instanceof ValidationError)) {
    throw new Error("Expected parse to throw ValidationError");
  }
  expect(thrown.issues[0]?.path).toEqual([1]);
});
