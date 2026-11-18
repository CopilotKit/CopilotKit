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
import { VARIANCE_CODES } from "./data/variance-codes";

/**
 * BEAT 6's directive contract. Each pair is a BUILDER beside its READER, so the
 * tests here are round trips: what the recorder wrote is what the card reads back.
 * Every failure in this file is one a live demo would show as a card confidently
 * saying the wrong thing.
 */
describe("the demonstration directive", () => {
  it("round-trips the step count the RECORDER reported", () => {
    const directive = buildDemonstrationDirective({
      steps: ["Opened the variance form on POL-114 Rev D", "Filed it"],
      code: "SOME_CODE",
    });
    expect(readDemonstratedStepCount(directive)).toBe(2);
  });

  it("counts steps rather than numerals inside a step label", () => {
    // The reason the count travels inside the string at all: this skin's labels
    // carry digits constantly ("POL-114 Rev D", "3 days over"), so a card that
    // recounted the prose would miscount.
    const directive = buildDemonstrationDirective({
      steps: ["Opened POL-114 Rev D — 35 days over"],
      code: null,
    });
    expect(readDemonstratedStepCount(directive)).toBe(1);
  });

  it("reports null — never zero — for a string carrying no count", () => {
    // A thread recorded before this contract existed, or a paraphrase. "Say nothing
    // about a count" and "the operator did nothing" are different claims.
    expect(readDemonstratedStepCount("Recorded the demonstration.")).toBeNull();
    expect(readDemonstratedStepCount(undefined)).toBeNull();
    expect(readDemonstratedStepCount(42)).toBeNull();
  });

  it("carries the code the operator ACTUALLY filed, verbatim", () => {
    // Including a decoy: a recorder that quietly corrected the operator would report
    // a procedure that was never demonstrated, and the room would watch the release
    // clear for a reason nobody showed.
    const directive = buildDemonstrationDirective({
      steps: ["Filed it"],
      code: "COMMITTEE_CALENDAR",
    });
    expect(directive).toContain("COMMITTEE_CALENDAR");
  });

  it("tells the agent to ASK when no code was captured, rather than guessing", () => {
    const directive = buildDemonstrationDirective({ steps: ["x"], code: null });
    expect(directive).toContain("No code was captured");
    expect(directive).toContain("ask the operator");
  });

  it("says '(nothing captured)' rather than rendering an empty list", () => {
    const directive = buildDemonstrationDirective({ steps: [], code: null });
    expect(directive).toContain("(nothing captured)");
    expect(readDemonstratedStepCount(directive)).toBe(0);
  });
});

describe("the save directives", () => {
  it("classifies a confirmation as saved and a decline as declined", () => {
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_CONFIRMED)).toBe("saved");
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_DECLINED)).toBe(
      "declined",
    );
  });

  it("never reads a DECLINE as a save", () => {
    // Both buttons settle with a string, so branching on presence prints "Saved —
    // I'll use this next time" after the presenter clicked "Don't save": a durable
    // write asserted on stage that never happened, and it mis-renders identically on
    // every later replay.
    expect(classifySaveProcedureResult(SAVE_PROCEDURE_DECLINED)).not.toBe(
      "saved",
    );
    expect(
      classifySaveProcedureResult("The operator declined. Nothing saved."),
    ).toBe("declined");
  });

  it("returns pending for an unanswered card and unknown for an unrecognized settle", () => {
    expect(classifySaveProcedureResult(undefined)).toBe("pending");
    expect(classifySaveProcedureResult("   ")).toBe("pending");
    // An unrecognized settle is not evidence of a write, so it must never earn the
    // success receipt.
    expect(classifySaveProcedureResult("something else entirely")).toBe(
      "unknown",
    );
  });

  it("names scope 'user' and kind 'operational' in the confirmation directive", () => {
    // Load-bearing rather than stylistic: `forget-memories.ts` SKIPS project-scoped
    // rows, so a procedure saved at project scope survives every presenter reset and
    // the second run of this demo opens with the agent already knowing the answer.
    expect(SAVE_PROCEDURE_CONFIRMED).toContain("scope 'user'");
    expect(SAVE_PROCEDURE_CONFIRMED).toContain("kind 'operational'");
    expect(SAVE_PROCEDURE_CONFIRMED).not.toContain("project");
  });

  it("forbids the durable write on a decline", () => {
    expect(SAVE_PROCEDURE_DECLINED).toContain("Do not call save_memory");
  });
});

describe("the offer directives", () => {
  it("reads an acceptance and a decline apart", () => {
    expect(readOfferAccepted(OFFER_ACCEPTED)).toBe(true);
    expect(readOfferAccepted(OFFER_DECLINED)).toBe(false);
    expect(readOfferAccepted(undefined)).toBe(false);
  });

  it("tells the agent to WAIT rather than narrate the procedure", () => {
    expect(OFFER_ACCEPTED).toContain("do not guess any steps");
    expect(OFFER_ACCEPTED).toContain("do not tell them where to click");
  });

  it("stops the agent retrying the refused write on a decline", () => {
    expect(OFFER_DECLINED).toContain("do not retry");
  });
});

/**
 * THE FOURTH LEAK CHANNEL, checked at its most tempting site. This module is where
 * the code travels from the operator to the agent, so it is the natural place for
 * someone to "helpfully" hardcode a default or an example — which would hand the
 * agent the catalogue and delete the beat.
 */
describe("beat 6's withholding", () => {
  it("names no variance code as a literal anywhere in the module", () => {
    const surfaces = [
      OFFER_ACCEPTED,
      OFFER_DECLINED,
      SAVE_PROCEDURE_CONFIRMED,
      SAVE_PROCEDURE_DECLINED,
      buildDemonstrationDirective({ steps: ["x"], code: null }),
    ].join("\n");
    for (const code of VARIANCE_CODES) {
      expect(surfaces).not.toContain(code);
    }
  });
});
