import { expect, test } from "vitest";
import {
  check,
  fallback,
  forward,
  getDefault,
  getDefaults,
  getFallback,
  message,
  object,
  optional,
  parse,
  schema as defineSchema,
  safeParse,
  string,
  unwrap,
} from "./index.js";

test("default and fallback helpers inspect wrapped schemas", () => {
  const defaulted = optional(string(), "anonymous");
  const caught = fallback(string(), "unknown");
  const schema = object({
    name: defaulted,
    nickname: optional(string()),
  });

  expect(getDefault(defaulted)).toBe("anonymous");
  expect(getDefaults(schema)).toEqual({ name: "anonymous" });
  expect(getFallback(caught)).toBe("unknown");
  expect(unwrap(defaulted)).toBe(defaulted.wrapped);
});

test("message replaces validation messages for one schema boundary", () => {
  const schema = message(string(), "Name must be text");

  const result = safeParse(schema, 42);

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.message).toBe("Name must be text");
});

test("forward moves action issues to a nested path", () => {
  const schema = defineSchema(
    string(),
    forward(
      check((input: string) => input.length > 0),
      ["name"],
    ),
  );

  const result = safeParse(schema, "");

  expect(result.success).toBe(false);
  expect(result.issues?.[0]?.path).toEqual(["name"]);
  expect(parse(schema, "Ada")).toBe("Ada");
});
