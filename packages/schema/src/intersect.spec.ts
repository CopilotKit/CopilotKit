import { expect, expectTypeOf, test } from "vitest";
import {
  array,
  instance,
  intersect,
  number,
  object,
  parse,
  string,
} from "./index.js";

test("intersect requires every option and merges object outputs", () => {
  const schema = intersect([
    object({ name: string() }),
    object({ age: number() }),
  ]);

  const output = parse(schema, { age: 37, name: "Ada" });

  expect(output).toEqual({ age: 37, name: "Ada" });
  expectTypeOf(output).toEqualTypeOf<{ name: string } & { age: number }>();
});

test("intersect merges equal array outputs item by item", () => {
  const schema = intersect([array(number()), array(number())]);

  const output = parse(schema, [1, 2]);

  expect(output).toEqual([1, 2]);
});

test("intersect preserves a shared class instance output", () => {
  class Entity {}
  const entity = new Entity();
  const schema = intersect([instance(Entity), instance(Entity)]);

  const output = parse(schema, entity);

  expect(output).toBe(entity);
});
