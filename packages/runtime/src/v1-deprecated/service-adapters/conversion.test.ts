import { describe, it, expect } from "vitest";

/**
 * safeParseToolArgs is a private (non-exported) function in conversion.ts.
 * We duplicate its logic here to unit-test the algorithm in isolation.
 * This mirrors the shared safeParseToolArgs in @copilotkit/shared.
 */
function safeParseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

describe("safeParseToolArgs (v1 conversion)", () => {
  it("parses a valid JSON object string", () => {
    expect(safeParseToolArgs('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("returns {} for a JSON string value", () => {
    expect(safeParseToolArgs('"hello"')).toEqual({});
  });

  it("returns {} for a JSON number", () => {
    expect(safeParseToolArgs("42")).toEqual({});
  });

  it("returns {} for a JSON array", () => {
    expect(safeParseToolArgs("[1, 2, 3]")).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    expect(safeParseToolArgs("{broken")).toEqual({});
  });

  it("returns {} for a JSON null", () => {
    expect(safeParseToolArgs("null")).toEqual({});
  });

  it("returns {} for a JSON boolean", () => {
    expect(safeParseToolArgs("true")).toEqual({});
  });

  it("returns {} for an empty string", () => {
    expect(safeParseToolArgs("")).toEqual({});
  });
});
