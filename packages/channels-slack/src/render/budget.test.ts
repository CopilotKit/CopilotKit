import { describe, it, expect } from "vitest";
import { SLACK_LIMITS, truncateText, clampArray } from "./budget.js";

describe("budget: truncateText", () => {
  it("leaves short text unchanged", () => {
    expect(truncateText("hello", 3000)).toBe("hello");
  });
  it("truncates section text to 3000 chars with an ellipsis", () => {
    const long = "x".repeat(4000);
    const out = truncateText(long, SLACK_LIMITS.sectionText);
    expect(out.length).toBe(3000);
    expect(out.endsWith("…")).toBe(true);
  });
  it("truncates button text to 75 and action_id to 255", () => {
    expect(truncateText("y".repeat(200), SLACK_LIMITS.buttonText).length).toBe(
      75,
    );
    expect(truncateText("z".repeat(500), SLACK_LIMITS.actionId).length).toBe(
      255,
    );
  });
  it("truncates field text to 2000 and button value to 2000", () => {
    expect(truncateText("a".repeat(5000), SLACK_LIMITS.fieldText).length).toBe(
      2000,
    );
    expect(
      truncateText("b".repeat(5000), SLACK_LIMITS.buttonValue).length,
    ).toBe(2000);
  });
});

describe("budget: clampArray", () => {
  it("keeps arrays within the limit untouched (overflow 0)", () => {
    expect(clampArray([1, 2, 3], 25)).toEqual({
      items: [1, 2, 3],
      overflow: 0,
    });
  });
  it("clamps actions to 25 elements and reports overflow", () => {
    const els = Array.from({ length: 30 }, (_, i) => i);
    const r = clampArray(els, SLACK_LIMITS.actionsElements);
    expect(r.items.length).toBe(25);
    expect(r.overflow).toBe(5);
  });
  it("clamps context to 10, fields to 10, blocks to 50, select options to 100", () => {
    expect(
      clampArray(Array(20).fill(0), SLACK_LIMITS.contextElements).items.length,
    ).toBe(10);
    expect(
      clampArray(Array(15).fill(0), SLACK_LIMITS.fieldsPerSection).items.length,
    ).toBe(10);
    expect(
      clampArray(Array(60).fill(0), SLACK_LIMITS.blocksPerMessage).items.length,
    ).toBe(50);
    expect(
      clampArray(Array(150).fill(0), SLACK_LIMITS.selectOptions).items.length,
    ).toBe(100);
  });
  it("clamps table columns to 20 and table rows to 100", () => {
    const cols = clampArray(Array(30).fill(0), SLACK_LIMITS.tableColumns);
    expect(cols.items.length).toBe(20);
    expect(cols.overflow).toBe(10);
    const rows = clampArray(Array(150).fill(0), SLACK_LIMITS.tableRows);
    expect(rows.items.length).toBe(100);
    expect(rows.overflow).toBe(50);
  });
});
