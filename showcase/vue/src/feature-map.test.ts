import { describe, expect, it } from "vitest";

import { resolveFeatureComponentKey } from "./feature-map";

describe("Vue showcase feature map", () => {
  it("maps agentic-chat to its explicit implementation", () => {
    expect(resolveFeatureComponentKey("agentic-chat")).toBe("agentic-chat");
  });

  it("rejects unknown and unimplemented features without a generic fallback", () => {
    for (const feature of ["frontend-tools", "misspelled-feature", ""]) {
      expect(() => resolveFeatureComponentKey(feature)).toThrow(
        /does not have a Vue implementation/,
      );
    }
  });
});
