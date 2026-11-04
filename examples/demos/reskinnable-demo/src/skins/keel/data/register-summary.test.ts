import { describe, it, expect } from "vitest";
import { deriveRegisterKpis, summarizeRegister } from "./register-summary";
import { seedRegister } from "./register-seed";
import type { DocumentRecord } from "./types";

const NOW = Date.parse("2026-06-01T12:00:00Z");
const records = () => seedRegister(NOW);

describe("deriveRegisterKpis", () => {
  it("counts only documents with a revision in force", () => {
    // POL-311 has never been released, so it is not "in force" — counting it
    // would tell the room the library governs one more thing than it does.
    const kpis = deriveRegisterKpis(records(), NOW);
    expect(kpis.inForce).toBe(8);
  });

  it("keeps the unmeasurable count separate from the coverage figure", () => {
    const kpis = deriveRegisterKpis(records(), NOW);
    expect(kpis.coverageUnknown).toBe(1);
    expect(kpis.coveragePercent).not.toBeNull();
  });

  it("returns NULL coverage — never 0 — when nothing is measurable", () => {
    const none: DocumentRecord[] = records().map((r) => ({
      ...r,
      attestation: { assigned: 0, completed: 0 },
    }));
    const kpis = deriveRegisterKpis(none, NOW);
    expect(kpis.coveragePercent).toBeNull();
    expect(kpis.coverageUnknown).toBe(none.length);
  });

  it("weights coverage by assignment, not per document", () => {
    // An unweighted mean lets a 12-person policy at 50% drag a 1,240-person
    // policy at 100%, so the tile would not be "how much of the workforce has
    // attested" — which is what the room reads it as.
    const rows = records()
      .slice(0, 2)
      .map((r, i) => ({
        ...r,
        attestation:
          i === 0
            ? { assigned: 1000, completed: 1000 }
            : { assigned: 10, completed: 0 },
      }));
    expect(deriveRegisterKpis(rows, NOW).coveragePercent).toBe(99);
  });

  it("counts pending revisions and the blocked subset separately", () => {
    const kpis = deriveRegisterKpis(records(), NOW);
    expect(kpis.awaitingRelease).toBe(3);
    expect(kpis.unendorsed).toBe(2);
  });
});

describe("summarizeRegister obeys the beat-4 preference, verifiably", () => {
  it("groups by knowledge space in corpus order", () => {
    expect(
      summarizeRegister(records(), NOW).groups.map((g) => g.space),
    ).toEqual(["privacy", "clinical", "vendor"]);
  });

  it("leads every group with anything past its review date", () => {
    for (const group of summarizeRegister(records(), NOW).groups) {
      const firstClear = group.rows.findIndex((row) => !row.overdue);
      if (firstClear === -1) continue;
      expect(group.rows.slice(firstClear).every((row) => !row.overdue)).toBe(
        true,
      );
    }
  });

  it("orders the overdue rows by how far past due they are", () => {
    const privacy = summarizeRegister(records(), NOW).groups[0];
    const debts = privacy.rows
      .filter((r) => r.overdue)
      .map((r) => r.reviewDebtDays ?? 0);
    expect([...debts].sort((a, b) => b - a)).toEqual(debts);
  });

  it("gives coverage as a WHOLE PERCENT, and null rather than 0 when unmeasurable", () => {
    const rows = summarizeRegister(records(), NOW).groups.flatMap(
      (g) => g.rows,
    );
    for (const row of rows) {
      if (row.coveragePercent === null) continue;
      expect(Number.isInteger(row.coveragePercent)).toBe(true);
    }
    const draft = rows.find((row) => row.ref === "POL-311");
    expect(draft?.coveragePercent).toBeNull();
  });

  it("names the owning department beside every ref", () => {
    for (const row of summarizeRegister(records(), NOW).groups.flatMap(
      (g) => g.rows,
    )) {
      expect(row.owner).toBeTruthy();
    }
  });

  it("carries the caveat off the SAME tally as the counts", () => {
    const summary = summarizeRegister(records(), NOW);
    expect(summary.caveat).toContain("1 document");
    const vendor = summary.groups.find((g) => g.space === "vendor");
    expect(vendor?.coverage.unknown).toBe(1);
    expect(vendor?.caveat).toContain("1 document");
    const privacy = summary.groups.find((g) => g.space === "privacy");
    expect(privacy?.coverage.unknown).toBe(0);
    expect(privacy?.caveat).toBeNull();
  });

  it("drops a space with no documents rather than rendering an empty group", () => {
    const privacyOnly = records().filter((r) => r.space === "privacy");
    expect(
      summarizeRegister(privacyOnly, NOW).groups.map((g) => g.space),
    ).toEqual(["privacy"]);
  });
});
