import { describe, it, expect } from "vitest";
import { parseDuration } from "./duration.js";

describe("parseDuration", () => {
  it("parses units", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("30d")).toBe(2_592_000_000);
  });
  it("passes numbers through", () => expect(parseDuration(1234)).toBe(1234));
  it("throws on garbage", () => expect(() => parseDuration("nope")).toThrow());
});
