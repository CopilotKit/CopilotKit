import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keelSuggestions } from "./suggestions";
import { BULLETIN_MESSAGE } from "./attach-bulletin";
import keel from "./skin";
import { VARIANCE_CODES } from "./data/variance-codes";

/**
 * The pills are the demo's script — the presenter should never have to type
 * (`demo-beats.md` § Presentation requirements), so a dropped, reordered or
 * reworded pill breaks the walk-through silently.
 *
 * Two things here are load-bearing beyond "the copy is still right":
 *
 *  1. The beat-3d pill's message must be `BULLETIN_MESSAGE` BY IDENTITY, because
 *     `skin.tsx`'s `onSuggestionSelect` matches on that exact string. A retyped
 *     sentence takes the default send path, which DROPS attachments — the model
 *     then invents the bulletin's contents and files a durable brief that reads
 *     perfectly and proves the opposite of the beat. Asserted through the real
 *     `onSuggestionSelect`, not by string comparison, so it fails if EITHER side
 *     drifts.
 *  2. Keel's original four identity pills must survive verbatim: spec §11's
 *     walk-through is scripted against their copy.
 */
/**
 * `onSuggestionSelect` is exercised for real below rather than string-compared, so
 * the beat-3d path actually runs `sendBulletinMessage`. In jsdom there is no chat
 * composer, so it correctly reports the failure through `window.alert` — which jsdom
 * does not implement and would otherwise print a stack trace per run. Stubbed, not
 * avoided: the alert firing is the attach chain behaving as designed, and the
 * assertion that matters is the `true` it returns.
 */
beforeEach(() => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("keel suggestions", () => {
  it("ships one pill per beat plus the four identity asks", () => {
    // Twelve rather than the beat map's "eight to nine" — see the arithmetic in
    // suggestions.ts's header. Asserted exactly so a silently dropped pill fails.
    expect(keelSuggestions).toHaveLength(12);
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

  it("keeps keel's four identity pills verbatim (spec §10 copy)", () => {
    const byTitle = new Map(keelSuggestions.map((s) => [s.title, s.message]));
    expect(byTitle.get("Contractor PHI access")).toBe(
      "What's our policy on giving a contractor access to patient records?",
    );
    expect(byTitle.get("Start an access request")).toBe(
      "Start a PHI access request for Priya Raman, a Radiology contractor starting Monday.",
    );
    expect(byTitle.get("What needs me?")).toBe(
      "What's waiting on my approval?",
    );
    expect(byTitle.get("Where are we stuck?")).toBe(
      "Where are requests getting stuck? Build me a view on the canvas.",
    );
  });

  it("walks the beats in demo order", () => {
    // The ORDER is the script: gen-UI face first, teach-a-procedure last before the
    // two standing identity asks. A reorder that still contains every pill would
    // pass every other test in this file.
    expect(keelSuggestions.map((s) => s.title)).toEqual([
      "How healthy is the library?",
      "Contractor PHI access",
      "Start an access request",
      "Release the STD-045 revision",
      "What am I looking at?",
      "What's overdue for review?",
      "Read this bulletin",
      "Summarize the library",
      "POL-121 is out of date",
      "Release the POL-114 revision",
      "What needs me?",
      "Where are we stuck?",
    ]);
  });

  it("carries the beat-3d message BY IDENTITY, and onSuggestionSelect claims it", () => {
    const pill = keelSuggestions.find((s) => s.title === "Read this bulletin");
    expect(pill).toBeDefined();
    expect(pill!.message).toBe(BULLETIN_MESSAGE);
    // Through the real interceptor: `true` means the shell must not run its default
    // send, which is what keeps the attachment on the message.
    expect(keel.onSuggestionSelect?.(pill!, 6)).toBe(true);
  });

  it("lets every OTHER pill take the default send path", () => {
    for (const [index, pill] of keelSuggestions.entries()) {
      if (pill.message === BULLETIN_MESSAGE) continue;
      expect(
        keel.onSuggestionSelect?.(pill, index),
        `${pill.title} was intercepted, so its message is silently not sent`,
      ).toBe(false);
    }
  });

  it("targets DIFFERENT documents for the beat-3a, beat-6 and beat-5 pills", () => {
    // STD-045 Rev B is fully endorsed (3a clears), POL-114 Rev D is gated (6 is
    // refused and taught), POL-208 Rev C is the unaided replay and deliberately has
    // no pill. Pointing two of these at one document collapses the contrast the
    // whole arc rests on.
    const messages = keelSuggestions.map((s) => s.message).join("\n");
    expect(messages).toContain("STD-045");
    expect(messages).toContain("POL-114");
    expect(messages).toContain("POL-121");
    // The replay is unscripted on purpose — a pill would let the room suspect it was
    // rehearsed.
    expect(messages).not.toContain("POL-208");
  });

  it("says Register, never Knowledge — the nav label changed", () => {
    // The SEGMENT is still `knowledge`; the label is not. A pill saying "Knowledge"
    // would name a page that appears nowhere on screen.
    const text = keelSuggestions
      .map((s) => `${s.title} ${s.message}`)
      .join("\n");
    expect(text).not.toMatch(/\bKnowledge\b/);
  });

  it("names no publication-variance code", () => {
    // The pills are prose the MODEL receives when a pill is clicked, so they are the
    // prompt's leak channel by another route. Beat 6's whole point is that the agent
    // has to be taught the code.
    const text = keelSuggestions
      .map((s) => `${s.title} ${s.message}`)
      .join("\n");
    for (const code of VARIANCE_CODES) {
      expect(text).not.toContain(code);
    }
  });
});
