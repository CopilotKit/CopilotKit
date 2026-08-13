import { expect, expectTypeOf, test } from "vitest";
import { literal, number, parse, record, string } from "./index.js";

test("record parses every enumerable key and value", () => {
  const schema = record(string(), number());

  const output = parse(schema, { first: 1, second: 2 });

  expect(output).toEqual({ first: 1, second: 2 });
  expectTypeOf(output).toEqualTypeOf<Record<string, number>>();
});

test("record keeps finite literal keys optional in its output type", () => {
  const schema = record(literal("first"), number());

  const output = parse(schema, {});

  expect(output).toEqual({});
  expectTypeOf(output).toEqualTypeOf<Partial<Record<"first", number>>>();
});

test("record preserves __proto__ as an own data property", () => {
  const schema = record(string(), number());
  const input = JSON.parse('{"__proto__":5}') as Record<string, number>;

  const output = parse(schema, input);

  expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
  expect(Object.hasOwn(output, "__proto__")).toBe(true);
  expect(output).toEqual(input);
});
