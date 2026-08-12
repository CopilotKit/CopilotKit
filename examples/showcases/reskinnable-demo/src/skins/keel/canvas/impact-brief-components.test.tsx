import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  BriefCitations,
  BriefImpacts,
  BriefMeta,
  impactBriefDefinitions,
  impactBriefRenderers,
} from "./impact-brief-components";
import type { BriefCitationRow } from "./impact-brief-ops";

afterEach(() => cleanup());

/**
 * The a2ui runtime hands a renderer `{ props, children, ... }`; only `props` is
 * read by any of these three, so mount them with a props bag directly rather
 * than standing up a provider that would hide what is being asserted.
 */
const rowsProps = (rows: BriefCitationRow[]) =>
  ({ props: { rows } }) as Parameters<typeof BriefCitations>[0];

const CARRIED: BriefCitationRow = {
  ref: "POL-114",
  title: "PHI Access & Minimum Necessary",
  currentRevision: "Rev C",
  requiredAction: "State the review interval in the document itself.",
  carried: true,
};

const UNCARRIED: BriefCitationRow = {
  ref: "POL-118",
  title: "Workforce Remote Access & Personal Device Use",
  requiredAction:
    "Adopt a written standard for personal-device access to PHI, or record " +
    "why the organization permits none.",
  carried: false,
};

const NEVER_RELEASED: BriefCitationRow = {
  ref: "POL-311",
  title: "Vendor Offboarding & Data Return",
  requiredAction: "Record the evidence retained.",
  carried: true,
};

describe("BriefCitations", () => {
  it("draws the uncarried row as a finding, not as a missing value", () => {
    render(BriefCitations(rowsProps([CARRIED, UNCARRIED])));

    // The row the beat rests on: a policy the bulletin named that the library
    // does not hold. It must be visibly different from a document the desk has.
    const badge = screen.getByTestId("brief-uncarried-badge");
    expect(badge.textContent).toBe("Not in the library");

    const rows = screen.getAllByTestId("brief-citation-row");
    expect(rows.map((r) => r.getAttribute("data-ref"))).toEqual([
      "POL-114",
      "POL-118",
    ]);
    expect(rows.map((r) => r.getAttribute("data-carried"))).toEqual([
      "true",
      "false",
    ]);
    // Exactly one badge — a second would mean a carried row was drawn as absent.
    expect(screen.getAllByTestId("brief-uncarried-badge")).toHaveLength(1);
  });

  it("prints the bulletin's own required action for every row", () => {
    render(BriefCitations(rowsProps([CARRIED, UNCARRIED])));
    // Verbatim, unwrapped and untruncated: this sentence is the half of the
    // brief only a reader of the attachment could have written.
    expect(screen.getByText(UNCARRIED.requiredAction)).toBeTruthy();
    expect(screen.getByText(CARRIED.requiredAction)).toBeTruthy();
  });

  it("tells 'never released' apart from 'not in the library'", () => {
    render(BriefCitations(rowsProps([NEVER_RELEASED, UNCARRIED])));
    // Two different facts that would share a rendering if the column were
    // `currentRevision ?? "—"`; `POST /briefs` goes out of its way not to merge
    // them, and the canvas must not merge them back.
    expect(screen.getByText("Never released")).toBeTruthy();
    expect(screen.getByText("Not in the library")).toBeTruthy();
    expect(screen.getAllByTestId("brief-uncarried-badge")).toHaveLength(1);
  });

  it("shows the register's in-force revision for a carried, released document", () => {
    render(BriefCitations(rowsProps([CARRIED])));
    expect(screen.getByText("Rev C")).toBeTruthy();
    expect(screen.queryByTestId("brief-uncarried-badge")).toBeNull();
  });

  it("says so rather than rendering an empty table when the bulletin named nothing", () => {
    render(BriefCitations(rowsProps([])));
    expect(screen.queryByTestId("brief-citations")).toBeNull();
    expect(screen.getByText("The bulletin named no policies.")).toBeTruthy();
  });
});

describe("BriefMeta", () => {
  const props = {
    source: "Northeast Health Information Authority",
    space: "privacy",
    effective: "1 October 2026",
    filedBy: "Sam Okafor",
    role: "Privacy Officer",
    filedAt: "2026-08-12T09:00:00.000Z",
  };

  it("prints the document's effective date verbatim", () => {
    render(BriefMeta({ props } as Parameters<typeof BriefMeta>[0]));
    // The regulator's own words. Reformatting it here would be the app editing a
    // statement it carried across verbatim through the route and the store.
    expect(screen.getByText("1 October 2026")).toBeTruthy();
    expect(
      screen.getByText("Northeast Health Information Authority"),
    ).toBeTruthy();
    expect(screen.getByText("Privacy")).toBeTruthy();
    expect(screen.getByText("Sam Okafor")).toBeTruthy();
  });

  it("formats the filing timestamp with the skin's pinned formatter", () => {
    render(BriefMeta({ props } as Parameters<typeof BriefMeta>[0]));
    // Locale and zone are pinned in `pages/format-date.ts` so server render and
    // hydration agree; asserting the label keeps that dependency visible.
    expect(screen.getByText("Aug 12, 2026, UTC")).toBeTruthy();
  });

  it("prints an unknown space rather than a blank cell", () => {
    render(
      BriefMeta({
        props: { ...props, space: "supply-chain" },
      } as Parameters<typeof BriefMeta>[0]),
    );
    expect(screen.getByText("supply-chain")).toBeTruthy();
  });
});

describe("BriefImpacts", () => {
  it("lists the desk's follow-ups in order", () => {
    render(
      BriefImpacts({
        props: { items: ["Assess each listed document", "Record it"] },
      } as Parameters<typeof BriefImpacts>[0]),
    );
    const items = screen.getByTestId("brief-impacts").querySelectorAll("li");
    expect([...items].map((li) => li.textContent)).toEqual([
      "Assess each listed document",
      "Record it",
    ]);
  });

  it("renders nothing at all when there are none", () => {
    render(
      BriefImpacts({ props: { items: [] } } as Parameters<
        typeof BriefImpacts
      >[0]),
    );
    expect(screen.queryByTestId("brief-impacts")).toBeNull();
  });
});

describe("the catalog contribution", () => {
  it("supplies a renderer for every definition and no orphans", () => {
    // A definition with no renderer renders blank; a renderer with no definition
    // is never reachable. Both fail silently on the canvas.
    expect(Object.keys(impactBriefRenderers).sort()).toEqual(
      Object.keys(impactBriefDefinitions).sort(),
    );
  });
});
