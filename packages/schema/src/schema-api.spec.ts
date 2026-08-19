import { expect, expectTypeOf, test } from "vitest";
import {
  minLength,
  parse,
  parseAsync,
  schema,
  schemaAsync,
  string,
  transform,
  transformAsync,
} from "./index.js";

test("schema creates a typed schema from ordered actions", () => {
  const username = schema(
    string(),
    minLength(3),
    transform((value: string) => value.toLowerCase()),
  );

  const output = parse(username, "Ada");

  expect(output).toBe("ada");
  expectTypeOf(output).toEqualTypeOf<string>();
});

test("schemaAsync creates a typed schema from ordered async actions", async () => {
  const username = schemaAsync(
    string(),
    transformAsync(async (value: string) => value.toLowerCase()),
  );

  const output = await parseAsync(username, "Ada");

  expect(output).toBe("ada");
  expectTypeOf(output).toEqualTypeOf<string>();
});
