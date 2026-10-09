import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError, settleInterrupt } from "./settle";

/**
 * These assertions exist because an unsettled human-in-the-loop interrupt WEDGES
 * the agent run, and the two ways of getting there are both invisible: `respond`
 * is `undefined` while tool arguments stream, and its promise can reject. The
 * original code wrote `respond?.(message)`, which compiles, lints, renders, and
 * silently drops the response in both cases.
 */
describe("settleInterrupt", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("delivers the message and reports success as null", async () => {
    const respond = vi.fn(async () => {});
    await expect(
      settleInterrupt(respond, "Refund issued."),
    ).resolves.toBeNull();
    expect(respond).toHaveBeenCalledWith("Refund issued.");
  });

  it("does NOT silently no-op when respond is unavailable", async () => {
    const failure = await settleInterrupt(undefined, "Refund issued.");
    // The whole point: a sentence comes back, so the card has something to show
    // and the user has a reason to click again.
    expect(failure).toBeTruthy();
    expect(failure).toMatch(/try again/i);
    expect(console.error).toHaveBeenCalled();
  });

  it("reports a rejected respond instead of throwing out of the click", async () => {
    const respond = vi.fn(async () => {
      throw new Error("stream closed");
    });
    const failure = await settleInterrupt(respond, "Refund issued.");
    expect(failure).toContain("stream closed");
    expect(console.error).toHaveBeenCalled();
  });

  it("never throws, whatever respond does", async () => {
    const respond = vi.fn(() => Promise.reject("not an Error at all"));
    await expect(
      settleInterrupt(respond, "Refund issued."),
    ).resolves.toBeTruthy();
  });
});

describe("describeError", () => {
  it("prefers an Error message", () => {
    expect(describeError(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("stringifies non-Errors and never yields an empty line", () => {
    expect(describeError("boom")).toBe("boom");
    expect(describeError(undefined)).toBe("unknown error");
    expect(describeError(new Error(""))).toBe("unknown error");
  });
});
