import { describe, it, expect } from "vitest";
import { defaultsForSchema, mergeValues } from "../normalize";
import type { FormSchema } from "../types";

const schema: FormSchema = {
  fields: [
    { kind: "string", name: "text", label: "text", required: true },
    { kind: "number", name: "count", label: "count", required: false },
    { kind: "boolean", name: "done", label: "done", required: true },
    { kind: "string", name: "color", label: "color", required: true, enum: ["red", "blue"] },
  ],
};

describe("defaultsForSchema", () => {
  it("produces defaults by kind", () => {
    expect(defaultsForSchema(schema)).toEqual({
      text: "",
      done: false,
      color: "red",
    });
  });
});

describe("mergeValues", () => {
  it("preserves values whose names+types match", () => {
    const merged = mergeValues(schema, { text: "hi", count: 3, stale: 1 });
    expect(merged).toEqual({ text: "hi", count: 3, done: false, color: "red" });
  });

  it("drops values whose type changed", () => {
    const merged = mergeValues(schema, { text: 42 });
    expect(merged.text).toBe("");
  });

  it("clamps enum values to the allowed list", () => {
    const merged = mergeValues(schema, { color: "green" });
    expect(merged.color).toBe("red");
    const kept = mergeValues(schema, { color: "blue" });
    expect(kept.color).toBe("blue");
  });
});
