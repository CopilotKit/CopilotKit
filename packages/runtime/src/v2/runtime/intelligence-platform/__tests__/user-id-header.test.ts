import { describe, expect, it } from "vitest";
import { encodeIntelligenceUserIdHeader } from "../client";

describe("encodeIntelligenceUserIdHeader", () => {
  it("sends printable ASCII ids unchanged", () => {
    for (const id of ["user-1", "a%20b", "O'Brien", 'x"y', "a b"]) {
      expect(encodeIntelligenceUserIdHeader(id)).toBe(id);
    }
  });

  it("sends any other id as a JSON string with \\u escapes", () => {
    for (const id of ["審査員-1", "josé", "🤖", "tab\there", '"quoted"']) {
      const header = encodeIntelligenceUserIdHeader(id);
      expect(header).toMatch(/^"[\x20-\x7e]*"$/);
      expect(JSON.parse(header)).toBe(id);
      expect(() => new Headers({ "x-cpki-user-id": header })).not.toThrow();
    }
    expect(encodeIntelligenceUserIdHeader("josé")).toBe('"jos\\u00e9"');
  });
});
