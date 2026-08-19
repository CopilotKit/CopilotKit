import { expect, test, vi } from "vitest";
import {
  any_,
  array,
  bigint,
  blob,
  boolean,
  coerceBigint,
  coerceBoolean,
  coerceDate,
  coerceNumber,
  coerceString,
  date,
  file,
  literal,
  nan,
  never,
  null_,
  number,
  object,
  objectAsync,
  optional,
  parse,
  parseAsync,
  schema as defineSchema,
  string,
  symbol_,
  trim,
  undefined_,
  union,
  unknown,
  void_,
} from "./index.js";

test("stateless leaf factories reuse one lazily created schema", () => {
  const factories: ReadonlyArray<() => unknown> = [
    any_,
    bigint,
    blob,
    boolean,
    coerceBigint,
    coerceBoolean,
    coerceDate,
    coerceNumber,
    coerceString,
    date,
    file,
    nan,
    never,
    null_,
    number,
    string,
    symbol_,
    undefined_,
    unknown,
    void_,
  ];

  const firstSchemas = factories.map((factory) => factory());
  const secondSchemas = factories.map((factory) => factory());

  expect(secondSchemas).toEqual(firstSchemas);
  for (const [index, schema] of secondSchemas.entries()) {
    expect(schema).toBe(firstSchemas[index]);
  }
  expect(literal("ready")).not.toBe(literal("ready"));
});

test("object defers and caches entry enumeration until parsing", () => {
  const entries = { age: number(), name: string() };
  const originalObjectKeys = Object.keys;
  let entryEnumerations = 0;
  const objectKeys = vi.spyOn(Object, "keys").mockImplementation((value) => {
    if (value === entries) {
      entryEnumerations += 1;
    }
    return originalObjectKeys(value);
  });

  try {
    const schema = object(entries);

    expect(entryEnumerations).toBe(0);

    parse(schema, { age: 37, name: "Ada" });
    parse(schema, { age: 38, name: "Grace" });

    expect(entryEnumerations).toBe(1);
  } finally {
    objectKeys.mockRestore();
  }
});

test("objectAsync defers and caches entry enumeration until parsing", async () => {
  const entries = { age: number(), name: string() };
  const originalObjectKeys = Object.keys;
  let entryEnumerations = 0;
  const objectKeys = vi.spyOn(Object, "keys").mockImplementation((value) => {
    if (value === entries) {
      entryEnumerations += 1;
    }
    return originalObjectKeys(value);
  });

  try {
    const schema = objectAsync(entries);

    expect(entryEnumerations).toBe(0);

    await parseAsync(schema, { age: 37, name: "Ada" });
    await parseAsync(schema, { age: 38, name: "Grace" });

    expect(entryEnumerations).toBe(1);
  } finally {
    objectKeys.mockRestore();
  }
});

test("sync schemas share the lazy Standard Schema accessor", () => {
  const objectSchema = object({ age: number(), name: string() });
  const stringSchema = string();

  const prototype = Object.getPrototypeOf(objectSchema) as object;
  const prototypeDescriptor = Object.getOwnPropertyDescriptor(
    prototype,
    "~standard",
  );
  expect(Object.hasOwn(objectSchema, "~standard")).toBe(false);
  expect(Object.getPrototypeOf(stringSchema)).toBe(prototype);
  expect(prototypeDescriptor?.get).toBeTypeOf("function");
  expect(prototypeDescriptor?.value).toBeUndefined();
});

test("composite metadata never copies the lazy Standard Schema adapter", () => {
  const schemas = [
    array(string()),
    literal("ready"),
    optional(string()),
    defineSchema(string(), trim()),
    union([literal("ready"), number()]),
  ];

  const descriptors = schemas.map(
    (schema) =>
      Object.getOwnPropertyDescriptor(schema, "~standard") ??
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(schema) as object,
        "~standard",
      ),
  );

  for (const descriptor of descriptors) {
    expect(descriptor?.get).toBeTypeOf("function");
    expect(descriptor?.value).toBeUndefined();
  }
});
