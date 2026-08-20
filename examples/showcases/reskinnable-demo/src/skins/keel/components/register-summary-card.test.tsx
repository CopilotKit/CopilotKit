import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RegisterSummaryCard } from "@/skins/keel/components/register-summary-card";
import { summarizeRegister } from "@/skins/keel/data/register-summary";
import type { DocumentRecord } from "@/skins/keel/data/types";

/**
 * BEAT 4 — the card that has to be SEEN obeying the seeded reading preference.
 *
 * Four behaviours are asserted because the preference names four, and each is
 * something a reader in the room can check by looking. A card that grouped but did
 * not lead with the overdue rows would satisfy the demo's description and fail its
 * claim, silently, because nobody in the audience has the register memorized.
 *
 * The fifth assertion — the visible "why" — is the beat itself. Without the note on
 * screen a grouped list is not evidence of recall: a model with no memory at all
 * could produce one.
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

/**
 * Two spaces. In `privacy`, the OVERDUE row is deliberately listed SECOND so a
 * card that merely preserved input order would fail the ordering assertion. The
 * clinical row has nobody assigned, so its coverage is unknown rather than 0%.
 */
const REGISTER: DocumentRecord[] = [
  record({
    docId: "a",
    ref: "POL-101",
    title: "Not overdue",
    space: "privacy",
  }),
  record({
    docId: "b",
    ref: "POL-102",
    title: "Overdue one",
    space: "privacy",
    owner: "Health Information Management",
    reviewDue: "2026-01-01",
    attestation: { assigned: 100, completed: 43 },
  }),
  record({
    docId: "c",
    ref: "POL-201",
    title: "Unmeasured",
    space: "clinical",
    attestation: { assigned: 0, completed: 0 },
  }),
];

describe("RegisterSummaryCard obeys the seeded reading preference", () => {
  it("groups by knowledge space, in the corpus's own order", () => {
    render(<RegisterSummaryCard records={REGISTER} now={NOW} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Privacy");
    expect(text).toContain("Clinical");
    expect(text.indexOf("Privacy")).toBeLessThan(text.indexOf("Clinical"));
  });

  it("leads each group with the documents past their review date", () => {
    render(<RegisterSummaryCard records={REGISTER} now={NOW} />);
    const text = document.body.textContent ?? "";
    // POL-102 is overdue and arrives SECOND in the input, so a card that painted
    // input order would put it after POL-101 here.
    expect(text.indexOf("POL-102")).toBeLessThan(text.indexOf("POL-101"));
  });

  it("prints coverage as a whole percent, never a ratio", () => {
    render(<RegisterSummaryCard records={REGISTER} now={NOW} />);
    expect(screen.getByText("43% attested")).toBeTruthy();
    // Nothing on the card divides anything: a fraction or a long decimal would be
    // the preference not applied.
    expect(document.body.textContent ?? "").not.toMatch(/\d+\.\d/);
  });

  it("names the owning department beside every reference", () => {
    render(<RegisterSummaryCard records={REGISTER} now={NOW} />);
    expect(screen.getByText("Health Information Management")).toBeTruthy();
  });

  it("says coverage is NOT MEASURABLE rather than printing 0%", () => {
    // The honesty clause, and the same code path as the preference: a document
    // nobody has been assigned has unknown coverage, and painting that as zero is
    // the app telling the room a policy is unattested when nobody looked.
    render(<RegisterSummaryCard records={REGISTER} now={NOW} />);
    expect(screen.getByText("coverage not measurable")).toBeTruthy();
    // Scoped to the unmeasured ROW, not the whole card: a substring check would
    // match the perfectly legitimate "100% attested" on POL-101.
    const unmeasured = screen.getByText("Unmeasured").closest("li");
    expect(unmeasured?.textContent).toContain("coverage not measurable");
    expect(unmeasured?.textContent).not.toContain("0%");
  });

  it("renders the SAME rows summarizeRegister produced, in the same order", () => {
    // Asserted as an identity rather than against hardcoded refs: hardcoded
    // expectations pass just as happily against a card that quietly re-sorted its
    // input, which is precisely the drift that makes the preference a claim the card
    // does not honour.
    render(<RegisterSummaryCard records={REGISTER} now={NOW} />);
    const text = document.body.textContent ?? "";
    const expected = summarizeRegister(REGISTER, NOW).groups.flatMap((g) =>
      g.rows.map((r) => r.ref),
    );
    const positions = expected.map((ref) => text.indexOf(ref));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});

describe("the visible 'why' — the note slot IS the beat", () => {
  it("renders the agent's recalled preference when one is given", () => {
    render(
      <RegisterSummaryCard
        records={REGISTER}
        now={NOW}
        note="You read the register by space, with anything past its review date first."
      />,
    );
    expect(
      screen.getByText(
        "You read the register by space, with anything past its review date first.",
      ),
    ).toBeTruthy();
  });

  it("puts the note ABOVE the groups, not as a footnote", () => {
    render(
      <RegisterSummaryCard
        records={REGISTER}
        now={NOW}
        note="Recalled this."
      />,
    );
    const text = document.body.textContent ?? "";
    // A note tucked under the rows reads as a footnote and the room stops looking
    // for it. It is the claim the groups are the evidence for.
    expect(text.indexOf("Recalled this.")).toBeLessThan(
      text.indexOf("POL-102"),
    );
  });

  it("renders without a note rather than crashing, since args STREAM", () => {
    render(<RegisterSummaryCard records={REGISTER} now={NOW} />);
    expect(screen.queryByTestId("register-summary-note")).toBeNull();
    expect(screen.getByText("Overdue one")).toBeTruthy();
  });

  it("renders a 'not loaded' line rather than an empty card for an empty register", () => {
    render(<RegisterSummaryCard records={[]} now={NOW} />);
    expect(
      screen.getByText("The policy register has not loaded yet."),
    ).toBeTruthy();
  });
});
