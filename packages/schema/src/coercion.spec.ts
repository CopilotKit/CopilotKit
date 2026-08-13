import { expect, expectTypeOf, test } from "vitest";
import {
  coerceBigint,
  coerceBoolean,
  coerceDate,
  coerceNumber,
  coerceString,
  number,
  parse,
  preprocess,
  safeParse,
} from "./index.js";

test("coercion schemas convert JavaScript primitive inputs explicitly", () => {
  const text = parse(coerceString(), 42);
  const count = parse(coerceNumber(), "42");
  const active = parse(coerceBoolean(), 1);
  const amount = parse(coerceBigint(), "42");
  const date = parse(coerceDate(), "2024-01-02T03:04:05.000Z");

  expect(text).toBe("42");
  expect(count).toBe(42);
  expect(active).toBe(true);
  expect(amount).toBe(42n);
  expect(date).toEqual(new Date("2024-01-02T03:04:05.000Z"));
  expectTypeOf(count).toEqualTypeOf<number>();
  expect(safeParse(coerceNumber(), "not-a-number").success).toBe(false);
  expect(safeParse(coerceDate(), "not-a-date").success).toBe(false);
});

test("preprocess converts unknown input before strict schema validation", () => {
  const schema = preprocess(
    (input) => (typeof input === "string" ? Number(input) : input),
    number(),
  );

  const output = parse(schema, "42");

  expect(output).toBe(42);
  expectTypeOf(output).toEqualTypeOf<number>();
  expect(safeParse(schema, "nope").success).toBe(false);
});

test("safeParse returns a failure when number coercion throws", () => {
  const result = safeParse(coerceNumber(), Symbol("count"));

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.type).toBe("coerce_number");
});

test("safeParse returns a failure when date coercion throws", () => {
  const result = safeParse(coerceDate(), Symbol("date"));

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.type).toBe("coerce_date");
});
