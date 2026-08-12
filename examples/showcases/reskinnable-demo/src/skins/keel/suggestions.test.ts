import { describe, expect, it } from "vitest";
import { keelSuggestions } from "./suggestions";

/**
 * Guards the four demo pills (spec §10). The demo arc in §11 is scripted against
 * these exact titles and messages; a drop, reorder that loses one, or a reworded
 * message would silently break the walk-through, so the content is asserted
 * verbatim here.
 *
 * Keel has no onSuggestionSelect (unlike banking's Q2 beat), so there is no
 * string-equality matcher to protect — the value under test is simply that the
 * catalogue still carries the scripted copy.
 */
describe("keel suggestions", () => {
  it("ships exactly four pills", () => {
    expect(keelSuggestions).toHaveLength(4);
  });

  it("gives every pill a non-empty title and message", () => {
    for (const s of keelSuggestions) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.message.trim().length).toBeGreaterThan(0);
    }
  });

  it("has unique titles and unique messages", () => {
    const titles = keelSuggestions.map((s) => s.title);
    const messages = keelSuggestions.map((s) => s.message);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("carries the spec §10 copy verbatim, in order", () => {
    expect(keelSuggestions).toEqual([
      {
        title: "Contractor PHI access",
        message:
          "What's our policy on giving a contractor access to patient records?",
      },
      {
        title: "Start an access request",
        message:
          "Start a PHI access request for Priya Raman, a Radiology contractor starting Monday.",
      },
      {
        title: "What needs me?",
        message: "What's waiting on my approval?",
      },
      {
        title: "Where are we stuck?",
        message:
          "Where are requests getting stuck? Build me a view on the canvas.",
      },
    ]);
  });
});
