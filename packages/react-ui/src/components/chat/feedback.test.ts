import { describe, expect, it } from "vitest";
import {
  applyFeedbackClick,
  isActivatingClick,
  type MessageFeedbackMap,
} from "./feedback";

describe("isActivatingClick (#2615)", () => {
  it("activates when no feedback has been given", () => {
    expect(isActivatingClick(null, "thumbsUp")).toBe(true);
    expect(isActivatingClick(undefined, "thumbsDown")).toBe(true);
  });

  it("deactivates when clicking the already-active button", () => {
    expect(isActivatingClick("thumbsUp", "thumbsUp")).toBe(false);
    expect(isActivatingClick("thumbsDown", "thumbsDown")).toBe(false);
  });

  it("activates when switching to the opposite button", () => {
    expect(isActivatingClick("thumbsDown", "thumbsUp")).toBe(true);
    expect(isActivatingClick("thumbsUp", "thumbsDown")).toBe(true);
  });
});

describe("applyFeedbackClick (#2615)", () => {
  it("records feedback for a message that had none", () => {
    expect(applyFeedbackClick({}, "m1", "thumbsUp", true)).toEqual({
      m1: "thumbsUp",
    });
  });

  it("replaces the opposite feedback rather than keeping both", () => {
    const previous: MessageFeedbackMap = { m1: "thumbsDown" };
    expect(applyFeedbackClick(previous, "m1", "thumbsUp", true)).toEqual({
      m1: "thumbsUp",
    });
  });

  it("removes the entry when the click retracts feedback", () => {
    const previous: MessageFeedbackMap = { m1: "thumbsUp", m2: "thumbsDown" };
    const next = applyFeedbackClick(previous, "m1", "thumbsUp", false);

    expect(next).toEqual({ m2: "thumbsDown" });
    expect("m1" in next).toBe(false);
  });

  it("leaves other messages untouched", () => {
    const previous: MessageFeedbackMap = { m1: "thumbsUp" };
    expect(applyFeedbackClick(previous, "m2", "thumbsDown", true)).toEqual({
      m1: "thumbsUp",
      m2: "thumbsDown",
    });
  });

  it("does not mutate the map it is given", () => {
    const previous: MessageFeedbackMap = { m1: "thumbsUp" };
    applyFeedbackClick(previous, "m1", "thumbsUp", false);
    expect(previous).toEqual({ m1: "thumbsUp" });
  });

  it("returns the same reference when nothing changes", () => {
    const previous: MessageFeedbackMap = { m1: "thumbsUp" };
    expect(applyFeedbackClick(previous, "m1", "thumbsUp", true)).toBe(previous);
    expect(applyFeedbackClick(previous, "m2", "thumbsUp", false)).toBe(
      previous,
    );
  });

  it("round-trips a toggle back to the starting state", () => {
    const applied = applyFeedbackClick({}, "m1", "thumbsUp", true);
    const retracted = applyFeedbackClick(applied, "m1", "thumbsUp", false);
    expect(retracted).toEqual({});
  });
});
