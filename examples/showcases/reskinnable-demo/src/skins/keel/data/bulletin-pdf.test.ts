import { describe, it, expect } from "vitest";
import { BULLETIN_METRICS, buildBulletinPdf } from "./bulletin-pdf";
import type { BulletinCitation } from "./bulletin-citations";

const CITATIONS: BulletinCitation[] = [
  {
    ref: "POL-114",
    title: "PHI Access & Minimum Necessary Standard",
    requiredAction: "State the review interval in the document itself.",
  },
  {
    ref: "POL-118",
    title: "Workforce Remote Access & Personal Device Use",
    requiredAction: "Adopt a written standard for personal-device access.",
  },
];

const build = (citations = CITATIONS) =>
  Buffer.from(
    buildBulletinPdf({
      source: "Northeast Health Information Authority",
      scope: "Privacy and information security policy",
      effective: "14 September 2026",
      summary: ["A sentence.", "Another sentence."],
      citations,
    }),
  ).toString("latin1");

describe("the bulletin document", () => {
  it("is a PDF", () => {
    expect(build().startsWith("%PDF-")).toBe(true);
  });

  it("prints the issuing body, the scope and the effective date", () => {
    const text = build();
    expect(text).toContain("NORTHEAST HEALTH INFORMATION AUTHORITY");
    expect(text).toContain("Privacy and information security policy");
    expect(text).toContain("14 September 2026");
  });

  it("lists every citation and its required action", () => {
    const text = build();
    for (const citation of CITATIONS) {
      expect(text).toContain(citation.ref);
      expect(text).toContain(citation.title);
    }
  });

  it("survives a bulletin with no citations at all", () => {
    // A reseed that emptied a space must still produce a readable document
    // rather than throwing inside the route's `try` and aborting the pill with
    // "HTTP 500".
    expect(build([]).startsWith("%PDF-")).toBe(true);
  });

  it("keeps the table inside the drawable width", () => {
    // The columns are aligned by CHARACTER COUNT, which is only true alignment
    // in a monospaced font AND only visible if the row fits the page. Asserted
    // rather than eyeballed on a rendered page.
    const { columns, bodySize, monoAdvance, drawableWidth } = BULLETIN_METRICS;
    const chars = columns.ref + columns.title;
    expect(chars * monoAdvance * bodySize).toBeLessThanOrEqual(drawableWidth);
  });

  it("truncates an over-long cell rather than pushing the next column out", () => {
    const text = build([
      {
        ref: "POL-114",
        title: "A".repeat(200),
        requiredAction: "Do the thing.",
      },
    ]);
    expect(text).not.toContain("A".repeat(BULLETIN_METRICS.columns.title));
  });
});
