/**
 * BEAT 6's cards state only what their PRODUCER reported. These are the readers
 * that make that possible, and every one of them has a failure mode with no
 * runtime symptom short of a card lying on stage — and lying identically on every
 * later replay of the thread.
 *
 * The round trip is the point: the builder writes a string, the reader gets the
 * same number back. A card that recounted the prose instead would miscount any
 * step label containing a numeral, and Aeronova's labels carry them constantly
 * ("Re-attempted the reissue on AV3PL9").
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

describe("the demonstration directive", () => {
  it("round-trips the step count the recorder observed", () => {
    for (const n of [0, 1, 2, 5, 12]) {
      const steps = Array.from({ length: n }, (_, i) => `Step ${i + 1}`);
      const directive = buildDemonstrationDirective({ steps, code: "X_CODE" });
      expect(readDemonstratedStepCount(directive)).toBe(n);
    }
  });

  it("pluralizes honestly, and the reader tolerates both", () => {
    expect(buildDemonstrationDirective({ steps: ["one"], code: null })).toMatch(
      /finished after 1 step\./,
    );
    expect(
      buildDemonstrationDirective({ steps: ["a", "b"], code: null }),
    ).toMatch(/finished after 2 steps\./);
    expect(
      readDemonstratedStepCount(
        buildDemonstrationDirective({ steps: ["one"], code: null }),
      ),
    ).toBe(1);
  });

  it("cannot be fooled by a numeral inside a step label", () => {
    // The reason the count travels inside the string at all. Anchored at the START
    // of the result, so nothing in a free-text label can be mistaken for it.
    const directive = buildDemonstrationDirective({
      steps: ["Filed 3 exceptions on AV3PL9 — 12 minutes late"],
      code: null,
    });
    expect(readDemonstratedStepCount(directive)).toBe(1);
  });

  it("reports the category the human ACTUALLY filed, decoy and all", () => {
    // A recorder that quietly corrected the passenger would report a procedure
    // nobody demonstrated. The decoy has to survive to the agent verbatim.
    expect(
      buildDemonstrationDirective({ steps: ["x"], code: "CHANGED_PLANS" }),
    ).toContain("CHANGED_PLANS");
  });

  it("asks rather than guesses when no category was captured", () => {
    // `null` is what a stranded bracket produces. Saving something anyway would
    // persist a procedure with a hole in it.
    const directive = buildDemonstrationDirective({ steps: ["x"], code: null });
    expect(directive).toMatch(/No exception category was captured/);
    expect(directive).toMatch(/ask the passenger/);
  });

  it("says something for an EMPTY demonstration rather than nothing", () => {
    const directive = buildDemonstrationDirective({ steps: [], code: null });
    expect(directive).toContain("(nothing captured)");
    expect(readDemonstratedStepCount(directive)).toBe(0);
  });

  it("returns null — never zero — for a string carrying no count", () => {
    // `null` means "say nothing about a count". A thread recorded before this
    // contract existed must not render as "Recorded 0 steps".
    for (const value of [
      undefined,
      null,
      42,
      "",
      "The planner finished after 3 steps.",
      "I watched you do three things.",
    ]) {
      expect(readDemonstratedStepCount(value)).toBeNull();
    }
  });
});

describe("the save-procedure directives", () => {
  it("classifies each button's own settle", () => {
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_CONFIRMED)).toBe("saved");
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_DECLINED)).toBe(
      "declined",
    );
  });

  it("never reads a DECLINE as a save", () => {
    // The defect this exists for: both buttons settle with a string, so branching
    // on presence prints "Saved — I'll use this next time" after the presenter
    // clicked "Don't save" — a durable write asserted on stage that never happened.
    expect(SAVE_PROCEDURE_DECLINED).toMatch(/Do not call save_memory/);
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_DECLINED)).not.toBe(
      "saved",
    );
    expect(
      classifySaveProcedureResult("They declined, so nothing was saved."),
    ).toBe("declined");
  });

  it("treats an unrecognized settle as unknown, never as success", () => {
    expect(classifySaveProcedureResult("ok")).toBe("unknown");
    expect(classifySaveProcedureResult("Something else entirely")).toBe(
      "unknown",
    );
  });

  it("treats a non-string or blank settle as still pending", () => {
    for (const value of [undefined, null, 0, {}, "", "   "]) {
      expect(classifySaveProcedureResult(value)).toBe("pending");
    }
  });

  it("names the scope and kind, because the wrong bucket breaks the reset", () => {
    // `user`, not `project`: `forget-memories.ts` skips project rows, so a
    // project-scoped procedure survives every presenter reset and the SECOND run
    // opens with the concierge already knowing the answer.
    expect(SAVE_PROCEDURE_CONFIRMED).toContain("scope 'user'");
    expect(SAVE_PROCEDURE_CONFIRMED).toContain("kind 'operational'");
    expect(SAVE_PROCEDURE_CONFIRMED).not.toContain("project");
  });
});

describe("the offer directives", () => {
  it("reads the accepted branch and only that branch", () => {
    expect(readOfferAccepted(OFFER_ACCEPTED)).toBe(true);
    expect(readOfferAccepted(OFFER_DECLINED)).toBe(false);
    for (const value of [undefined, null, 7, ""]) {
      expect(readOfferAccepted(value)).toBe(false);
    }
  });

  it("tells the agent to WAIT rather than narrate the procedure", () => {
    expect(OFFER_ACCEPTED).toMatch(/do not guess any steps/i);
    expect(OFFER_ACCEPTED).toMatch(/do not tell them where to click/i);
    expect(OFFER_DECLINED).toMatch(/do not retry the refused reissue/i);
  });
});

describe("the withheld vocabulary", () => {
  it("names no fare-exception category in any directive", () => {
    // This module's output IS a tool result, so a category baked in here would be
    // read straight into the model's context. The one it reports is passed in at
    // runtime, from what the passenger filed.
    const all = [
      OFFER_ACCEPTED,
      OFFER_DECLINED,
      SAVE_PROCEDURE_CONFIRMED,
      SAVE_PROCEDURE_DECLINED,
      buildDemonstrationDirective({ steps: ["x"], code: null }),
    ].join("\n");
    for (const code of [
      "SCHEDULE_CHANGE_TRIGGERED",
      "MEDICAL_DOCUMENTED",
      "BEREAVEMENT_DOCUMENTED",
      "MILITARY_ORDERS",
      "CHANGED_PLANS",
      "FOUND_LOWER_FARE",
      "ELITE_COURTESY",
    ]) {
      expect(all, `${code} reaches the agent`).not.toContain(code);
    }
  });
});
