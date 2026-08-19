import { expect, expectTypeOf, test } from "vitest";
import {
  bytes,
  empty,
  entries,
  everyItem,
  filterItems,
  findItem,
  graphemes,
  gtValue,
  ltValue,
  mapItems,
  maxBytes,
  maxWords,
  minBytes,
  minWords,
  normalize,
  notValue,
  number,
  parse,
  parseBoolean,
  parseJson,
  schema as defineSchema,
  reduceItems,
  replace,
  safeParse,
  size,
  someItem,
  sortItems,
  string,
  stringifyJson,
  toBigint,
  toBoolean,
  toDate,
  toNumber,
  toString,
  trimEnd,
  trimStart,
  value,
  values,
  words,
  array,
  object,
  set,
} from "./index.js";

test("byte, grapheme, word, entry, size, and empty checks count values", () => {
  expect(safeParse(defineSchema(string(), bytes(4)), "😀").success).toBe(true);
  expect(
    safeParse(defineSchema(string(), minBytes(2), maxBytes(4)), "Ada").success,
  ).toBe(true);
  expect(safeParse(defineSchema(string(), graphemes(1)), "😀").success).toBe(
    true,
  );
  expect(
    safeParse(
      defineSchema(string(), words(2), minWords(2), maxWords(3)),
      "Ada Lovelace",
    ).success,
  ).toBe(true);
  expect(
    safeParse(defineSchema(object({ name: string() }), entries(1)), {
      name: "Ada",
    }).success,
  ).toBe(true);
  expect(
    safeParse(defineSchema(set(number()), size(2)), new Set([1, 2])).success,
  ).toBe(true);
  expect(safeParse(defineSchema(string(), empty()), "").success).toBe(true);
});

test("value checks compare exact and ordered values", () => {
  expect(
    safeParse(defineSchema(number(), gtValue(1), ltValue(3)), 2).success,
  ).toBe(true);
  expect(safeParse(defineSchema(string(), value("Ada")), "Ada").success).toBe(
    true,
  );
  expect(
    safeParse(defineSchema(string(), values(["Ada", "Grace"])), "Grace")
      .success,
  ).toBe(true);
  expect(
    safeParse(defineSchema(string(), notValue("Ada")), "Ada").success,
  ).toBe(false);
});

test("string transforms normalize, replace, trim, parse, and stringify", () => {
  const cleaned = defineSchema(
    string(),
    trimStart(),
    trimEnd(),
    replace(/\s+/g, "-"),
    normalize(),
  );
  const json = defineSchema(string(), parseJson<{ readonly count: number }>());
  const serialized = defineSchema(object({ count: number() }), stringifyJson());

  expect(parse(cleaned, "  Ada Lovelace  ")).toBe("Ada-Lovelace");
  expect(parse(json, '{"count":42}')).toEqual({ count: 42 });
  expect(parse(serialized, { count: 42 })).toBe('{"count":42}');
  expect(parse(defineSchema(string(), parseBoolean()), "true")).toBe(true);
  expect(
    safeParse(defineSchema(string(), parseBoolean()), "maybe").success,
  ).toBe(false);
});

test("conversion actions expose strict final output types", () => {
  const numeric = parse(defineSchema(string(), toNumber()), "42");
  const bigint = parse(defineSchema(string(), toBigint()), "42");
  const boolean = parse(defineSchema(number(), toBoolean()), 1);
  const date = parse(defineSchema(string(), toDate()), "2024-01-02");
  const text = parse(defineSchema(number(), toString()), 42);

  expect([numeric, bigint, boolean, text]).toEqual([42, 42n, true, "42"]);
  expect(date).toEqual(new Date("2024-01-02"));
  expectTypeOf(numeric).toEqualTypeOf<number>();
  expectTypeOf(bigint).toEqualTypeOf<bigint>();
});

test("item actions inspect and transform arrays without mutating input", () => {
  const source = [3, 1, 2];
  const positive = defineSchema(
    array(number()),
    everyItem((item: number) => item > 0),
    someItem((item: number) => item % 2 === 0),
  );
  const mapped = defineSchema(
    array(number()),
    filterItems((item: number) => item > 1),
    mapItems((item: number) => item * 2),
    sortItems((left: number, right: number) => left - right),
  );
  const found = defineSchema(
    array(number()),
    findItem((item: number) => item === 2),
  );
  const total = defineSchema(
    array(number()),
    reduceItems((sum: number, item: number) => sum + item, 0),
  );

  expect(parse(positive, source)).toEqual(source);
  expect(parse(mapped, source)).toEqual([4, 6]);
  expect(parse(found, source)).toBe(2);
  expect(parse(total, source)).toBe(6);
  expect(source).toEqual([3, 1, 2]);
});
