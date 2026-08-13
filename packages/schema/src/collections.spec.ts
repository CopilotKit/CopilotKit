import { expect, expectTypeOf, test } from "vitest";
import {
  boolean,
  map,
  number,
  objectWithRest,
  parse,
  safeParse,
  set,
  string,
  tupleWithRest,
} from "./index.js";

test("map parses every key and value into a new Map", () => {
  const schema = map(string(), number());

  const output = parse(
    schema,
    new Map<unknown, unknown>([
      ["one", 1],
      ["two", 2],
    ]),
  );

  expect(output).toEqual(
    new Map([
      ["one", 1],
      ["two", 2],
    ]),
  );
  expectTypeOf(output).toEqualTypeOf<Map<string, number>>();
  expect(safeParse(schema, { one: 1 }).success).toBe(false);
});

test("set parses every item into a new Set", () => {
  const schema = set(number());

  const output = parse(schema, new Set([1, 2]));

  expect(output).toEqual(new Set([1, 2]));
  expectTypeOf(output).toEqualTypeOf<Set<number>>();
  expect(safeParse(schema, [1, 2]).success).toBe(false);
});

test("tupleWithRest parses fixed items followed by rest items", () => {
  const schema = tupleWithRest([string(), number()], boolean());

  const output = parse(schema, ["point", 3, true, false]);

  expect(output).toEqual(["point", 3, true, false]);
  expectTypeOf(output).toEqualTypeOf<[string, number, ...boolean[]]>();
  expect(safeParse(schema, ["point", 3, "yes"]).success).toBe(false);
});

test("objectWithRest validates and keeps unknown object entries", () => {
  const schema = objectWithRest({ name: string() }, number());

  const output = parse(schema, { age: 37, name: "Ada" });

  expect(output).toEqual({ age: 37, name: "Ada" });
  expect(output.name).toBe("Ada");
  expect(output.age).toBe(37);
  expect(safeParse(schema, { age: "old", name: "Ada" }).success).toBe(false);
});

test("objectWithRest preserves __proto__ as an own data property", () => {
  const schema = objectWithRest({}, number());
  const input = JSON.parse('{"__proto__":5}') as Record<string, number>;

  const output = parse(schema, input);

  expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
  expect(Object.hasOwn(output, "__proto__")).toBe(true);
  expect(output).toEqual(input);
});
