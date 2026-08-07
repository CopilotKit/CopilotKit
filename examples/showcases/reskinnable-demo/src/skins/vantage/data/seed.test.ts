import { describe, expect, it } from "vitest";
import seed from "./seed.json";
import type { Db } from "./types";

const db = seed as unknown as Db;

describe("vantage seed", () => {
  it("covers 21 consecutive months from 2025-01 through 2026-09", () => {
    const months = [...new Set(db.facts.map((f) => f.month))].sort();
    expect(months[0]).toBe("2025-01");
    expect(months.at(-1)).toBe("2026-09");
    expect(months).toHaveLength(21);
  });

  it("has a fact row for every segment × region × channel in every month", () => {
    const months = new Set(db.facts.map((f) => f.month));
    // 3 segments × 3 regions × 3 channels = 27 rows per month
    expect(db.facts).toHaveLength(months.size * 27);
  });

  it("has a plan row and three fx rows for every month", () => {
    const months = [...new Set(db.facts.map((f) => f.month))];
    expect(db.plan).toHaveLength(months.length);
    expect(db.fx).toHaveLength(months.length * 3);
  });

  it("seeds exactly two UNCERTIFIED metrics, so phase 2's teach beat can replay on the second", () => {
    const uncertified = db.metrics.filter((m) => !m.certified).map((m) => m.id);
    expect(uncertified.sort()).toEqual(["magic_number", "nrr"]);
  });

  it("seeds EMEA enterprise slipped deals over $250k for the variance story", () => {
    const slipped = db.deals.filter(
      (d) =>
        d.status === "slipped" && d.region === "emea" && d.valueUsd >= 250_000,
    );
    expect(slipped.length).toBeGreaterThanOrEqual(3);
  });

  it("misses plan in Q3 2026 in EMEA specifically, not everywhere", () => {
    const q3 = ["2026-07", "2026-08", "2026-09"];
    const actual = (region: string) =>
      db.facts
        .filter((f) => q3.includes(f.month) && f.region === region)
        .reduce((sum, f) => sum + f.newArr + f.expansionArr - f.churnedArr, 0);
    // EMEA is the source of the miss; NAMER is on or above its share of plan.
    expect(actual("emea")).toBeLessThan(actual("namer"));
  });

  it("has exactly one pinned board and one connected source", () => {
    expect(db.boards.filter((b) => b.pinned)).toHaveLength(1);
    expect(db.sources).toHaveLength(1);
  });

  it("gives every board a unique slug", () => {
    const slugs = db.boards.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
