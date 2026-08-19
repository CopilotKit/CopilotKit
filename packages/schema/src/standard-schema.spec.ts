import { expect, expectTypeOf, test } from "vitest";
import { schema, streaming, string } from "./index.js";

test("Standard Schema adapters are created only when requested", () => {
  const schema = string();

  const descriptor =
    Object.getOwnPropertyDescriptor(schema, "~standard") ??
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(schema) as object,
      "~standard",
    );
  const firstAdapter = schema["~standard"];
  const secondAdapter = schema["~standard"];

  expect(descriptor?.get).toBeTypeOf("function");
  expect(descriptor?.value).toBeUndefined();
  expect(secondAdapter).not.toBe(firstAdapter);
});

test("Standard Schema validates valid input with typed output", () => {
  const schema = string();

  const result = schema["~standard"].validate("Ada");

  expect(schema["~standard"].vendor).toBe("@copilotkit/schema");
  expect(schema["~standard"].version).toBe(1);
  expect(result).toEqual({ value: "Ada" });
  if ("value" in result) {
    expectTypeOf(result.value).toEqualTypeOf<string>();
  }
});

test("Standard Schema returns issues for invalid input", () => {
  const schema = string();

  const result = schema["~standard"].validate(42);

  expect(result).toEqual({
    issues: [
      {
        expected: "string",
        input: 42,
        message: "Expected string",
        path: [],
        type: "string",
      },
    ],
  });
});

test("Standard Schema exports ordinary model-facing JSON Schema without streaming metadata", () => {
  const value = schema(string(), streaming());

  const jsonSchema = value["~standard"].jsonSchema.input({
    target: "draft-07",
  });

  expect(jsonSchema).toEqual({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "string",
  });
  expect(JSON.stringify(jsonSchema)).not.toContain("streaming");
});
