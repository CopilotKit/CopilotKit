import { expect, test } from "vitest";
import { array, literal, object, string, tuple, union } from "./index.js";

test("schemas expose their kind, type, and expected input", () => {
  const schema = string();

  expect(schema).toMatchObject({
    async: false,
    expects: "string",
    kind: "schema",
    type: "string",
  });
});

test("object schemas expose their entries for tooling", () => {
  const entries = { name: string() };

  const schema = object(entries);

  expect(schema.entries).toBe(entries);
});

test("array schemas expose their item for tooling", () => {
  const item = string();

  const schema = array(item);

  expect(schema.item).toBe(item);
});

test("literal schemas expose their value for tooling", () => {
  const schema = literal("ready");

  expect(schema.literal).toBe("ready");
});

test("tuple schemas expose their items for tooling", () => {
  const items = [string(), string()] as const;

  const schema = tuple(items);

  expect(schema.items).toBe(items);
});

test("union schemas expose their options for tooling", () => {
  const options = [literal("ready"), literal("pending")] as const;

  const schema = union(options);

  expect(schema.options).toBe(options);
});
