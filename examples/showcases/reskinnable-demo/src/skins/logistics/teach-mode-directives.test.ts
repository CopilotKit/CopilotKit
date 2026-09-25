/**
 * BEAT 6 — the two replay invariants from `docs/teach-mode/README.md`, pinned.
 *
 * Both failures are invisible at runtime: the app compiles, the cards render,
 * the demo runs, and the card simply states something the thread does not
 * support. So each assertion below round-trips a BUILDER through its READER
 * rather than asserting either half in isolation — a test that only checked the
 * regex would stay green while the directive's wording drifted out from under
 * it, which is exactly how these two rot.
 */
import { describe, expect, it } from "vitest";
import {
  OFFER_ACCEPTED,
  OFFER_DECLINED,
  SAVE_PROCEDURE_CONFIRMED,
  SAVE_PROCEDURE_DECLINED,
  buildDemonstrationDirective,
  classifySaveProcedureResult,
  readDemonstratedStepCount,
  readOfferAccepted,
} from "./teach-mode-directives";

describe("survives replay — the card prints the count the RECORDER reported", () => {
  it.each([0, 1, 2, 5])("round-trips %i steps", (n) => {
    const directive = buildDemonstrationDirective({
      steps: Array.from({ length: n }, (_, i) => `Step ${i}`),
      code: "CUSTOMER_COMMITMENT",
    });
    expect(readDemonstratedStepCount(directive)).toBe(n);
  });

  it("is not fooled by a numeral inside a step label", () => {
    // The bug this rule exists for: a card counting `/\d+\.\s/` matches in the
    // prose counts numerals the LABELS contain. Freight labels carry them
    // constantly — days saved, decimal rates, dotted references.
    const directive = buildDemonstrationDirective({
      steps: [
        "Filed the escalation at 1. 5 days from the promised date",
        "Released the expedite — 2. 4x the reroute cost",
      ],
      code: "LINE_DOWN_RISK",
    });
    expect(readDemonstratedStepCount(directive)).toBe(2);
  });

  it("carries the demonstrated code, and says so when there is none", () => {
    expect(
      buildDemonstrationDirective({ steps: ["a"], code: "COST_AVOIDANCE" }),
    ).toContain("COST_AVOIDANCE");
    // No code captured must NOT read as a successful demonstration: the agent
    // has to ask rather than invent one, which is the whole withholding.
    const none = buildDemonstrationDirective({ steps: ["a"], code: null });
    expect(none).toMatch(/no escalation code was captured/i);
    expect(none).toMatch(/ask the planner/i);
  });

  it("reports null — never zero — for a string carrying no count", () => {
    // `null` means "say nothing about a count". A directive recorded before this
    // contract existed must not make the card announce "Recorded 0 steps" over a
    // demonstration that plainly happened.
    for (const value of [undefined, null, 42, "", "Recorded the demo."]) {
      expect(readDemonstratedStepCount(value)).toBeNull();
    }
  });
});

describe("a settle is not an answer — the save card CLASSIFIES its result", () => {
  it("prints the saved receipt only for the confirmation directive", () => {
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_CONFIRMED)).toBe("saved");
  });

  it("never prints it for the decline directive", () => {
    // The exact defect this classifier replaced: branching on
    // `typeof result === "string"` claimed a durable write after "Don't save",
    // live and identically on every replay of the thread.
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_DECLINED)).toBe(
      "declined",
    );
  });

  it("treats an unsettled card as pending, not as an answer", () => {
    for (const value of [undefined, null, 1, {}, "", "   "]) {
      expect(classifySaveProcedureResult(value)).toBe("pending");
    }
  });

  it("reads a paraphrased decline as a decline", () => {
    expect(
      classifySaveProcedureResult(
        "They declined — do not call save_memory for this.",
      ),
    ).toBe("declined");
  });

  it("refuses to GUESS saved from an unrecognized settle", () => {
    // "unknown" renders as "already answered", never as a receipt. An
    // unrecognized settle is not evidence that anything was written.
    expect(classifySaveProcedureResult("ok")).toBe("unknown");
    expect(classifySaveProcedureResult("Saved it.")).toBe("unknown");
  });

  it("names user scope and operational kind in the confirmation directive", () => {
    // Scope is load-bearing: `intelligence/forget-memories.ts` deliberately
    // SKIPS project-scoped rows, so a project-scoped beat-6 procedure would
    // survive every presenter reset and the second run of the demo would open
    // already taught.
    expect(SAVE_PROCEDURE_CONFIRMED).toContain("scope 'user'");
    expect(SAVE_PROCEDURE_CONFIRMED).toContain("kind 'operational'");
    expect(SAVE_PROCEDURE_CONFIRMED).not.toContain("project");
  });
});

describe("the offer card reads its own directives", () => {
  it("round-trips both answers", () => {
    expect(readOfferAccepted(OFFER_ACCEPTED)).toBe(true);
    expect(readOfferAccepted(OFFER_DECLINED)).toBe(false);
  });

  it("does not read a non-string settle as agreement", () => {
    for (const value of [undefined, null, 1, {}]) {
      expect(readOfferAccepted(value)).toBe(false);
    }
  });

  it("keeps the wiring out of the acceptance the room can see", () => {
    // Both directives are addressed to the AGENT. The cards render a human line
    // instead — this only asserts that the strings really are instructions, so
    // nobody is tempted to print them.
    expect(OFFER_ACCEPTED).toContain("awaitDemonstration");
    expect(OFFER_DECLINED).toMatch(/stop here/i);
  });
});
