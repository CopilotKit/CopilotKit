import { expect, expectTypeOf, test } from "vitest";
import {
  arrayAsync,
  checkAsync,
  codecAsync,
  decodeAsync,
  encodeAsync,
  functionAsync,
  fallbackAsync,
  exactOptionalAsync,
  intersectAsync,
  lazyAsync,
  literal,
  looseObjectAsync,
  mapAsync,
  nonNullableAsync,
  nonNullishAsync,
  nonOptionalAsync,
  nullableAsync,
  nullishAsync,
  number,
  objectAsync,
  objectWithRestAsync,
  optionalAsync,
  partialAsync,
  parseAsync,
  schemaAsync as defineSchemaAsync,
  safeParseAsync,
  setAsync,
  strictObjectAsync,
  string,
  transformAsync,
  tupleAsync,
  tupleWithRestAsync,
  undefinedableAsync,
  unionAsync,
  variantAsync,
  recordAsync,
  requiredAsync,
} from "./index.js";
import type { AsyncSchema } from "./index.js";

test("objectAsync and arrayAsync await nested async schemas", async () => {
  const positive = defineSchemaAsync(
    number(),
    checkAsync(async (input: number) => input > 0),
  );
  const schema = objectAsync({
    name: optionalAsync(string(), "anonymous"),
    scores: arrayAsync(positive),
  });

  const output = await parseAsync(schema, { scores: [1, 2] });
  const result = await safeParseAsync(schema, {
    scores: [1, -1],
  });

  expect(output).toEqual({ name: "anonymous", scores: [1, 2] });
  expectTypeOf(output).toEqualTypeOf<{
    name: string;
    scores: number[];
  }>();
  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.path).toEqual(["scores", 1]);
});

test("unionAsync returns the first matching sync or async option", async () => {
  const numericText = defineSchemaAsync(
    string(),
    transformAsync(async (input: string) => Number(input)),
    checkAsync(async (input: number) => Number.isFinite(input)),
  );
  const schema = unionAsync([numericText, number()]);

  const fromText = await parseAsync(schema, "42");
  const fromNumber = await parseAsync(schema, 42);

  expect(fromText).toBe(42);
  expect(fromNumber).toBe(42);
  expectTypeOf(fromText).toEqualTypeOf<number>();
});

test("variantAsync dispatches an async object union by a literal key", async () => {
  const schema = variantAsync("type", [
    objectAsync({ message: string(), type: literal("text") }),
    objectAsync({ count: number(), type: literal("count") }),
  ]);

  const output = await parseAsync(schema, {
    message: "hello",
    type: "text",
  });

  expect(output).toEqual({ message: "hello", type: "text" });
});

test("functionAsync validates async arguments and results", async () => {
  const schema = functionAsync(
    [string()],
    defineSchemaAsync(
      string(),
      transformAsync(async (input: string) => input.toUpperCase()),
    ),
  );
  const greet = await parseAsync(
    schema,
    async (name: string) => `hello ${name}`,
  );

  const output = await greet("Ada");

  expect(output).toBe("HELLO ADA");
});

test("codecAsync decodes and encodes in both directions", async () => {
  const numericText = codecAsync(
    string(),
    number(),
    async (input) => Number(input),
    async (output) => String(output),
  );

  const decoded = await decodeAsync(numericText, "42");
  const encoded = await encodeAsync(numericText, 42);

  expect(decoded).toBe(42);
  expect(encoded).toBe("42");
  expectTypeOf(decoded).toEqualTypeOf<number>();
  expectTypeOf(encoded).toEqualTypeOf<string>();
});

test("async collection and presence wrappers await nested schemas", async () => {
  const positive = defineSchemaAsync(
    number(),
    checkAsync(async (input: number) => input > 0),
  );
  const mapped = mapAsync(string(), positive);
  const unique = setAsync(positive);
  const nullable = nullableAsync(positive);
  const nullish = nullishAsync(positive);
  const caught = fallbackAsync(positive, 1);

  expect(await parseAsync(mapped, new Map([["score", 2]]))).toEqual(
    new Map([["score", 2]]),
  );
  expect(await parseAsync(unique, new Set([1, 2]))).toEqual(new Set([1, 2]));
  expect(await parseAsync(nullable, null)).toBeNull();
  expect(await parseAsync(nullish, undefined)).toBeUndefined();
  expect(await parseAsync(caught, -1)).toBe(1);
});

test("async object modes, records, and rest tuples preserve their policies", async () => {
  const strict = strictObjectAsync({ name: string() });
  const loose = looseObjectAsync({ name: string() });
  const withRest = objectWithRestAsync({ name: string() }, number());
  const dictionary = recordAsync(string(), number());
  const restTuple = tupleWithRestAsync([string()], number());

  expect(
    await safeParseAsync(strict, { extra: true, name: "Ada" }),
  ).toMatchObject({ success: false });
  expect(await parseAsync(loose, { extra: true, name: "Ada" })).toEqual({
    extra: true,
    name: "Ada",
  });
  expect(await parseAsync(withRest, { age: 37, name: "Ada" })).toEqual({
    age: 37,
    name: "Ada",
  });
  expect(await parseAsync(dictionary, { one: 1 })).toEqual({ one: 1 });
  expect(await parseAsync(restTuple, ["point", 3, 4])).toEqual(["point", 3, 4]);
});

test("recordAsync preserves __proto__ as an own data property", async () => {
  const schema = recordAsync(string(), number());
  const input = JSON.parse('{"__proto__":5}') as Record<string, number>;

  const output = await parseAsync(schema, input);

  expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
  expect(Object.hasOwn(output, "__proto__")).toBe(true);
  expect(output).toEqual(input);
});

test("objectWithRestAsync preserves __proto__ as an own data property", async () => {
  const schema = objectWithRestAsync({}, number());
  const input = JSON.parse('{"__proto__":5}') as Record<string, number>;

  const output = await parseAsync(schema, input);

  expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
  expect(Object.hasOwn(output, "__proto__")).toBe(true);
  expect(output).toEqual(input);
});

test("objectAsync does not satisfy required entries from the input prototype", async () => {
  const schema = objectAsync({ name: string() });
  const input = Object.create({ name: "Ada" }) as { name: string };

  const result = await safeParseAsync(schema, input);

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.path).toEqual(["name"]);
});

test("objectAsync accumulates sibling entry issues", async () => {
  const schema = objectAsync({ age: number(), name: string() });

  const result = await safeParseAsync(schema, { age: "old", name: 42 });

  expect(result.success).toBe(false);
  expect(result.issues?.map((issue) => issue.path)).toEqual([
    ["age"],
    ["name"],
  ]);
});

test("arrayAsync accumulates sibling item issues", async () => {
  const schema = arrayAsync(number());

  const result = await safeParseAsync(schema, ["one", "two"]);

  expect(result.success).toBe(false);
  expect(result.issues?.map((issue) => issue.path)).toEqual([[0], [1]]);
});

test("tupleAsync accumulates sibling item issues", async () => {
  const schema = tupleAsync([number(), string()]);

  const result = await safeParseAsync(schema, ["one", 2]);

  expect(result.success).toBe(false);
  expect(result.issues?.map((issue) => issue.path)).toEqual([[0], [1]]);
});

test("async recursion, intersections, and object utilities compose", async () => {
  interface Node {
    readonly child?: Node;
    readonly value: string;
  }
  const node: AsyncSchema<Node> = lazyAsync(() =>
    objectAsync({
      child: exactOptionalAsync(node),
      value: string(),
    }),
  );
  const combined = intersectAsync([
    objectAsync({ name: string() }),
    objectAsync({ age: number() }),
  ]);
  const source = objectAsync({
    age: optionalAsync(number()),
    name: string(),
  });
  const partial = partialAsync(source);
  const required = requiredAsync(source);

  expect(
    await parseAsync(node, {
      child: { value: "child" },
      value: "root",
    }),
  ).toEqual({ child: { value: "child" }, value: "root" });
  expect(await parseAsync(combined, { age: 37, name: "Ada" })).toEqual({
    age: 37,
    name: "Ada",
  });
  expect(await parseAsync(partial, {})).toEqual({});
  expect(await safeParseAsync(required, { name: "Ada" })).toMatchObject({
    success: false,
  });
  expect(await parseAsync(undefinedableAsync(string()), undefined)).toBe(
    undefined,
  );
  expect(
    await safeParseAsync(nonOptionalAsync(optionalAsync(string())), undefined),
  ).toMatchObject({ success: false });
  expect(
    await safeParseAsync(nonNullableAsync(nullableAsync(string())), null),
  ).toMatchObject({ success: false });
  expect(
    await safeParseAsync(nonNullishAsync(nullishAsync(string())), null),
  ).toMatchObject({ success: false });
});

test("intersectAsync merges equal array outputs item by item", async () => {
  const schema = intersectAsync([arrayAsync(number()), arrayAsync(number())]);

  const output = await parseAsync(schema, [1, 2]);

  expect(output).toEqual([1, 2]);
});
