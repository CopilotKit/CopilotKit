import { describe, it, expect } from "vitest";
import { validateFixture, parseFixtureJson } from "../fixture-validator";

describe("parseFixtureJson", () => {
  it("parses valid multi-fixture JSON", () => {
    const json = JSON.stringify({
      default: { surfaceId: "preview", messages: [{ type: "test" }] },
      "empty state": { surfaceId: "preview", messages: [] },
    });

    const result = parseFixtureJson(json);

    expect(result.valid).toBe(true);
    expect(result.fixtures).toBeDefined();
    expect(Object.keys(result.fixtures!)).toEqual(["default", "empty state"]);
    expect(result.fixtures!["default"].surfaceId).toBe("preview");
  });

  it("rejects fixture missing surfaceId", () => {
    const json = JSON.stringify({
      default: { messages: [] },
    });

    const result = parseFixtureJson(json);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("surfaceId");
  });

  it("rejects fixture missing messages", () => {
    const json = JSON.stringify({
      default: { surfaceId: "preview" },
    });

    const result = parseFixtureJson(json);

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("messages");
  });

  it("rejects non-object JSON", () => {
    const result = parseFixtureJson('"just a string"');

    expect(result.valid).toBe(false);
  });

  it("rejects malformed JSON", () => {
    const result = parseFixtureJson("{bad json");

    expect(result.valid).toBe(false);
  });
});

describe("validateFixture (TypeScript)", () => {
  it("validates a TS file with default export", () => {
    const code = `
      export default {
        "default": { surfaceId: "preview", messages: [] },
      };
    `;

    const result = validateFixture("test.ts", code);

    expect(result.valid).toBe(true);
  });

  it("rejects a TS file with syntax errors", () => {
    const result = validateFixture("test.ts", "export default {{{;");

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a TS file with no default export", () => {
    const code = `export const fixtures = { "default": { surfaceId: "preview", messages: [] } };`;

    const result = validateFixture("test.ts", code);

    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("default export");
  });
});
