import { describe, expect, it } from "vitest";
import {
  plannerPinGuidance,
  readPlannerPin,
} from "@/skins/logistics/data/planner-pin";

describe("plannerPinGuidance", () => {
  it("prints a length the predicate actually accepts", () => {
    const { length } = plannerPinGuidance();
    const accepted = readPlannerPin("1".repeat(length));
    expect(accepted.ok).toBe(true);
  });

  it("says that same figure in the HINT — the only text the card shows", () => {
    // The test above ties the predicate to `length`, which the card uses only as
    // the input's `maxLength`. What the planner READS is `hint`. Without this
    // assertion, `hint: "Your 4-digit approval PIN"` beside `length: 6` keeps the
    // whole suite green while the card advertises a format it refuses — which is
    // the exact failure this module's header says it exists to prevent.
    const { hint, length } = plannerPinGuidance();
    expect(hint).toContain(String(length));
  });
});

describe("readPlannerPin", () => {
  it("accepts the exact expected length", () => {
    expect(readPlannerPin("482913")).toEqual({ ok: true, pin: "482913" });
  });

  it("tolerates surrounding whitespace", () => {
    expect(readPlannerPin("  482913 ")).toEqual({ ok: true, pin: "482913" });
  });

  it("reports an untouched field separately from a bad one", () => {
    // An untouched field must not be scolded — the card renders before the
    // planner has typed anything.
    expect(readPlannerPin("")).toEqual({ ok: false, untouched: true });
    expect(readPlannerPin("   ")).toEqual({ ok: false, untouched: true });
  });

  it("REFUSES rather than rewrites anything it cannot read", () => {
    // The typed value IS the write. A parser that strips what it does not
    // recognise turns "-4829" into a real authorization.
    for (const bad of [
      "-482913",
      "48 29 13",
      "4829",
      "4829134",
      "48291a",
      "4.82913",
      "1e5",
    ]) {
      const verdict = readPlannerPin(bad);
      expect(verdict.ok).toBe(false);
      expect(verdict).not.toHaveProperty("untouched");
      expect(typeof (verdict as { reason: string }).reason).toBe("string");
    }
  });

  it("gives a refusal the card can say out loud", () => {
    const verdict = readPlannerPin("4829");
    expect((verdict as { reason: string }).reason).toMatch(/6 digits/);
  });
});
