import { expect, test } from "vitest";

import { number, schema, schemaAsync, streaming, string } from "../index.js";

const schemaUnchecked = schema as unknown as (
  schema_: unknown,
  ...actions: unknown[]
) => unknown;
const schemaAsyncUnchecked = schemaAsync as unknown as (
  schema_: unknown,
  ...actions: unknown[]
) => unknown;

test("rejects streaming checkpoints on schema kinds without streaming semantics", () => {
  expect(() => schemaUnchecked(number(), streaming())).toThrow(
    "streaming() supports string, object, and array schemas",
  );
  expect(() => schemaAsyncUnchecked(number(), streaming())).toThrow(
    "streaming() supports string, object, and array schemas",
  );
});

test("rejects more than one local streaming checkpoint", () => {
  expect(() => schemaUnchecked(string(), streaming(), streaming())).toThrow(
    "one streaming() checkpoint",
  );
  expect(() =>
    schemaAsyncUnchecked(string(), streaming(), streaming()),
  ).toThrow("one streaming() checkpoint");
});
