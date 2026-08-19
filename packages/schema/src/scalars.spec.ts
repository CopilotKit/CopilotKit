import { expect, expectTypeOf, test } from "vitest";
import {
  any_,
  blob,
  custom,
  enum_,
  file,
  nan,
  parse,
  picklist,
  safeParse,
  symbol_,
  void_,
} from "./index.js";

test("symbol validates symbol values", () => {
  const value = Symbol("id");

  const output = parse(symbol_(), value);
  const result = safeParse(symbol_(), "id");

  expect(output).toBe(value);
  expectTypeOf(output).toEqualTypeOf<symbol>();
  expect(result.success).toBe(false);
});

test("nan accepts NaN and rejects other numbers", () => {
  const output = parse(nan(), Number.NaN);
  const result = safeParse(nan(), 0);

  expect(Number.isNaN(output)).toBe(true);
  expect(result.success).toBe(false);
});

test("blob and file validate matching web platform values", () => {
  const blobValue = new Blob(["hello"]);
  const fileValue = new File(["hello"], "hello.txt");

  const blobOutput = parse(blob(), blobValue);
  const fileOutput = parse(file(), fileValue);

  expect(blobOutput).toBe(blobValue);
  expect(fileOutput).toBe(fileValue);
  expect(safeParse(blob(), {}).success).toBe(false);
  expect(safeParse(file(), blobValue).success).toBe(false);
});

test("custom validates a user-defined type guard", () => {
  const schema = custom<{ readonly id: string }>(
    (input): input is { readonly id: string } =>
      typeof input === "object" &&
      input !== null &&
      "id" in input &&
      typeof input.id === "string",
    "Expected an entity",
  );

  const output = parse(schema, { id: "entity-1" });

  expect(output).toEqual({ id: "entity-1" });
  expectTypeOf(output).toEqualTypeOf<{ readonly id: string }>();
  expect(safeParse(schema, {}).success).toBe(false);
});

test("picklist accepts only one of its literal options", () => {
  const schema = picklist(["draft", "published"] as const);

  const output = parse(schema, "published");

  expect(output).toBe("published");
  expectTypeOf(output).toEqualTypeOf<"draft" | "published">();
  expect(safeParse(schema, "archived").success).toBe(false);
});

test("any and void expose explicit permissive and undefined schemas", () => {
  const anyOutput = parse(any_(), { value: 1 });
  const voidOutput = parse(void_(), undefined);

  expect(anyOutput).toEqual({ value: 1 });
  expect(voidOutput).toBeUndefined();
  expect(safeParse(void_(), null).success).toBe(false);
});

test("enum validates string and numeric TypeScript enum values", () => {
  enum Status {
    Draft = "draft",
    Published = "published",
  }
  enum Direction {
    Up,
    Down,
  }
  const status = enum_(Status);
  const direction = enum_(Direction);

  const statusOutput = parse(status, Status.Published);
  const directionOutput = parse(direction, Direction.Down);

  expect(statusOutput).toBe("published");
  expect(directionOutput).toBe(1);
  expectTypeOf(statusOutput).toEqualTypeOf<Status>();
  expectTypeOf(directionOutput).toEqualTypeOf<Direction>();
  expect(safeParse(status, "archived").success).toBe(false);
  expect(safeParse(direction, "Up").success).toBe(false);
});
