import { describe, expect, it } from "vitest";
import { buildOfferLetterPdf } from "./offer-letter-pdf";
import type { OfferLetterInput } from "./offer-letter-pdf";

/**
 * BEAT 3d's document. The offer letter is PROJECTED and then handed to the model,
 * so what it spells is part of the claim it makes.
 *
 * The regression this file exists for: the builder computed `/Length` and every
 * xref offset from JS string length (UTF-16 code units) and then emitted UTF-8,
 * while applying NO ASCII fold at all. That is not a hypothetical — the seed
 * carries `Inés Vidal` (emp-ines), `Sasha Bergström` (emp-sasha) and `Montréal`
 * (emp-bea), and `GET /api/people/v1/offer-letter?employeeId=…` reaches every one
 * of them, so the letter rendered mojibake AND a structurally wrong document.
 * Both halves disappear together once the file builds on `@/shell/documents`.
 */

const ACCENTED: OfferLetterInput = {
  name: "Inés Vidal",
  title: "Product Designer",
  level: "L4",
  team: "Design",
  managerName: "Sasha Bergström",
  location: "Montréal",
  startDate: "2026-09-01",
};

/** latin1: one byte, one character — correct for byte-offset assertions. */
const decode = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

/** The visible text, un-escaped, in draw order. */
const drawnLines = (bytes: Uint8Array) =>
  [...decode(bytes).matchAll(/^\((.*)\) Tj$/gm)].map((m) =>
    m[1].replace(/\\([()\\])/g, "$1"),
  );

describe("offer letter PDF", () => {
  it("emits only single-byte characters for an accented employee", () => {
    // Assert the BYTES, not a decoded string: once the document is ASCII the two
    // are the same thing, so a character-level check would pass for the same
    // reason the builder is correct and could never fail for the case it exists
    // to catch.
    const bytes = buildOfferLetterPdf(ACCENTED);
    const source = decode(bytes);
    const offenders = [...bytes].flatMap((byte, at) =>
      byte < 0x80
        ? []
        : [
            `0x${byte.toString(16)} at byte ${at}, near ` +
              JSON.stringify(source.slice(Math.max(0, at - 24), at + 24)),
          ],
    );
    expect(offenders.slice(0, 3), "bytes outside ASCII").toEqual([]);
  });

  it("transliterates those names rather than printing them as question marks", () => {
    // The name is what the room reads off the projector and what the agent reads
    // back, so "In?s Vidal" is a defect even though its bytes are valid ASCII.
    const drawn = drawnLines(buildOfferLetterPdf(ACCENTED));
    expect(drawn).toContain("Prepared for Ines Vidal");
    expect(drawn).toContain("Dear Ines,");
    expect(drawn).toContain("based in Montreal.");
    expect(drawn.some((l) => l.includes("Sasha Bergstrom"))).toBe(true);
  });

  it("declares a /Length that matches the content stream it wraps", () => {
    // The other half of the same defect: a stream carrying multi-byte characters
    // desynchronizes the declared length from the bytes actually written.
    const source = decode(buildOfferLetterPdf(ACCENTED));
    const declared = Number(/\/Length (\d+)/.exec(source)![1]);
    expect(/stream\n([\s\S]*?)\nendstream/.exec(source)![1].length).toBe(
      declared,
    );
  });
});
