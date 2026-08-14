import { describe, expect, it } from "vitest";
import {
  CARRIER_MESSAGES,
  CARRIER_MESSAGE_LABELS,
  NOTE_MARKER,
  WATCH_REASONS,
  WATCH_REASON_LABELS,
  isCarrierMessage,
  isWatchReason,
  markNote,
} from "./handling";
import { ESCALATION_CODES } from "./escalation-codes";

describe("beat 5 handling vocabulary", () => {
  it("labels every value, so no UI can name one the store accepts", () => {
    for (const reason of WATCH_REASONS) {
      expect(WATCH_REASON_LABELS[reason]).toBeTruthy();
    }
    for (const template of CARRIER_MESSAGES) {
      expect(CARRIER_MESSAGE_LABELS[template]).toBeTruthy();
    }
  });

  it("validates against the closed sets", () => {
    expect(isWatchReason("carrier-silent")).toBe(true);
    expect(isWatchReason("CARRIER_SILENT")).toBe(false);
    expect(isCarrierMessage("recovery-plan")).toBe(true);
    expect(isCarrierMessage("")).toBe(false);
  });

  /**
   * The one assertion that is about the DEMO rather than about the data.
   *
   * Beat 5's procedure and beat 6's unlock are the easiest pair in this demo for
   * the model to confuse, and the cheapest way to keep them apart is for them to
   * share no vocabulary at all. This fails if someone ever adds a watch reason or
   * a carrier template that reuses a gate code's wording.
   */
  it("shares no vocabulary with the withheld escalation catalogue", () => {
    const gate = new Set<string>(
      ESCALATION_CODES.map((c) => c.toLowerCase().replace(/_/g, "-")),
    );
    for (const value of [...WATCH_REASONS, ...CARRIER_MESSAGES]) {
      expect(gate.has(value)).toBe(false);
    }
    const gateWords = new Set(
      ESCALATION_CODES.flatMap((c) => c.toLowerCase().split("_")),
    );
    for (const value of [...WATCH_REASONS, ...CARRIER_MESSAGES]) {
      for (const word of value.split("-"))
        expect(gateWords.has(word)).toBe(false);
    }
  });
});

describe("markNote", () => {
  it("forces the marker exactly once and trims", () => {
    expect(markNote("Carrier silent.")).toBe(`${NOTE_MARKER} Carrier silent.`);
    expect(markNote("  Carrier silent.  ")).toBe(
      `${NOTE_MARKER} Carrier silent.`,
    );
    // Idempotent: a model that already prefixed one must not get two, or the
    // "make the change un-skimmable" affordance turns into visible noise.
    expect(markNote(`${NOTE_MARKER} Carrier silent.`)).toBe(
      `${NOTE_MARKER} Carrier silent.`,
    );
  });
});
