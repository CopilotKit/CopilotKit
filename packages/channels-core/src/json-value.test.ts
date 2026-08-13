import { expect, test } from "vitest";
import {
  COMPONENT_PROPS_MAX_BYTES,
  COMPONENT_STATE_MAX_BYTES,
  JsonValueError,
  assertComponentProps,
  assertComponentState,
  assertJsonValue,
  jsonByteLength,
} from "./json-value.js";

function arrayWithHole(): unknown[] {
  const value: unknown[] = [];
  value.length = 1;
  return value;
}

test("JSON validation accepts every supported JSON value", () => {
  const value = {
    nil: null,
    bool: true,
    number: 42.5,
    string: "hello",
    array: [false, { nested: "value" }],
  };

  const result = assertJsonValue(value, { label: "component state" });

  expect(result).toBe(value);
  expect(jsonByteLength(result)).toBe(
    new TextEncoder().encode(JSON.stringify(value)).byteLength,
  );
});

test.each([
  ["explicit undefined", { value: undefined }],
  ["an array hole", arrayWithHole()],
  ["a non-finite number", { value: Number.POSITIVE_INFINITY }],
  ["a bigint", { value: BigInt(1) }],
  ["a function", { value: () => undefined }],
  ["a symbol", { value: Symbol("value") }],
  ["a class instance", { value: new URL("https://example.com") }],
] as const)("JSON validation rejects %s", (_label, value) => {
  expect(() => assertJsonValue(value, { label: "component state" })).toThrow(
    JsonValueError,
  );
});

test("JSON validation rejects cycles with a stable error code", () => {
  const value: Record<string, unknown> = {};
  value.self = value;

  expect(() => assertJsonValue(value, { label: "component state" })).toThrow(
    expect.objectContaining({ code: "channel_component_json_cycle" }),
  );
});

test("JSON validation rejects non-index properties on arrays", () => {
  const value: unknown[] & { label?: string } = [];
  value.label = "hidden from JSON";

  expect(() => assertJsonValue(value, { label: "component state" })).toThrow(
    expect.objectContaining({ code: "channel_component_json_invalid" }),
  );
});

test("component props enforce the fixed 64 KiB UTF-8 limit", () => {
  const props = { value: "x".repeat(COMPONENT_PROPS_MAX_BYTES) };

  expect(() => assertComponentProps(props)).toThrow(
    expect.objectContaining({ code: "channel_component_props_too_large" }),
  );
});

test("component state enforces the fixed 16 KiB UTF-8 limit", () => {
  const state = { value: "x".repeat(COMPONENT_STATE_MAX_BYTES) };

  expect(() => assertComponentState(state)).toThrow(
    expect.objectContaining({ code: "channel_component_state_too_large" }),
  );
});
