import { describe, expect, it } from "vitest";
import {
  isJustifying,
  isValidWaiverCode,
  JUSTIFICATION_MAX_LENGTH,
  JUSTIFICATION_MIN_LENGTH,
  JUSTIFYING_WAIVER_CODES,
  MARGIN_WAIVER_CODES,
  normalizeJustification,
  waiverCodeLabel,
} from "./waiver-codes";

/**
 * BEAT 6's catalogue. These assertions exist because the beat's whole value
 * rests on a distinction that is invisible in the UI and unenforced by types:
 * some codes are VALID but do not JUSTIFY. Collapse the two and "the agent filed
 * a waiver" silently becomes "the agent cleared the gate", which still compiles,
 * still renders, and quietly turns the demonstration into theatre.
 */
describe("margin waiver codes", () => {
  it("accepts catalogued codes and rejects invented ones", () => {
    expect(isValidWaiverCode("VENDOR-FUND")).toBe(true);
    expect(isValidWaiverCode("MERCH-DISC")).toBe(true); // a decoy is still valid
    expect(isValidWaiverCode("MADE-UP")).toBe(false);
    expect(isValidWaiverCode("vendor-fund")).toBe(false); // case-sensitive
  });

  it("splits justifying codes from recorded-only decoys", () => {
    // Evidence that exists outside the conversation — these lift the gate.
    expect(isJustifying("VENDOR-FUND")).toBe(true);
    expect(isJustifying("EOL-CLEAR")).toBe(true);
    expect(isJustifying("COMP-MATCH")).toBe(true);
    // Forecasts and judgement calls with nothing on file. Recorded for history,
    // and they do NOT lift the gate.
    expect(isJustifying("MERCH-DISC")).toBe(false);
    expect(isJustifying("VOL-LIFT")).toBe(false);
    expect(isJustifying("LOYALTY")).toBe(false);
  });

  it("is not justifying for an invalid code", () => {
    expect(isJustifying("MADE-UP")).toBe(false);
  });

  it("offers decoys, so a guess cannot be right by construction", () => {
    // If every catalogued code justified, an agent that guessed would always
    // clear the gate and beat 6 would prove nothing about what it learned.
    const decoys = MARGIN_WAIVER_CODES.filter((c) => !isJustifying(c.code));
    expect(decoys.length).toBeGreaterThan(0);
    expect(JUSTIFYING_WAIVER_CODES.length).toBeLessThan(
      MARGIN_WAIVER_CODES.length,
    );
  });

  it("never reveals in its blurbs which codes justify", () => {
    // The filing UI renders these verbatim. A blurb that named the MECHANISM —
    // the gate, the floor, whether it justifies — would hand the recipe to
    // anything that can read the page.
    //
    // Deliberately narrow: an earlier version of this regex included `approv`
    // and tripped on "the approved seasonal plan", which describes the EVIDENCE
    // on file rather than the code's effect. Matching a code's justification
    // narrative is a false positive; matching the gate is the real leak.
    const tell = /justif|gate|floor|override|guarantee/i;
    for (const entry of MARGIN_WAIVER_CODES) {
      expect(entry.blurb).not.toMatch(tell);
    }
  });

  it("every justifying code is actually in the catalogue", () => {
    // A typo here would make the gate permanently unopenable.
    for (const code of JUSTIFYING_WAIVER_CODES) {
      expect(isValidWaiverCode(code)).toBe(true);
    }
  });

  it("labels every catalogued code and falls back to the raw code", () => {
    for (const entry of MARGIN_WAIVER_CODES) {
      expect(waiverCodeLabel(entry.code)).toBe(entry.label);
    }
    expect(waiverCodeLabel("MADE-UP")).toBe("MADE-UP");
  });
});

/**
 * The written justification a waiver is filed with. A justifying code with an
 * EMPTY justification used to clear beat 6's floor, which turned the paperwork
 * half of the unlock into a formality — and the field was unbounded on the way
 * into a durable store.
 */
describe("normalizeJustification", () => {
  it("accepts a real justification and trims it", () => {
    expect(normalizeJustification("  signed co-op on file  ")).toBe(
      "signed co-op on file",
    );
  });

  it("rejects the non-answers the field actually attracts", () => {
    for (const value of ["", " ", "   \n\t", "x", "-", "n/a", "ok", "none"]) {
      expect(normalizeJustification(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("measures the TRIMMED length against both bounds", () => {
    const pad = " ".repeat(20);
    expect(
      normalizeJustification(pad + "c".repeat(JUSTIFICATION_MIN_LENGTH) + pad),
    ).toHaveLength(JUSTIFICATION_MIN_LENGTH);
    // One under the floor is not saved by surrounding whitespace...
    expect(
      normalizeJustification(
        pad + "c".repeat(JUSTIFICATION_MIN_LENGTH - 1) + pad,
      ),
    ).toBeNull();
    // ...and one over the ceiling is not saved by it either.
    expect(
      normalizeJustification(pad + "c".repeat(JUSTIFICATION_MAX_LENGTH) + pad),
    ).toHaveLength(JUSTIFICATION_MAX_LENGTH);
    expect(
      normalizeJustification("c".repeat(JUSTIFICATION_MAX_LENGTH + 1)),
    ).toBeNull();
  });

  it("rejects anything that is not a string", () => {
    // The routes' house pattern is `String(body?.x ?? "")`, and `String({})` is
    // the 15-character "[object Object]" — long enough to pass any length floor.
    // That is why this takes `unknown` rather than trusting a coerced string.
    expect(String({})).toHaveLength(15); // pins the premise, not the behaviour
    const wrongTypes = [{}, [], null, undefined, 0, 12345678, true, () => {}];
    for (const value of wrongTypes) {
      expect(normalizeJustification(value)).toBeNull();
    }
  });

  it("keeps the floor below the ceiling", () => {
    expect(JUSTIFICATION_MIN_LENGTH).toBeGreaterThan(0);
    expect(JUSTIFICATION_MIN_LENGTH).toBeLessThan(JUSTIFICATION_MAX_LENGTH);
  });
});
