import { describe, test, expect, vi } from "vitest";
import { partialJSONParse, safeParseToolArgs } from "./utils";

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

  test("should withhold an unterminated trailing number", () => {
    expect(partialJSONParse('{"value":72,"max":1')).toEqual({ value: 72 });
  });

  test("should reveal a number once terminated", () => {
    expect(partialJSONParse('{"value":72,"max":100')).toEqual({ value: 72 });
    expect(partialJSONParse('{"value":72,"max":100}')).toEqual({
      value: 72,
      max: 100,
    });
  });

  test("should withhold an unterminated trailing array number", () => {
    expect(partialJSONParse('{"data":[10,20,3')).toEqual({ data: [10, 20] });
    expect(partialJSONParse('{"data":[10,20,30]')).toEqual({
      data: [10, 20, 30],
    });
  });

  test("should withhold unterminated numbers at any depth", () => {
    expect(partialJSONParse('{"nested":{"a":1,"b":2')).toEqual({
      nested: { a: 1 },
    });
  });

  test("should still allow partial strings, booleans and null", () => {
    expect(partialJSONParse('{"name":"jo')).toEqual({ name: "jo" });
    expect(partialJSONParse('{"value":72,"max":tru')).toEqual({
      value: 72,
      max: true,
    });
    expect(partialJSONParse('{"value":72,"max":nul')).toEqual({
      value: 72,
      max: null,
    });
  });

  test("should still parse complete numbers", () => {
    expect(partialJSONParse('{"value":72,"max":100}')).toEqual({
      value: 72,
      max: 100,
    });
    expect(partialJSONParse('{"pi":3.14}')).toEqual({ pi: 3.14 });
  });
});

describe("safeParseToolArgs", () => {
  test("should parse a valid JSON object string", () => {
    expect(safeParseToolArgs('{"key": "value"}')).toEqual({ key: "value" });
  });

  test("should return {} for a JSON string value", () => {
    expect(safeParseToolArgs('"hello"')).toEqual({});
  });

  test("should return {} for a JSON number", () => {
    expect(safeParseToolArgs("42")).toEqual({});
  });

  test("should return {} for a JSON array", () => {
    expect(safeParseToolArgs("[1, 2, 3]")).toEqual({});
  });

  test("should return {} for malformed JSON", () => {
    expect(safeParseToolArgs("{broken")).toEqual({});
  });

  test("should return {} for a JSON null", () => {
    expect(safeParseToolArgs("null")).toEqual({});
  });

  test("should return {} for a JSON boolean", () => {
    expect(safeParseToolArgs("true")).toEqual({});
  });
});
