import { describe, it, expect } from "vitest";
import {
  renderAdaptiveCard,
  isPlainText,
  collectPlainText,
  createRunRenderer,
  ADAPTIVE_CARD_CONTENT_TYPE,
} from "./index.js";

describe("render/index (managed reuse surface)", () => {
  it("exposes the render + run-renderer functions", () => {
    expect(typeof renderAdaptiveCard).toBe("function");
    expect(typeof isPlainText).toBe("function");
    expect(typeof collectPlainText).toBe("function");
    expect(typeof createRunRenderer).toBe("function");
  });

  it("exposes the Adaptive Card content type as a string", () => {
    expect(typeof ADAPTIVE_CARD_CONTENT_TYPE).toBe("string");
    expect(ADAPTIVE_CARD_CONTENT_TYPE.length).toBeGreaterThan(0);
  });
});
