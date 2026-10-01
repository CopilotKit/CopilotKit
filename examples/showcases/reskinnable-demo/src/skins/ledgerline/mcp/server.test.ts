// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isRepeatCall, resetRepeatCalls, REPEAT_WINDOW_MS } from "./server";

describe("the ChatGPT duplicate-call collapse", () => {
  it("treats an identical call inside the window as a repeat, and nothing else", () => {
    resetRepeatCalls();
    expect(isRepeatCall("getReport", { reportId: "EXP-2291" }, 1000)).toBe(
      false,
    );
    expect(isRepeatCall("getReport", { reportId: "EXP-2291" }, 5000)).toBe(
      true,
    );
    expect(isRepeatCall("getReport", { reportId: "EXP-2317" }, 5000)).toBe(
      false,
    );
    expect(
      isRepeatCall(
        "getReport",
        { reportId: "EXP-2291" },
        5000 + REPEAT_WINDOW_MS + 1,
      ),
    ).toBe(false);
  });
});
