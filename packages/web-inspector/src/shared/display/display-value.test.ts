import { describe, expect, it } from "vitest";
import {
  normalizeDisplayValue,
  serializeDisplayValue,
} from "./display-value.js";

describe("normalizeDisplayValue", () => {
  it("normalizes unsupported and circular values without throwing", () => {
    type RecursiveInput = {
      missing: undefined;
      count: bigint;
      self?: RecursiveInput;
    };
    const input: RecursiveInput = { missing: undefined, count: 12n };
    input.self = input;

    expect(normalizeDisplayValue(input)).toEqual({
      missing: "[undefined]",
      count: "12",
      self: "[Circular]",
    });
    expect(serializeDisplayValue(input, { pretty: true })).toBe(
      '{\n  "missing": "[undefined]",\n  "count": "12",\n  "self": "[Circular]"\n}',
    );
  });

  it("detects circular arrays", () => {
    const input: unknown[] = [];
    input.push(input);

    expect(normalizeDisplayValue(input)).toEqual(["[Circular]"]);
  });

  it("truncates containers beyond the supported display depth", () => {
    expect(
      normalizeDisplayValue({
        one: { two: { three: { four: { five: 1 } } } },
      }),
    ).toEqual({
      one: { two: { three: { four: "[Truncated depth]" } } },
    });
  });

  it("normalizes dates and other non-JSON primitives", () => {
    const named = function namedFunction() {};

    expect(
      normalizeDisplayValue({
        date: new Date("2026-08-27T12:00:00.000Z"),
        symbol: Symbol("value"),
        named,
      }),
    ).toEqual({
      date: "2026-08-27T12:00:00.000Z",
      symbol: "Symbol(value)",
      named: String(named),
    });
  });
});

describe("serializeDisplayValue", () => {
  it("supports compact output", () => {
    expect(serializeDisplayValue({ answer: 42 })).toBe('{"answer":42}');
  });
});
