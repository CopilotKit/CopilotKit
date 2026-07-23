import { describe, it, expect } from "vitest";
import { defaultTelegramContext } from "../built-in-context.js";

describe("defaultTelegramContext", () => {
  it("has three context entries with description+value", () => {
    expect(defaultTelegramContext).toHaveLength(3);
    for (const e of defaultTelegramContext) {
      expect(typeof e.description).toBe("string");
      expect(e.value.length).toBeGreaterThan(0);
    }
  });
});
