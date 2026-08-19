import { expect, expectTypeOf, test } from "vitest";
import {
  literal,
  number,
  object,
  parse,
  safeParse,
  string,
  union,
  variant,
} from "./index.js";

test("union returns the output of its first matching option", () => {
  const schema = union([literal("ready"), literal(200)]);

  const text = parse(schema, "ready");
  const number = parse(schema, 200);

  expect(text).toBe("ready");
  expect(number).toBe(200);
  expectTypeOf(text).toEqualTypeOf<"ready" | 200>();
  expectTypeOf(number).toEqualTypeOf<"ready" | 200>();
});

test("union failures report the union expectation", () => {
  const schema = union([literal("ready"), number()]);

  const result = safeParse(schema, false);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues[0]?.message).toBe("Expected union");
  }
});

test("variant selects an object schema by its discriminator", () => {
  const schema = variant("type", [
    object({ message: string(), type: literal("text") }),
    object({ count: number(), type: literal("count") }),
  ]);

  const text = parse(schema, { message: "hello", type: "text" });
  const count = parse(schema, { count: 3, type: "count" });

  expect(text).toEqual({ message: "hello", type: "text" });
  expect(count).toEqual({ count: 3, type: "count" });
  expectTypeOf(text).toEqualTypeOf<
    { message: string; type: "text" } | { count: number; type: "count" }
  >();
  expect(safeParse(schema, { message: "hello", type: "unknown" }).success).toBe(
    false,
  );
});
