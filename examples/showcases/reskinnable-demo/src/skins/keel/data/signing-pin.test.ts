import { describe, it, expect } from "vitest";
import { readSigningPin, signingPinGuidance } from "./signing-pin";

describe("the card's guidance and its submit predicate are ONE helper", () => {
  it("prints a length the predicate actually accepts", () => {
    // A card that prints a rule it will not accept is worse than a wrong rule:
    // the presenter follows the app's own instruction on stage and the app
    // refuses, with nothing on screen saying why.
    const { length, hint } = signingPinGuidance();
    expect(hint).toContain(String(length));
    expect(readSigningPin("1".repeat(length)).ok).toBe(true);
    expect(readSigningPin("1".repeat(length + 1)).ok).toBe(false);
  });
});

describe("readSigningPin refuses what it cannot read, never rewrites it", () => {
  it("accepts exactly six digits", () => {
    expect(readSigningPin("482913")).toEqual({ ok: true, pin: "482913" });
    expect(readSigningPin("  482913  ")).toEqual({ ok: true, pin: "482913" });
  });

  it("REFUSES a signed value rather than stripping the sign", () => {
    // `typed.replace(/[^0-9]/g, "")` would turn this into a valid signature.
    expect(readSigningPin("-482913").ok).toBe(false);
    expect(readSigningPin("+48291").ok).toBe(false);
  });

  it("refuses anything that is not digits", () => {
    for (const typed of ["4829a3", "48 913", "4.8291", "1e5", "٤٨٢٩١٣"]) {
      const verdict = readSigningPin(typed);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok && "reason" in verdict) {
        expect(verdict.reason).toMatch(/numbers only/);
      }
    }
  });

  it("refuses the wrong number of digits, with a different reason", () => {
    const short = readSigningPin("48291");
    expect(short.ok).toBe(false);
    if (!short.ok && "reason" in short) {
      expect(short.reason).toMatch(/exactly/);
    }
  });

  it("flags an untouched field separately, so it is not scolded", () => {
    expect(readSigningPin("")).toEqual({ ok: false, untouched: true });
    expect(readSigningPin("   ")).toEqual({ ok: false, untouched: true });
  });

  it("never echoes the typed value in a refusal", () => {
    const verdict = readSigningPin("4829a3");
    if (!verdict.ok && "reason" in verdict) {
      expect(verdict.reason).not.toContain("4829");
    }
  });
});
