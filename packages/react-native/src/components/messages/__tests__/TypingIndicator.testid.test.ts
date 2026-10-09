import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Verifies the react-native TypingIndicator renders the stable
 * `copilot-loading-cursor` testID so e2e tests can deterministically detect
 * the "still loading" state. Uses RN's `testID` (capital ID) convention.
 */

const tiPath = resolve(__dirname, "../TypingIndicator.tsx");
const tiSrc = readFileSync(tiPath, "utf-8");

describe("react-native stable testids", () => {
  it("TypingIndicator renders the copilot-loading-cursor testID", () => {
    expect(tiSrc).toMatch(/testID="copilot-loading-cursor"/);
  });
});
