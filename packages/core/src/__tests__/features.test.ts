import { expect, test } from "vitest";
import { ɵCOPILOTKIT_FEATURES, ɵisCopilotKitFeature } from "../features";

test("registers the chat surfaces as features", () => {
  expect(ɵCOPILOTKIT_FEATURES).toContain("chat");
  expect(ɵCOPILOTKIT_FEATURES).toContain("sidebar");
  expect(ɵCOPILOTKIT_FEATURES).toContain("popup");
});

test("registers threads as a real feature", () => {
  expect(ɵCOPILOTKIT_FEATURES).toContain("threads");
  expect(ɵisCopilotKitFeature("threads")).toBe(true);
});

test("rejects unknown feature names", () => {
  expect(ɵisCopilotKitFeature("not-a-feature")).toBe(false);
});

test("the feature list is frozen against mutation", () => {
  expect(Object.isFrozen(ɵCOPILOTKIT_FEATURES)).toBe(true);
});
