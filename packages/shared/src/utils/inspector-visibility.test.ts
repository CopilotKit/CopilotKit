import { describe, expect, it } from "vitest";
import { shouldEnableInspector } from "./inspector-visibility";

describe("shouldEnableInspector", () => {
  it("shows by default in a development browser", () => {
    expect(
      shouldEnableInspector({
        isBrowser: true,
        isDevelopment: true,
      }),
    ).toBe(true);
  });

  it("honors an explicit disable in development", () => {
    expect(
      shouldEnableInspector({
        enableInspector: false,
        isBrowser: true,
        isDevelopment: true,
      }),
    ).toBe(false);
  });

  it("allows an explicit production browser opt-in", () => {
    expect(
      shouldEnableInspector({
        enableInspector: true,
        isBrowser: true,
        isDevelopment: false,
      }),
    ).toBe(true);
  });

  it("stays hidden by default in production", () => {
    expect(
      shouldEnableInspector({ isBrowser: true, isDevelopment: false }),
    ).toBe(false);
  });

  it("never shows during server rendering", () => {
    expect(
      shouldEnableInspector({
        enableInspector: true,
        isBrowser: false,
        isDevelopment: true,
      }),
    ).toBe(false);
  });
});
