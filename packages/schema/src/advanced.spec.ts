import { expect, expectTypeOf, test } from "vitest";
import {
  codec,
  date,
  decode,
  encode,
  function_,
  number,
  parse,
  promise,
  safeParse,
  string,
} from "./index.js";

test("function validates arguments and return values on each call", () => {
  const schema = function_([string(), number()], string());
  const greet = parse(schema, (name: string, count: number) =>
    name.repeat(count),
  );

  const output = greet("Ada", 2);

  expect(output).toBe("AdaAda");
  expectTypeOf(output).toEqualTypeOf<string>();
  expect(() => greet("Ada", Number.NaN)).toThrow("Expected number");
  expect(() => greet(42 as never, 2)).toThrow();
});

test("promise validates a resolved value", async () => {
  const schema = promise(number());

  const output = await parse(schema, Promise.resolve(42));

  expect(output).toBe(42);
  expectTypeOf(output).toEqualTypeOf<number>();
  await expect(parse(schema, Promise.resolve("42"))).rejects.toThrow(
    "Expected number",
  );
  expect(safeParse(schema, 42).success).toBe(false);
});

test("codec decodes and encodes through schemas in both directions", () => {
  const isoDate = codec(
    string(),
    date(),
    (input) => new Date(input),
    (output) => output.toISOString(),
  );

  const decoded = decode(isoDate, "2024-01-02T03:04:05.000Z");
  const encoded = encode(isoDate, decoded);

  expect(decoded).toEqual(new Date("2024-01-02T03:04:05.000Z"));
  expect(encoded).toBe("2024-01-02T03:04:05.000Z");
  expectTypeOf(decoded).toEqualTypeOf<Date>();
  expectTypeOf(encoded).toEqualTypeOf<string>();
});
