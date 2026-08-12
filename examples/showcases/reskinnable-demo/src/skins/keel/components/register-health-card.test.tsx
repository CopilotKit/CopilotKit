import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RegisterHealthCard } from "@/skins/keel/components/register-health-card";
import { deriveRegisterKpiTiles } from "@/skins/keel/components/register-kpis";
import type { DocumentRecord } from "@/skins/keel/data/types";

/**
 * BEAT 1 (the face) and the half of BEAT 2 this card owns.
 *
 * The card takes NO figures. Everything on it is re-derived from the register it
 * is handed, through the SAME `deriveRegisterKpiTiles` the Policy Register page's
 * strip and its beat-3b readable call. The test asserts that identity rather than
 * hardcoding numbers, because hardcoded expectations pass just as happily against
 * a card that quietly computed its own — which is the drift that puts one figure
 * in the transcript and a different one on the page behind it.
 *
 * Replay-safety here is the weaker property: the card must not go BLANK on a
 * reopened thread. It reads no `status` and recovers nothing from a tool
 * `result`, so it cannot — and that is what the "renders with only a register"
 * case pins.
 */

afterEach(() => cleanup());

const NOW = Date.parse("2026-08-12T00:00:00.000Z");

const record = (over: Partial<DocumentRecord>): DocumentRecord => ({
  docId: "doc",
  ref: "POL-001",
  title: "A policy",
  space: "privacy",
  owner: "Privacy Office",
  status: "published",
  effectiveRevision: "Rev A",
  lastReviewed: "2025-01-01",
  reviewDue: "2027-01-01",
  attestation: { assigned: 100, completed: 100 },
  ...over,
});

/** Two spaces, one overdue row, one document nobody has been assigned. */
const REGISTER: DocumentRecord[] = [
  record({ docId: "a", ref: "POL-101", space: "privacy" }),
  record({
    docId: "b",
    ref: "POL-102",
    space: "privacy",
    // Past its review date at NOW — the review-debt tile and the tinted segment
    // of the privacy bar both have to see it.
    reviewDue: "2026-01-01",
    attestation: { assigned: 100, completed: 40 },
  }),
  record({
    docId: "c",
    ref: "POL-201",
    space: "clinical",
    // Nobody assigned ⇒ coverage is UNKNOWN, not 0%.
    attestation: { assigned: 0, completed: 0 },
  }),
];

describe("RegisterHealthCard (beat 1)", () => {
  it("prints the same tile values the Register page's strip derives", () => {
    render(<RegisterHealthCard records={REGISTER} now={NOW} />);

    // The card's figures are ASSERTED AGAINST THE DERIVATION, not against
    // literals: that is the only form of this test that fails when the card
    // starts computing its own.
    for (const tile of deriveRegisterKpiTiles(REGISTER, NOW)) {
      const label = screen.getByText(tile.label);
      expect(label).toBeTruthy();
      // Label and value live in the same tile, so the tile's text carries both.
      expect(label.parentElement?.textContent).toContain(tile.value);
    }
  });

  it("groups by knowledge space and names the review debt per group", () => {
    render(<RegisterHealthCard records={REGISTER} now={NOW} />);

    expect(screen.getByText("Privacy")).toBeTruthy();
    expect(screen.getByText("Clinical")).toBeTruthy();
    // Privacy holds both privacy rows, one of them overdue.
    expect(screen.getByText(/2 documents · 1 past review/)).toBeTruthy();
    // Clinical has no review debt, so no "past review" clause is invented.
    expect(screen.getByText("1 document")).toBeTruthy();
  });

  it("carries the unmeasurable-coverage caveat rather than reporting 0%", () => {
    render(<RegisterHealthCard records={REGISTER} now={NOW} />);
    // A document nobody has been assigned has UNKNOWN coverage. The caveat
    // sentence is the honest half of the coverage tile, and it comes from the
    // same tri-state `data/attention.ts` models, so the figure and its caveat
    // cannot disagree.
    expect(
      screen.getByText(/attestation coverage is not measurable/i),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("Attestation coverage");
  });

  it("prints 'Not measured' when NOTHING in the register is measurable", () => {
    const unmeasurable = [
      record({
        docId: "x",
        ref: "POL-301",
        attestation: { assigned: 0, completed: 0 },
      }),
    ];
    render(<RegisterHealthCard records={unmeasurable} now={NOW} />);
    // Never "0%": that would be the app telling the room a policy is unattested
    // when the truth is that nobody looked.
    expect(screen.getByText("Not measured")).toBeTruthy();
    expect(document.body.textContent).not.toContain("0%");
  });

  it("renders the agent's note as prose beside the derived figures", () => {
    render(
      <RegisterHealthCard
        records={REGISTER}
        now={NOW}
        note="Privacy carries the review debt."
      />,
    );
    expect(screen.getByText("Privacy carries the review debt.")).toBeTruthy();
  });

  it("says the register has not loaded rather than drawing an empty board", () => {
    render(<RegisterHealthCard records={[]} now={NOW} />);
    expect(screen.getByText(/has not loaded yet/i)).toBeTruthy();
  });

  /**
   * BEAT 2. The card is a pure function of the register plus the snapshot's
   * instant — no tool `status`, no recorded `result`, no client state that only
   * existed during the live call. So a reopened thread repaints it from the
   * ledger instead of showing a blank frame where the chart was.
   */
  it("renders from a register alone, with no tool status or result", () => {
    render(<RegisterHealthCard records={REGISTER} now={NOW} />);
    expect(screen.getByText("Policy library health")).toBeTruthy();
    expect(screen.getAllByText(/document/i).length).toBeGreaterThan(0);
  });
});
