/* eslint-disable @typescript-eslint/no-unused-vars -- Type tests consume fixtures through typeof queries. */

import { expectTypeOf, test } from "vitest";

import {
  any_,
  bigint,
  blob,
  boolean,
  coerceBigint,
  coerceBoolean,
  coerceDate,
  coerceNumber,
  coerceString,
  custom,
  date,
  enum_,
  file,
  instance,
  literal,
  nan,
  never,
  null_,
  number,
  picklist,
  preprocess,
  string,
  symbol_,
  undefined_,
  unknown,
  void_,
} from "./index.js";
import type { FileValue, InferInput, InferOutput } from "./index.js";

test("primitive schemas preserve their exact input and output types", () => {
  const stringSchema = string();
  const numberSchema = number();
  const booleanSchema = boolean();
  const bigintSchema = bigint();
  const dateSchema = date();
  const symbolSchema = symbol_();
  const nanSchema = nan();

  expectTypeOf<InferInput<typeof stringSchema>>().toEqualTypeOf<string>();
  expectTypeOf<InferOutput<typeof stringSchema>>().toEqualTypeOf<string>();
  expectTypeOf<InferInput<typeof numberSchema>>().toEqualTypeOf<number>();
  expectTypeOf<InferOutput<typeof numberSchema>>().toEqualTypeOf<number>();
  expectTypeOf<InferInput<typeof booleanSchema>>().toEqualTypeOf<boolean>();
  expectTypeOf<InferOutput<typeof booleanSchema>>().toEqualTypeOf<boolean>();
  expectTypeOf<InferInput<typeof bigintSchema>>().toEqualTypeOf<bigint>();
  expectTypeOf<InferOutput<typeof bigintSchema>>().toEqualTypeOf<bigint>();
  expectTypeOf<InferInput<typeof dateSchema>>().toEqualTypeOf<Date>();
  expectTypeOf<InferOutput<typeof dateSchema>>().toEqualTypeOf<Date>();
  expectTypeOf<InferInput<typeof symbolSchema>>().toEqualTypeOf<symbol>();
  expectTypeOf<InferOutput<typeof symbolSchema>>().toEqualTypeOf<symbol>();
  expectTypeOf<InferInput<typeof nanSchema>>().toEqualTypeOf<number>();
  expectTypeOf<InferOutput<typeof nanSchema>>().toEqualTypeOf<number>();
});

test("top and bottom primitive schemas retain TypeScript special types", () => {
  const unknownSchema = unknown();
  const anySchema = any_();
  const neverSchema = never();
  const voidSchema = void_();

  expectTypeOf<InferInput<typeof unknownSchema>>().toBeUnknown();
  expectTypeOf<InferOutput<typeof unknownSchema>>().toBeUnknown();
  expectTypeOf<InferInput<typeof anySchema>>().toBeAny();
  expectTypeOf<InferOutput<typeof anySchema>>().toBeAny();
  expectTypeOf<InferInput<typeof neverSchema>>().toBeNever();
  expectTypeOf<InferOutput<typeof neverSchema>>().toBeNever();
  expectTypeOf<InferInput<typeof voidSchema>>().toBeVoid();
  expectTypeOf<InferOutput<typeof voidSchema>>().toBeVoid();
});

test("null and undefined schemas retain their exact singleton types", () => {
  const nullSchema = null_();
  const undefinedSchema = undefined_();

  expectTypeOf<InferInput<typeof nullSchema>>().toEqualTypeOf<null>();
  expectTypeOf<InferOutput<typeof nullSchema>>().toEqualTypeOf<null>();
  expectTypeOf<InferInput<typeof undefinedSchema>>().toEqualTypeOf<undefined>();
  expectTypeOf<
    InferOutput<typeof undefinedSchema>
  >().toEqualTypeOf<undefined>();
});

test("blob and file schemas expose platform-neutral structural types", () => {
  const blobSchema = blob();
  const fileSchema = file();

  expectTypeOf<InferInput<typeof blobSchema>>().toEqualTypeOf<{
    readonly size: number;
    readonly type: string;
  }>();
  expectTypeOf<InferOutput<typeof blobSchema>>().toEqualTypeOf<{
    readonly size: number;
    readonly type: string;
  }>();
  expectTypeOf<InferInput<typeof fileSchema>>().toEqualTypeOf<FileValue>();
  expectTypeOf<InferOutput<typeof fileSchema>>().toEqualTypeOf<FileValue>();
});

test("coercion schemas accept unknown input and expose their converted outputs", () => {
  const stringSchema = coerceString();
  const numberSchema = coerceNumber();
  const booleanSchema = coerceBoolean();
  const bigintSchema = coerceBigint();
  const dateSchema = coerceDate();

  expectTypeOf<InferInput<typeof stringSchema>>().toBeUnknown();
  expectTypeOf<InferOutput<typeof stringSchema>>().toEqualTypeOf<string>();
  expectTypeOf<InferInput<typeof numberSchema>>().toBeUnknown();
  expectTypeOf<InferOutput<typeof numberSchema>>().toEqualTypeOf<number>();
  expectTypeOf<InferInput<typeof booleanSchema>>().toBeUnknown();
  expectTypeOf<InferOutput<typeof booleanSchema>>().toEqualTypeOf<boolean>();
  expectTypeOf<InferInput<typeof bigintSchema>>().toBeUnknown();
  expectTypeOf<InferOutput<typeof bigintSchema>>().toEqualTypeOf<bigint>();
  expectTypeOf<InferInput<typeof dateSchema>>().toBeUnknown();
  expectTypeOf<InferOutput<typeof dateSchema>>().toEqualTypeOf<Date>();
});

test("preprocess widens input while retaining the wrapped output", () => {
  const schema = preprocess((input) => String(input), string());

  expectTypeOf<InferInput<typeof schema>>().toBeUnknown();
  expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<string>();
});

test("custom schemas retain their explicit output type", () => {
  interface UserId {
    readonly userId: string;
  }

  const schema = custom<UserId>(
    (input) => typeof input === "object" && input !== null,
  );

  expectTypeOf<InferInput<typeof schema>>().toEqualTypeOf<UserId>();
  expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<UserId>();
});

test("literal and picklist schemas preserve literal unions", () => {
  const literalSchema = literal("ready");
  const picklistSchema = picklist(["ready", "running", 3, null] as const);

  expectTypeOf<InferInput<typeof literalSchema>>().toEqualTypeOf<"ready">();
  expectTypeOf<InferOutput<typeof literalSchema>>().toEqualTypeOf<"ready">();
  expectTypeOf(literalSchema.literal).toEqualTypeOf<"ready">();
  expectTypeOf<InferInput<typeof picklistSchema>>().toEqualTypeOf<
    "ready" | "running" | 3 | null
  >();
  expectTypeOf<InferOutput<typeof picklistSchema>>().toEqualTypeOf<
    "ready" | "running" | 3 | null
  >();
  expectTypeOf(picklistSchema.literals).toEqualTypeOf<
    readonly ["ready", "running", 3, null]
  >();
});

test("enum schemas infer the enum object value union", () => {
  const status = {
    Done: "done",
    Pending: "pending",
    RetryCount: 3,
  } as const;
  const schema = enum_(status);

  expectTypeOf<InferInput<typeof schema>>().toEqualTypeOf<
    "done" | "pending" | 3
  >();
  expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<
    "done" | "pending" | 3
  >();
});

test("instance schemas infer the constructed instance type", () => {
  class User {
    constructor(readonly id: string) {}
  }

  const schema = instance(User);

  expectTypeOf<InferInput<typeof schema>>().toEqualTypeOf<User>();
  expectTypeOf<InferOutput<typeof schema>>().toEqualTypeOf<User>();
});

test("literal constructors reject values outside the supported literal set", () => {
  // @ts-expect-error objects are not schema literals
  literal({ status: "ready" });

  // @ts-expect-error picklists require at least one literal
  picklist([]);
});
