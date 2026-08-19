import { expect, expectTypeOf, test } from "vitest";
import {
  brand,
  endsWith,
  finite,
  includes,
  isoDate,
  length,
  lowercase,
  maxEntries,
  maxSize,
  minEntries,
  minSize,
  multipleOf,
  nonEmpty,
  number,
  object,
  parse,
  schema as defineSchema,
  readonly_,
  safeParse,
  set,
  startsWith,
  string,
  toLowerCase,
  toUpperCase,
  uppercase,
  url,
  uuid,
} from "./index.js";

test("length and nonEmpty validate exact and positive lengths", () => {
  const exact = defineSchema(string(), length(3));
  const present = defineSchema(string(), nonEmpty());

  expect(parse(exact, "Ada")).toBe("Ada");
  expect(parse(present, "A")).toBe("A");
  expect(safeParse(exact, "Grace").success).toBe(false);
  expect(safeParse(present, "").success).toBe(false);
});

test("size checks validate Map and Set sizes", () => {
  const schema = defineSchema(set(number()), minSize(1), maxSize(2));

  expect(parse(schema, new Set([1, 2]))).toEqual(new Set([1, 2]));
  expect(safeParse(schema, new Set()).success).toBe(false);
  expect(safeParse(schema, new Set([1, 2, 3])).success).toBe(false);
});

test("entry checks validate object key counts", () => {
  const schema = defineSchema(
    object({ name: string() }),
    minEntries(1),
    maxEntries(1),
  );

  expect(parse(schema, { name: "Ada" })).toEqual({ name: "Ada" });
});

test("string checks cover boundaries, case, URLs, UUIDs, and dates", () => {
  const slug = defineSchema(
    string(),
    startsWith("user-"),
    endsWith("-active"),
    includes("ada"),
    lowercase(),
  );
  const id = defineSchema(string(), uuid());
  const website = defineSchema(string(), url());
  const birthday = defineSchema(string(), isoDate());

  expect(parse(slug, "user-ada-active")).toBe("user-ada-active");
  expect(parse(id, "550e8400-e29b-41d4-a716-446655440000")).toBe(
    "550e8400-e29b-41d4-a716-446655440000",
  );
  expect(parse(website, "https://example.com")).toBe("https://example.com");
  expect(parse(birthday, "1815-12-10")).toBe("1815-12-10");
  expect(safeParse(birthday, "1815-02-31").success).toBe(false);
});

test("numeric checks require finite multiples", () => {
  const schema = defineSchema(number(), finite(), multipleOf(0.5));

  expect(parse(schema, 1.5)).toBe(1.5);
  expect(safeParse(schema, 1.2).success).toBe(false);
  expect(safeParse(schema, Number.POSITIVE_INFINITY).success).toBe(false);
});

test("case transforms, readonly output, and brands preserve strict types", () => {
  const normalized = defineSchema(
    string(),
    toLowerCase(),
    toUpperCase(),
    uppercase(),
  );
  const branded = defineSchema(string(), brand<"UserId">(), readonly_());

  const normalizedOutput = parse(normalized, "Ada");
  const brandedOutput = parse(branded, "user-1");

  expect(normalizedOutput).toBe("ADA");
  expect(brandedOutput).toBe("user-1");
  expectTypeOf(brandedOutput).toEqualTypeOf<
    string & { readonly __brand: "UserId" }
  >();
});
