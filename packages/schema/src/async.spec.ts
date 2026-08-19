import { expect, expectTypeOf, test } from "vitest";
import {
  checkAsync,
  parseAsync,
  schemaAsync as defineSchemaAsync,
  safeParseAsync,
  number,
  string,
  transform,
  transformAsync,
  ValidationError,
} from "./index.js";

test("schemaAsync awaits transformations and infers the final output", async () => {
  const schema = defineSchemaAsync(
    string(),
    transform((input: string) => input.trim()),
    transformAsync(async (input: string) => input.length),
  );

  const output = await parseAsync(schema, "  Ada  ");

  expect(output).toBe(3);
  expectTypeOf(output).toEqualTypeOf<number>();
});

test("safeParseAsync returns validation issues without throwing", async () => {
  const schema = defineSchemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );

  const result = await safeParseAsync(schema, 42);

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.expected).toBe("string");
});

test("async schemas expose an asynchronous Standard Schema validator", async () => {
  const schema = defineSchemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );

  const result = await schema["~standard"].validate("Ada");

  expect(result).toEqual({ value: 3 });
});

test("checkAsync keeps valid values and reports rejected values", async () => {
  const schema = defineSchemaAsync(
    string(),
    checkAsync(
      async (input: string) => input.startsWith("A"),
      "Expected a name starting with A",
    ),
  );

  const output = await parseAsync(schema, "Ada");
  const result = await safeParseAsync(schema, "Grace");

  expect(output).toBe("Ada");
  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.message).toBe("Expected a name starting with A");
});

test("parseAsync converts sync validation failures into promise rejections", async () => {
  const promise = parseAsync(string(), 42);

  expect(promise).toBeInstanceOf(Promise);
  await expect(promise).rejects.toBeInstanceOf(ValidationError);
});

test("single async actions convert base failures into promise rejections", async () => {
  const schema = defineSchemaAsync(
    string(),
    transformAsync(async (input: string) => input.length),
  );

  const promise = parseAsync(schema, 42);

  expect(promise).toBeInstanceOf(Promise);
  await expect(promise).rejects.toBeInstanceOf(ValidationError);
});

test("single async actions still validate optimized primitive bases", async () => {
  const schema = defineSchemaAsync(
    number(),
    transformAsync(async (input: number) => input * 2),
  );

  const promise = parseAsync(schema, Number.NaN);

  await expect(promise).rejects.toBeInstanceOf(ValidationError);
});

test("schemaAsync accumulates validation issues before a transformation", async () => {
  const schema = defineSchemaAsync(
    string(),
    checkAsync(
      async (input: string) => input.length >= 3,
      "Expected at least 3 characters",
    ),
    checkAsync(
      async (input: string) => /[A-Z]/.test(input),
      "Expected an uppercase character",
    ),
    transformAsync(async (input: string) => input.trim()),
  );

  const result = await safeParseAsync(schema, "a");

  expect(result.success).toBe(false);
  expect(result.issues?.map((issue) => issue.message)).toEqual([
    "Expected at least 3 characters",
    "Expected an uppercase character",
  ]);
});
