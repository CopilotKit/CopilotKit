import { describe, test, expect } from "vitest";
import { partialJSONParse } from "./utils";

describe("partialJSONParse", () => {
  test("should parse a valid object", () => {
    expect(partialJSONParse('{"key": "value"}')).toEqual({ key: "value" });
  });

  test("should return {} for a JSON string value", () => {
    expect(partialJSONParse('"hello"')).toEqual({});
  });

  test("should return {} for a JSON number", () => {
    expect(partialJSONParse("42")).toEqual({});
  });

  test("should return {} for a JSON boolean", () => {
    expect(partialJSONParse("true")).toEqual({});
  });

  test("should return {} for a JSON null", () => {
    expect(partialJSONParse("null")).toEqual({});
  });

  test("should return {} for a JSON array", () => {
    expect(partialJSONParse("[1, 2, 3]")).toEqual({});
  });

  test("should return {} for unparseable input", () => {
    expect(partialJSONParse("not-json")).toEqual({});
  });

  test("should return {} for an empty string", () => {
    expect(partialJSONParse("")).toEqual({});
  });
});
