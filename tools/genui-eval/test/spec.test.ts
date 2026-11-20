import { describe, expect, it } from "vitest";
import { completeSpec } from "../src/spec";

describe("completeSpec", () => {
  it("fills a partial spec from the default", () => {
    const spec = completeSpec({ markdown: { intro: "Hi." } });
    expect(spec.markdown.intro).toBe("Hi.");
    expect(spec.markdown.rules.length).toBeGreaterThan(0);
  });

  it("rejects a misspelt key at any level", () => {
    expect(() => completeSpec({ markdown: { whenToShw: "x" } })).toThrow(
      "whenToShw",
    );
    expect(() =>
      completeSpec({ schema: { markdown: { notaton: "x" } } }),
    ).toThrow("notaton");
    expect(() => completeSpec({ schema: { mardown: {} } })).toThrow("mardown");
    expect(() =>
      completeSpec({
        tool: { rules: [{ when: ["events"], items: [], rule: "x" }] },
      }),
    ).toThrow("Invalid prompt spec");
  });
});
