import { expect, expectTypeOf, test } from "vitest";
import {
  literal,
  number,
  parse,
  safeParse,
  string,
  tuple,
  ValidationError,
} from "./index.js";

test("tuple parses fixed items and infers their positions", () => {
  const schema = tuple([literal("point"), number(), number()]);

  const output = parse(schema, ["point", 3, 4]);

  expect(output).toEqual(["point", 3, 4]);
  expectTypeOf(output).toEqualTypeOf<["point", number, number]>();
});

test("tuple rejects the wrong length", () => {
  const schema = tuple([string(), number()]);

  const parseShort = () => parse(schema, ["Ada"]);

  expect(parseShort).toThrowError(ValidationError);
  expect(parseShort).toThrowError("Expected tuple with 2 items");
});

test("tuple accumulates sibling item issues", () => {
  const schema = tuple([number(), string()]);

  const result = safeParse(schema, ["one", 2]);

  expect(result.success).toBe(false);
  expect(result.issues?.map((issue) => issue.path)).toEqual([[0], [1]]);
});
