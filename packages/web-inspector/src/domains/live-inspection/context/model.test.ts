import { describe, expect, it } from "vitest";
import {
  coerceContextJson,
  contextValuePreview,
  formatContextValue,
  normalizeContextStore,
} from "./model.js";

describe("live context model", () => {
  it("normalizes wrapped and direct context values", () => {
    expect(
      normalizeContextStore({
        direct: 3,
        wrapped: { description: " Details ", value: { ready: true } },
        blankDescription: { description: " ", value: "value" },
      }),
    ).toEqual({
      direct: { value: 3 },
      wrapped: { description: " Details ", value: { ready: true } },
      blankDescription: { description: undefined, value: "value" },
    });
  });

  it("coerces JSON-looking strings while preserving invalid text", () => {
    expect(coerceContextJson('{"ready":true}')).toEqual({ ready: true });
    expect(coerceContextJson("{invalid}")).toBe("{invalid}");
    expect(formatContextValue("[1,2]")).toBe("[\n  1,\n  2\n]");
    expect(contextValuePreview({ first: 1, second: 2 })).toBe(
      "Object with 2 keys",
    );
  });
});
