import { expect, expectTypeOf, test } from "vitest";
import { safeParse, string } from "./index.js";

test("safeParse returns typed output for valid input", () => {
  const schema = string();

  const result = safeParse(schema, "Ada");

  expect(result).toEqual({
    issues: undefined,
    output: "Ada",
    success: true,
  });
  if (result.success) {
    expectTypeOf(result.output).toEqualTypeOf<string>();
  }
});

test("safeParse returns issues instead of throwing for invalid input", () => {
  const schema = string();

  const result = safeParse(schema, 42);

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.output).toBeUndefined();
    expect(result.issues[0]?.type).toBe("string");
    expectTypeOf(result.output).toEqualTypeOf<undefined>();
  }
});
