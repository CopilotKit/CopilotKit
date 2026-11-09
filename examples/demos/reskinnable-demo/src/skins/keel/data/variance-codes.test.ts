import { describe, it, expect } from "vitest";
import {
  VARIANCE_CODES,
  VARIANCE_CODE_LABELS,
  isJustifying,
  isValidVarianceCode,
} from "./variance-codes";

/**
 * The justifying/decoy split is the whole of beat 6's unlock, and NOTHING else
 * checks it: both tiers are valid codes, both file successfully, both record in
 * the register, and only the gate can tell them apart. So the split is pinned
 * here by name rather than derived from the module under test — a test that
 * asked `isJustifying` which codes justify would agree with any answer.
 */
const JUSTIFYING = [
  "PATIENT_SAFETY_ALERT",
  "ACCREDITATION_FINDING",
  "REGULATORY_MANDATE",
  "INCIDENT_CONTAINMENT",
];

const DECOYS = ["COMMITTEE_CALENDAR", "EDITORIAL_CLEANUP"];

describe("the publication-variance catalogue", () => {
  it("is exactly the justifying codes plus the decoys", () => {
    expect([...VARIANCE_CODES].sort()).toEqual(
      [...JUSTIFYING, ...DECOYS].sort(),
    );
  });

  it("lifts the gate for every justifying code", () => {
    for (const code of JUSTIFYING) expect(isJustifying(code)).toBe(true);
  });

  it("lifts NOTHING for a decoy, though the decoy is a valid, filable code", () => {
    for (const code of DECOYS) {
      expect(isValidVarianceCode(code)).toBe(true);
      expect(isJustifying(code)).toBe(false);
    }
  });

  it("refuses an uncatalogued code, including plausible-looking ones", () => {
    for (const code of ["URGENT", "CEO_APPROVED", "", "patient_safety_alert"]) {
      expect(isValidVarianceCode(code)).toBe(false);
      expect(isJustifying(code)).toBe(false);
    }
  });

  it("labels every code, so the human filing form can never render undefined", () => {
    for (const code of VARIANCE_CODES) {
      expect(VARIANCE_CODE_LABELS[code]).toBeTruthy();
    }
  });

  it("does not spell out the unlock mechanism in any label", () => {
    // The labels are the ONE surface where this vocabulary is meant to be seen —
    // the operator's filing form. They may hedge a decoy the way logistics does
    // ("recorded only"), because a real catalogue does say what a code commits
    // you to; what they must never do is describe the RELEASE GATE, because a
    // label explaining that a code lifts a publication block is a written
    // instruction the operator no longer has to know, and the demonstration
    // becomes a guided tour.
    for (const code of VARIANCE_CODES) {
      expect(VARIANCE_CODE_LABELS[code]).not.toMatch(
        /release|unendorse|endorsement|gate|unlock/i,
      );
    }
  });
});
