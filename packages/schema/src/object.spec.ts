import { expect, expectTypeOf, test } from "vitest";
import {
  extend,
  keyof_,
  merge,
  number,
  object,
  omit,
  looseObject,
  optional,
  parse,
  partial,
  pick,
  required,
  safeParse,
  string,
  strictObject,
  ValidationError,
} from "./index.js";

test("object parses known entries and strips unknown entries", () => {
  const schema = object({
    age: number(),
    name: string(),
  });

  const output = parse(schema, {
    age: 37,
    extra: true,
    name: "Ada",
  });

  expect(output).toEqual({ age: 37, name: "Ada" });
  expectTypeOf(output).toEqualTypeOf<{ age: number; name: string }>();
});

test("object does not satisfy required entries from the input prototype", () => {
  const schema = object({ name: string() });
  const input = Object.create({ name: "Ada" }) as { name: string };

  const result = safeParse(schema, input);

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.path).toEqual(["name"]);
});

test.each([null, [], "Ada"])("object rejects non-object input %#", (input) => {
  const schema = object({ name: string() });

  const parseInput = () => parse(schema, input);

  expect(parseInput).toThrowError(ValidationError);
  expect(parseInput).toThrowError("Expected object");
});

test("object adds the failing entry key to nested issue paths", () => {
  const schema = object({ name: string() });
  let thrown: unknown;

  try {
    parse(schema, { name: 42 });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ValidationError);
  if (!(thrown instanceof ValidationError)) {
    throw new Error("Expected parse to throw ValidationError");
  }
  expect(thrown.issues[0]?.path).toEqual(["name"]);
});

test("object omits missing optional entries and types them as optional", () => {
  const schema = object({
    name: string(),
    nickname: optional(string()),
  });

  const output = parse(schema, { name: "Ada" });

  expect(output).toEqual({ name: "Ada" });
  expect(Object.hasOwn(output, "nickname")).toBe(false);
  expectTypeOf(output).toEqualTypeOf<{
    name: string;
    nickname?: string;
  }>();
});

test("strictObject rejects entries that are not in its shape", () => {
  const schema = strictObject({ name: string() });

  const output = parse(schema, { name: "Ada" });
  const parseExtra = () => parse(schema, { extra: true, name: "Ada" });

  expect(output).toEqual({ name: "Ada" });
  expect(parseExtra).toThrowError(ValidationError);
  expect(parseExtra).toThrowError('Unexpected key "extra"');
});

test("looseObject parses known entries and keeps unknown entries", () => {
  const schema = looseObject({ name: string() });

  const output = parse(schema, { extra: true, name: "Ada" });

  expect(output).toEqual({ extra: true, name: "Ada" });
  expectTypeOf(output).toEqualTypeOf<
    { name: string } & Record<string, unknown>
  >();
});

test("pick creates an object schema with only the selected entries", () => {
  const source = object({
    age: number(),
    name: string(),
  });
  const schema = pick(source, ["name"]);

  const output = parse(schema, { age: 37, name: "Ada" });

  expect(output).toEqual({ name: "Ada" });
  expectTypeOf(output).toEqualTypeOf<{ name: string }>();
});

test("omit creates an object schema without the selected entries", () => {
  const source = object({
    age: number(),
    name: string(),
  });
  const schema = omit(source, ["age"]);

  const output = parse(schema, { age: 37, name: "Ada" });

  expect(output).toEqual({ name: "Ada" });
  expectTypeOf(output).toEqualTypeOf<{ name: string }>();
});

test("partial makes every object entry optional", () => {
  const source = object({
    age: number(),
    name: string(),
  });
  const schema = partial(source);

  const output = parse(schema, {});

  expect(output).toEqual({});
  expectTypeOf(output).toEqualTypeOf<{
    age?: number;
    name?: string;
  }>();
});

test("required unwraps every optional object entry", () => {
  const source = object({
    name: optional(string()),
  });
  const schema = required(source);

  const output = parse(schema, { name: "Ada" });
  const parseMissing = () => parse(schema, {});

  expect(output).toEqual({ name: "Ada" });
  expectTypeOf(output).toEqualTypeOf<{ name: string }>();
  expect(parseMissing).toThrowError(ValidationError);
});

test("object emits defaults for missing optional entries", () => {
  const schema = object({
    role: optional(string(), "member"),
  });

  const output = parse(schema, {});

  expect(output).toEqual({ role: "member" });
  expectTypeOf(output).toEqualTypeOf<{ role: string }>();
});

test("partial and required can target selected object keys", () => {
  const source = object({
    age: optional(number()),
    name: string(),
    nickname: optional(string()),
    role: string(),
  });
  const partlyOptional = partial(source, ["name"]);
  const partlyRequired = required(source, ["age"]);

  const partialOutput = parse(partlyOptional, { role: "admin" });
  const requiredOutput = parse(partlyRequired, {
    age: 37,
    name: "Ada",
    role: "admin",
  });

  expect(partialOutput).toEqual({ role: "admin" });
  expect(requiredOutput).toEqual({
    age: 37,
    name: "Ada",
    role: "admin",
  });
  expectTypeOf(partialOutput).toEqualTypeOf<{
    age?: number;
    name?: string;
    nickname?: string;
    role: string;
  }>();
  expectTypeOf(requiredOutput).toEqualTypeOf<{
    age: number;
    name: string;
    nickname?: string;
    role: string;
  }>();
});

test("extend and merge build object schemas with replacement entries", () => {
  const base = object({ id: number(), name: string() });
  const extended = extend(base, { active: number(), id: string() });
  const merged = merge(base, object({ id: string() }));

  const extendedOutput = parse(extended, {
    active: 1,
    id: "entity-1",
    name: "Ada",
  });
  const mergedOutput = parse(merged, { id: "entity-1", name: "Ada" });

  expect(extendedOutput).toEqual({
    active: 1,
    id: "entity-1",
    name: "Ada",
  });
  expect(mergedOutput).toEqual({ id: "entity-1", name: "Ada" });
  expectTypeOf(mergedOutput).toEqualTypeOf<{
    id: string;
    name: string;
  }>();
});

test("keyof creates a picklist from object entry keys", () => {
  const schema = keyof_(object({ age: number(), name: string() }));

  const output = parse(schema, "name");

  expect(output).toBe("name");
  expectTypeOf(output).toEqualTypeOf<"age" | "name">();
});
