import { describe, it, expect } from "vitest";
import { VERDICT_STYLE } from "./verdict-style";
import type { GovernanceVerdict } from "./types";

const ALL_VERDICTS: GovernanceVerdict[] = [
  "reviewing",
  "allow",
  "constrain",
  "approval",
  "block",
  "halt",
  "rejected",
  "error",
];

describe("VERDICT_STYLE", () => {
  it("has an entry for every GovernanceVerdict", () => {
    for (const verdict of ALL_VERDICTS) {
      const style = VERDICT_STYLE[verdict];
      expect(style, `missing entry for verdict "${verdict}"`).toBeDefined();
      expect(style.icon, `verdict "${verdict}" has no icon`).toBeDefined();
      expect(style.label, `verdict "${verdict}" has no label`).toBeDefined();
      expect(
        style.badgeClass,
        `verdict "${verdict}" has no badgeClass`,
      ).toBeDefined();
    }
  });

  it("emits the exact human labels (label contract)", () => {
    expect(VERDICT_STYLE.reviewing.label).toBe("Reviewing");
    expect(VERDICT_STYLE.allow.label).toBe("Allowed");
    expect(VERDICT_STYLE.constrain.label).toBe("Constrained");
    expect(VERDICT_STYLE.approval.label).toBe("Approval");
    expect(VERDICT_STYLE.block.label).toBe("Blocked");
    expect(VERDICT_STYLE.halt.label).toBe("Halted");
    expect(VERDICT_STYLE.rejected.label).toBe("Rejected");
    expect(VERDICT_STYLE.error.label).toBe("Error");
  });

  it("every badgeClass is a non-empty string", () => {
    for (const verdict of ALL_VERDICTS) {
      const { badgeClass } = VERDICT_STYLE[verdict];
      expect(typeof badgeClass).toBe("string");
      expect(badgeClass.length).toBeGreaterThan(0);
    }
  });
});
