import { describe, it, expect } from "vitest";
import {
  ATTENTION_CLASSES,
  COVERAGE_TARGET,
  COVERAGE_WORKLIST_RANK,
  attentionClasses,
  coverageCaveat,
  coveragePercent,
  coverageRatio,
  coverageStatus,
  hasUnendorsedRevision,
  isReviewOverdue,
  missingEndorsements,
  nullableCoverageShort,
  reviewDebtDays,
  tallyCoverage,
} from "./attention";
import type { DocumentRecord } from "./types";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const iso = (days: number) =>
  new Date(NOW + days * 86_400_000).toISOString().slice(0, 10);

const doc = (patch: Partial<DocumentRecord> = {}): DocumentRecord => ({
  docId: "d",
  ref: "POL-001",
  title: "A policy",
  space: "privacy",
  owner: "Privacy Office",
  status: "published",
  effectiveRevision: "Rev A",
  lastReviewed: iso(-100),
  reviewDue: iso(100),
  attestation: { assigned: 100, completed: 100 },
  ...patch,
});

describe("coverage is a tri-state, never a boolean", () => {
  it("reports UNKNOWN — not 0% and not compliant — when nobody is assigned", () => {
    const record = doc({ attestation: { assigned: 0, completed: 0 } });
    expect(coverageRatio(record)).toBeNull();
    expect(coverageStatus(record)).toBe("unknown");
    expect(coveragePercent(record)).toBeNull();
    // The whole point: NOT `false`. A model cannot discount what you omitted and
    // will restate a `false` as an all-clear, out loud.
    expect(nullableCoverageShort(record)).toBeNull();
  });

  it("reports short below the target and clear at or above it", () => {
    const short = doc({ attestation: { assigned: 100, completed: 89 } });
    const exactly = doc({
      attestation: { assigned: 100, completed: COVERAGE_TARGET * 100 },
    });
    expect(coverageStatus(short)).toBe("short");
    expect(nullableCoverageShort(short)).toBe(true);
    expect(coverageStatus(exactly)).toBe("clear");
    expect(nullableCoverageShort(exactly)).toBe(false);
  });

  it("declines a shape it cannot compute with rather than dividing", () => {
    // Reachable: the record arrives on the client through an unvalidated cast.
    const nonsense = doc({
      attestation: { assigned: Number.NaN, completed: 10 },
    });
    expect(coverageStatus(nonsense)).toBe("unknown");
    const negative = doc({ attestation: { assigned: 10, completed: -1 } });
    expect(coverageStatus(negative)).toBe("unknown");
  });

  it("rounds to a whole percent, which is what the readable must also quote", () => {
    expect(
      coveragePercent(
        doc({ attestation: { assigned: 1240, completed: 1102 } }),
      ),
    ).toBe(89);
  });

  it("caps a ratio at 1 so an over-count cannot print 110%", () => {
    expect(
      coveragePercent(doc({ attestation: { assigned: 10, completed: 12 } })),
    ).toBe(100);
  });
});

describe("tallies and caveats come off one derivation", () => {
  it("counts unknown separately so a green 0 cannot mean 'we did not look'", () => {
    const tally = tallyCoverage([
      doc({ attestation: { assigned: 10, completed: 1 } }),
      doc({ attestation: { assigned: 10, completed: 10 } }),
      doc({ attestation: { assigned: 0, completed: 0 } }),
    ]);
    expect(tally).toEqual({ short: 1, clear: 1, unknown: 1 });
  });

  it("returns null rather than a caveat when everything is measurable", () => {
    expect(coverageCaveat(0)).toBeNull();
  });

  it("names the count and pluralizes it", () => {
    expect(coverageCaveat(1)).toContain("1 document have");
    expect(coverageCaveat(3)).toContain("3 documents");
    expect(coverageCaveat(2, "policy")).toContain("2 policys");
  });
});

describe("review debt", () => {
  it("is overdue only when the due date is in the past", () => {
    expect(isReviewOverdue(doc({ reviewDue: iso(-1) }), NOW)).toBe(true);
    expect(isReviewOverdue(doc({ reviewDue: iso(1) }), NOW)).toBe(false);
  });

  it("treats an unparseable date as UNKNOWN, not as overdue", () => {
    // An unknown rendered as a red flag is the same lie as a false all-clear.
    expect(isReviewOverdue(doc({ reviewDue: "not-a-date" }), NOW)).toBe(false);
    expect(reviewDebtDays(doc({ reviewDue: "not-a-date" }), NOW)).toBeNull();
  });

  it("counts days past due, and days remaining as a negative", () => {
    expect(reviewDebtDays(doc({ reviewDue: iso(-10) }), NOW)).toBe(10);
    expect(reviewDebtDays(doc({ reviewDue: iso(10) }), NOW)).toBe(-10);
  });
});

describe("endorsements", () => {
  const pending = (endorsed: boolean) => ({
    label: "Rev D",
    stage: "draft" as const,
    summary: "s",
    authoredBy: "a",
    requiredEndorsements: [
      { body: "Privacy Officer", endorsedAt: "2026-05-01T00:00:00Z" },
      ...(endorsed
        ? [
            {
              body: "Policy Governance Committee",
              endorsedAt: "2026-05-02T00:00:00Z",
            },
          ]
        : [{ body: "Policy Governance Committee" }]),
    ],
  });

  it("names only the bodies that have not signed, in list order", () => {
    expect(
      missingEndorsements(doc({ pendingRevision: pending(false) })),
    ).toEqual(["Policy Governance Committee"]);
    expect(
      missingEndorsements(doc({ pendingRevision: pending(true) })),
    ).toEqual([]);
  });

  it("has no unendorsed revision when there is no pending revision at all", () => {
    expect(hasUnendorsedRevision(doc())).toBe(false);
    expect(missingEndorsements(doc())).toEqual([]);
  });
});

describe("attention classes", () => {
  it("are not exclusive — one row can carry all three", () => {
    const record = doc({
      reviewDue: iso(-5),
      attestation: { assigned: 100, completed: 50 },
      pendingRevision: {
        label: "Rev D",
        stage: "draft",
        summary: "s",
        authoredBy: "a",
        requiredEndorsements: [{ body: "Policy Governance Committee" }],
      },
    });
    expect(attentionClasses(record, NOW)).toEqual([...ATTENTION_CLASSES]);
  });

  it("does NOT put an unmeasurable row in the attestation-short worklist", () => {
    // "short" would tell the desk we checked and found a gap. We did not check.
    const record = doc({ attestation: { assigned: 0, completed: 0 } });
    expect(attentionClasses(record, NOW)).toEqual([]);
  });

  it("gives a clean row no classes at all", () => {
    expect(attentionClasses(doc(), NOW)).toEqual([]);
  });
});

describe("the worklist rank places unknown EXPLICITLY", () => {
  it("sorts short before unknown before clear", () => {
    expect(COVERAGE_WORKLIST_RANK.short).toBeLessThan(
      COVERAGE_WORKLIST_RANK.unknown,
    );
    expect(COVERAGE_WORKLIST_RANK.unknown).toBeLessThan(
      COVERAGE_WORKLIST_RANK.clear,
    );
  });
});
