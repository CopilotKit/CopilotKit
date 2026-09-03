import { describe, it, expect } from "vitest";
import { buildBudgetMemoPdf } from "./budget-memo-pdf";
import type { BudgetMemoInput } from "./budget-memo-pdf";

const INPUT: BudgetMemoInput = {
  periodLabel: "August 2026",
  memoDate: "5 September 2026",
  planUsd: 216_000,
  actualUsd: 235_440,
  variancePct: 0.09,
  timingUsd: 12_053,
  oneOffUsd: 7_387,
};

const build = (input: BudgetMemoInput = INPUT) =>
  Buffer.from(buildBudgetMemoPdf(input)).toString("latin1");

describe("the budget memo document", () => {
  it("is a PDF", () => {
    expect(build().startsWith("%PDF-")).toBe(true);
  });

  it("prints the period, the plan/actual figures and the overrun", () => {
    const text = build();
    expect(text).toContain("August 2026");
    expect(text).toContain("$235,440");
    expect(text).toContain("$216,000");
    expect(text).toContain("$19,440");
  });

  it("prints both driver amounts", () => {
    const text = build();
    expect(text).toContain("$12,053");
    expect(text).toContain("$7,387");
    // The invariant that these sum to the overrun, and that timing is the
    // larger driver, is now tested for real at the route level (the route
    // computes the split from the live ledger; this fixture's numbers are
    // fixed and would pass here regardless of whether the invariant holds).
  });

  it("prints no narrative code, filedAt, or exception status", () => {
    // Those are the register's to settle server-side (see the header
    // comment) — printing one here would hand the model the very field
    // `POST /narratives` exists to own.
    const text = build();
    expect(text).not.toMatch(/VAR-(TIMING|ONEOFF|FX|PLAN)/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).not.toContain("explained");
  });

  it("emits only single-byte characters, even from typographic input", () => {
    // Assert the BYTES, not a decoded string: once the document is ASCII the
    // two are the same thing, so a character-level check would pass for the
    // same reason the builder is correct and could never fail for the case it
    // exists to catch. The title itself carries an em dash ("—"), and a
    // period like "period — 2026" folds a typographic dash the same way.
    const bytes = buildBudgetMemoPdf({
      ...INPUT,
      periodLabel: "Q3 — 2026",
    });
    for (const byte of bytes) expect(byte).toBeLessThan(0x80);
  });
});
