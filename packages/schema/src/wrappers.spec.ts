import { expect, expectTypeOf, test } from "vitest";
import {
  exactOptional,
  fallback,
  nonNullable,
  nonNullish,
  nonOptional,
  nullable,
  nullish,
  object,
  optional,
  parse,
  safeParse,
  string,
  undefinedable,
} from "./index.js";

test("optional accepts undefined without running its wrapped schema", () => {
  const schema = optional(string());

  const output = parse(schema, undefined);

  expect(output).toBeUndefined();
  expectTypeOf(output).toEqualTypeOf<string | undefined>();
});

test("nullable accepts null and preserves its wrapped output type", () => {
  const schema = nullable(string());

  const nullOutput = parse(schema, null);
  const stringOutput = parse(schema, "Ada");

  expect(nullOutput).toBeNull();
  expect(stringOutput).toBe("Ada");
  expectTypeOf(nullOutput).toEqualTypeOf<string | null>();
  expectTypeOf(stringOutput).toEqualTypeOf<string | null>();
});

test("nullish accepts null and undefined as well as its wrapped type", () => {
  const schema = nullish(string());

  const nullOutput = parse(schema, null);
  const undefinedOutput = parse(schema, undefined);
  const stringOutput = parse(schema, "Ada");

  expect([nullOutput, undefinedOutput, stringOutput]).toEqual([
    null,
    undefined,
    "Ada",
  ]);
  expectTypeOf(stringOutput).toEqualTypeOf<string | null | undefined>();
});

test("fallback returns a typed value when its schema rejects input", () => {
  const schema = fallback(string(), "unknown");

  const valid = parse(schema, "Ada");
  const invalid = parse(schema, 42);

  expect(valid).toBe("Ada");
  expect(invalid).toBe("unknown");
  expectTypeOf(invalid).toEqualTypeOf<string>();
});

test("optional replaces undefined with a typed default", () => {
  const schema = optional(string(), "anonymous");

  const output = parse(schema, undefined);

  expect(output).toBe("anonymous");
  expectTypeOf(output).toEqualTypeOf<string>();
});

test("exactOptional permits a missing object key but rejects explicit undefined", () => {
  const schema = object({ name: exactOptional(string()) });

  const missing = parse(schema, {});
  const result = safeParse(schema, { name: undefined });

  expect(missing).toEqual({});
  expect(result.success).toBe(false);
});

test("undefinedable accepts an explicit undefined value", () => {
  const schema = undefinedable(string());

  const output = parse(schema, undefined);

  expect(output).toBeUndefined();
  expectTypeOf(output).toEqualTypeOf<string | undefined>();
});

test("non-presence wrappers reject nullish outputs from wrapped schemas", () => {
  const required = nonOptional(optional(string()));
  const nonNull = nonNullable(nullable(string()));
  const present = nonNullish(nullish(string()));

  expect(parse(required, "Ada")).toBe("Ada");
  expect(parse(nonNull, "Ada")).toBe("Ada");
  expect(parse(present, "Ada")).toBe("Ada");
  expect(safeParse(required, undefined).success).toBe(false);
  expect(safeParse(nonNull, null).success).toBe(false);
  expect(safeParse(present, null).success).toBe(false);
  expect(safeParse(present, undefined).success).toBe(false);
});
