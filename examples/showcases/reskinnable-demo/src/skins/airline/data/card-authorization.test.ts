import { describe, it, expect } from "vitest";
import { cardConfirmationGuidance, readCardLast4 } from "./card-authorization";

describe("the guidance and the predicate agree", () => {
  it("prints the same length the predicate accepts", () => {
    // A card that prints a figure it will not accept is worse than a wrong
    // number: the presenter follows the app's own instruction on stage and the
    // app refuses, with nothing on screen saying why.
    const guidance = cardConfirmationGuidance("Visa ending in ••••");
    expect(guidance.hint).toContain(String(guidance.length));
    expect(readCardLast4("4".repeat(guidance.length)).ok).toBe(true);
    expect(readCardLast4("4".repeat(guidance.length + 1)).ok).toBe(false);
  });

  it("names the card without putting a digit on screen", () => {
    const guidance = cardConfirmationGuidance("Visa ending in ••••");
    expect(guidance.hint).toContain("Visa");
    // Only the LENGTH may appear; no card digits exist anywhere to leak.
    expect(guidance.hint.replace(String(guidance.length), "")).not.toMatch(
      /[0-9]/,
    );
  });
});

describe("readCardLast4 refuses what it cannot read", () => {
  it("accepts exactly four digits, tolerating surrounding space", () => {
    expect(readCardLast4("4417")).toEqual({ ok: true, last4: "4417" });
    expect(readCardLast4("  4417  ")).toEqual({ ok: true, last4: "4417" });
    expect(readCardLast4("0007")).toEqual({ ok: true, last4: "0007" });
  });

  it("reports an untouched field separately, so it is not scolded", () => {
    expect(readCardLast4("")).toEqual({ ok: false, untouched: true });
    expect(readCardLast4("   ")).toEqual({ ok: false, untouched: true });
  });

  it("REFUSES rather than stripping characters it does not recognise", () => {
    // `Number(typed.replace(/[^0-9]/g, ""))` turns every one of these into an
    // accepted confirmation. On this beat the typed value IS the write.
    for (const typed of ["-4417", "44 17", "4,417", "44.17", "4e17", "+4417"]) {
      const verdict = readCardLast4(typed);
      expect(verdict.ok).toBe(false);
      if (verdict.ok || "untouched" in verdict) {
        throw new Error(`"${typed}" should be a stated refusal, not a pass`);
      }
      expect(verdict.reason).toBeTruthy();
    }
  });

  it("says how many digits it got when the length is wrong", () => {
    const verdict = readCardLast4("441");
    if (verdict.ok || "untouched" in verdict)
      throw new Error("expected reason");
    expect(verdict.reason).toContain("3");
    expect(verdict.reason).toContain("4");
  });
});
