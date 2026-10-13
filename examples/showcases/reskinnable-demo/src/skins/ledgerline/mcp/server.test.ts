// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cardShown,
  isRepeatCall,
  resetRepeatCalls,
  REPEAT_WINDOW_MS,
} from "./server";

describe("the ChatGPT duplicate-call collapse", () => {
  it("collapses only an identical call that already drew a card, inside the window", () => {
    resetRepeatCalls();
    const a = { reportId: "EXP-2291" };
    // A refusal draws no card, so a retry is not a repeat.
    expect(isRepeatCall("approveAndReimburse", a, 1000)).toBe(false);
    expect(isRepeatCall("approveAndReimburse", a, 2000)).toBe(false);
    cardShown("getReport", a, 3000);
    expect(isRepeatCall("getReport", a, 5000)).toBe(true);
    expect(isRepeatCall("getReport", { reportId: "EXP-2317" }, 5000)).toBe(
      false,
    );
    expect(isRepeatCall("getReport", a, 3000 + REPEAT_WINDOW_MS + 1)).toBe(
      false,
    );
  });
});
