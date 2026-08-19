import { expectTypeOf, test } from "vitest";

import {
  base64,
  brand,
  bytes,
  check,
  checkAsync,
  creditCard,
  cuid2,
  decimal,
  digits,
  domain,
  email,
  emoji,
  empty,
  endsWith,
  entries,
  everyItem,
  filterItems,
  findItem,
  finite,
  graphemes,
  gtValue,
  hexColor,
  hexadecimal,
  includes,
  integer,
  ip,
  ipv4,
  ipv6,
  isoDate,
  isoDateTime,
  isoTime,
  isoTimestamp,
  isoWeek,
  length,
  lowercase,
  ltValue,
  mac,
  mapItems,
  maxBytes,
  maxEntries,
  maxLength,
  maxSize,
  maxValue,
  maxWords,
  minBytes,
  minEntries,
  minLength,
  minSize,
  minValue,
  minWords,
  multipleOf,
  nanoid,
  nonEmpty,
  normalize,
  notValue,
  notValues,
  octal,
  parseBoolean,
  parseJson,
  reduceItems,
  regex,
  replace,
  rfcEmail,
  readonly_,
  safeInteger,
  size,
  slug,
  someItem,
  sortItems,
  startsWith,
  stringifyJson,
  toBigint,
  toBoolean,
  toDate,
  toLowerCase,
  toNumber,
  toString,
  toUpperCase,
  transform,
  transformAsync,
  trim,
  trimEnd,
  trimStart,
  ulid,
  uppercase,
  url,
  uuid,
  value,
  values,
  words,
} from "./index.js";
import type {
  AsyncTransformationAction,
  AsyncValidationAction,
  BrandAction,
  InferActionInput,
  InferActionOutput,
  ReadonlyAction,
  TransformationAction,
  ValidationAction,
} from "./index.js";

test("custom sync actions expose their callback input and output types", () => {
  const validation = check((input: string) => input.length > 0);
  const transformation = transform((input: string) => input.length);

  expectTypeOf(validation).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(transformation).toEqualTypeOf<
    TransformationAction<string, number>
  >();
  expectTypeOf<InferActionInput<typeof validation>>().toEqualTypeOf<string>();
  expectTypeOf<InferActionOutput<typeof validation>>().toEqualTypeOf<string>();
  expectTypeOf<
    InferActionInput<typeof transformation>
  >().toEqualTypeOf<string>();
  expectTypeOf<
    InferActionOutput<typeof transformation>
  >().toEqualTypeOf<number>();
});

test("custom async actions expose awaited callback output types", () => {
  const validation = checkAsync(async (input: string) => input.length > 0);
  const transformation = transformAsync(async (input: string) => input.length);

  expectTypeOf(validation).toEqualTypeOf<AsyncValidationAction<string>>();
  expectTypeOf(transformation).toEqualTypeOf<
    AsyncTransformationAction<string, number>
  >();
  expectTypeOf<InferActionInput<typeof validation>>().toEqualTypeOf<string>();
  expectTypeOf<InferActionOutput<typeof validation>>().toEqualTypeOf<string>();
  expectTypeOf<
    InferActionInput<typeof transformation>
  >().toEqualTypeOf<string>();
  expectTypeOf<
    InferActionOutput<typeof transformation>
  >().toEqualTypeOf<number>();
});

test("length actions share the length-bearing input contract", () => {
  expectTypeOf(length(2)).toEqualTypeOf<
    ValidationAction<{ readonly length: number }>
  >();
  expectTypeOf(nonEmpty()).toEqualTypeOf<
    ValidationAction<{ readonly length: number }>
  >();
  expectTypeOf(minLength(2)).toEqualTypeOf<
    ValidationAction<{ readonly length: number }>
  >();
  expectTypeOf(maxLength(2)).toEqualTypeOf<
    ValidationAction<{ readonly length: number }>
  >();
});

test("size actions share the size-bearing input contract", () => {
  expectTypeOf(size(2)).toEqualTypeOf<
    ValidationAction<{ readonly size: number }>
  >();
  expectTypeOf(minSize(2)).toEqualTypeOf<
    ValidationAction<{ readonly size: number }>
  >();
  expectTypeOf(maxSize(2)).toEqualTypeOf<
    ValidationAction<{ readonly size: number }>
  >();
});

test("object entry actions retain the object input contract", () => {
  expectTypeOf(entries(2)).toEqualTypeOf<ValidationAction<object>>();
  expectTypeOf(minEntries(2)).toEqualTypeOf<ValidationAction<object>>();
  expectTypeOf(maxEntries(2)).toEqualTypeOf<ValidationAction<object>>();
});

test("empty accepts either length-bearing or size-bearing inputs", () => {
  expectTypeOf(empty()).toEqualTypeOf<
    ValidationAction<{ readonly length: number } | { readonly size: number }>
  >();
});

test("string count actions retain string input", () => {
  expectTypeOf(bytes(2)).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(minBytes(2)).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(maxBytes(2)).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(graphemes(2)).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(words(2)).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(minWords(2)).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(maxWords(2)).toEqualTypeOf<ValidationAction<string>>();
});

test("string transformation actions preserve string input and output", () => {
  expectTypeOf(trim()).toEqualTypeOf<TransformationAction<string, string>>();
  expectTypeOf(trimStart()).toEqualTypeOf<
    TransformationAction<string, string>
  >();
  expectTypeOf(trimEnd()).toEqualTypeOf<TransformationAction<string, string>>();
  expectTypeOf(normalize()).toEqualTypeOf<
    TransformationAction<string, string>
  >();
  expectTypeOf(replace(/a/g, "b")).toEqualTypeOf<
    TransformationAction<string, string>
  >();
  expectTypeOf(toLowerCase()).toEqualTypeOf<
    TransformationAction<string, string>
  >();
  expectTypeOf(toUpperCase()).toEqualTypeOf<
    TransformationAction<string, string>
  >();
});

test("string content validators retain string input", () => {
  expectTypeOf(startsWith("a")).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(endsWith("z")).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(includes("x")).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(lowercase()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(uppercase()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(regex(/x/)).toEqualTypeOf<ValidationAction<string>>();
});

test("string format validators all retain string input", () => {
  expectTypeOf(email()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(base64()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(cuid2()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(decimal()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(digits()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(domain()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(emoji()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(hexColor()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(hexadecimal()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(ipv4()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(ipv6()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(ip()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(isoDateTime()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(isoTime()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(isoTimestamp()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(isoWeek()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(mac()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(nanoid()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(octal()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(rfcEmail()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(slug()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(ulid()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(creditCard()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(url()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(uuid()).toEqualTypeOf<ValidationAction<string>>();
  expectTypeOf(isoDate()).toEqualTypeOf<ValidationAction<string>>();
});

test("number validators retain number input", () => {
  expectTypeOf(integer()).toEqualTypeOf<ValidationAction<number>>();
  expectTypeOf(safeInteger()).toEqualTypeOf<ValidationAction<number>>();
  expectTypeOf(finite()).toEqualTypeOf<ValidationAction<number>>();
  expectTypeOf(multipleOf(0.5)).toEqualTypeOf<ValidationAction<number>>();
});

test("ordered value validators infer number, bigint, and Date categories", () => {
  expectTypeOf(gtValue(1)).toEqualTypeOf<ValidationAction<number>>();
  expectTypeOf(ltValue(1)).toEqualTypeOf<ValidationAction<number>>();
  expectTypeOf(minValue(1)).toEqualTypeOf<ValidationAction<number>>();
  expectTypeOf(maxValue(1)).toEqualTypeOf<ValidationAction<number>>();
  expectTypeOf(gtValue(1n)).toEqualTypeOf<ValidationAction<bigint>>();
  expectTypeOf(ltValue(1n)).toEqualTypeOf<ValidationAction<bigint>>();
  expectTypeOf(minValue(1n)).toEqualTypeOf<ValidationAction<bigint>>();
  expectTypeOf(maxValue(1n)).toEqualTypeOf<ValidationAction<bigint>>();
  expectTypeOf(gtValue(new Date())).toEqualTypeOf<ValidationAction<Date>>();
  expectTypeOf(ltValue(new Date())).toEqualTypeOf<ValidationAction<Date>>();
  expectTypeOf(minValue(new Date())).toEqualTypeOf<ValidationAction<Date>>();
  expectTypeOf(maxValue(new Date())).toEqualTypeOf<ValidationAction<Date>>();
});

test("equality validators accept unknown values without narrowing them", () => {
  expectTypeOf(value("ready")).toEqualTypeOf<ValidationAction<unknown>>();
  expectTypeOf(values(["ready", 1])).toEqualTypeOf<ValidationAction<unknown>>();
  expectTypeOf(notValue("blocked")).toEqualTypeOf<ValidationAction<unknown>>();
  expectTypeOf(notValues(["blocked", 0])).toEqualTypeOf<
    ValidationAction<unknown>
  >();
});

test("general conversion actions expose their concrete outputs", () => {
  expectTypeOf(toBigint()).toEqualTypeOf<
    TransformationAction<unknown, bigint>
  >();
  expectTypeOf(toBoolean()).toEqualTypeOf<
    TransformationAction<unknown, boolean>
  >();
  expectTypeOf(toDate()).toEqualTypeOf<TransformationAction<unknown, Date>>();
  expectTypeOf(toNumber()).toEqualTypeOf<
    TransformationAction<unknown, number>
  >();
  expectTypeOf(toString()).toEqualTypeOf<
    TransformationAction<unknown, string>
  >();
  expectTypeOf(stringifyJson()).toEqualTypeOf<
    TransformationAction<unknown, string>
  >();
});

test("JSON and boolean parsers expose generic decoded types", () => {
  expectTypeOf(parseJson()).toEqualTypeOf<
    TransformationAction<string, unknown>
  >();
  expectTypeOf(parseJson<{ readonly id: string }>()).toEqualTypeOf<
    TransformationAction<string, { readonly id: string }>
  >();
  expectTypeOf(parseBoolean()).toEqualTypeOf<
    TransformationAction<string, boolean>
  >();
});

test("array predicate actions infer item types from callbacks", () => {
  expectTypeOf(everyItem((item: string) => item.length > 0)).toEqualTypeOf<
    ValidationAction<readonly string[]>
  >();
  expectTypeOf(someItem((item: string) => item.length > 0)).toEqualTypeOf<
    ValidationAction<readonly string[]>
  >();
});

test("array transformation actions infer each produced output", () => {
  expectTypeOf(filterItems((item: string) => item.length > 0)).toEqualTypeOf<
    TransformationAction<readonly string[], string[]>
  >();
  expectTypeOf(findItem((item: string) => item.length > 0)).toEqualTypeOf<
    TransformationAction<readonly string[], string | undefined>
  >();
  expectTypeOf(mapItems((item: string) => item.length)).toEqualTypeOf<
    TransformationAction<readonly string[], number[]>
  >();
  expectTypeOf(
    reduceItems((total: number, item: string) => total + item.length, 0),
  ).toEqualTypeOf<TransformationAction<readonly string[], number>>();
  expectTypeOf(
    sortItems((left: string, right: string) => left.localeCompare(right)),
  ).toEqualTypeOf<TransformationAction<readonly string[], string[]>>();
});

test("brand and readonly actions retain their marker types", () => {
  expectTypeOf(brand<"UserId">()).toEqualTypeOf<BrandAction<"UserId">>();
  expectTypeOf(readonly_()).toEqualTypeOf<ReadonlyAction>();
});
