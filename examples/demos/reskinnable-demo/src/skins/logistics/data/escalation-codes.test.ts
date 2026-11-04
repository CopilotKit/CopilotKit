import { describe, it, expect } from "vitest";
import {
  ESCALATION_CODES,
  ESCALATION_CODE_LABELS,
  isJustifying,
  isValidEscalationCode,
} from "./escalation-codes";

describe("escalation codes", () => {
  it("accepts catalogued codes and rejects invented ones", () => {
    expect(isValidEscalationCode("CUSTOMER_COMMITMENT")).toBe(true);
    expect(isValidEscalationCode("URGENT")).toBe(false);
    expect(isValidEscalationCode("customer_commitment")).toBe(false); // case-sensitive
  });

  it("splits justifying from recorded-only codes", () => {
    expect(isJustifying("CUSTOMER_COMMITMENT")).toBe(true);
    expect(isJustifying("LINE_DOWN_RISK")).toBe(true);
    expect(isJustifying("REGULATORY_DEADLINE")).toBe(true);
    expect(isJustifying("COST_AVOIDANCE")).toBe(true);
    // Recorded for history, but they do NOT lift the authority gate.
    expect(isJustifying("PEAK_SEASON")).toBe(false);
    expect(isJustifying("INTERNAL_CONVENIENCE")).toBe(false);
  });

  it("is not justifying for an invalid code", () => {
    expect(isJustifying("NOT_A_CODE")).toBe(false);
  });

  it("labels every catalogued code", () => {
    for (const code of ESCALATION_CODES) {
      expect(ESCALATION_CODE_LABELS[code]).toBeTruthy();
    }
  });
});
