import { describe, expect, it } from "vitest";
import { fitColumns } from "./fit-columns";

const cols = [
  { key: "a", minWidth: 150, priority: 1 },
  { key: "b", minWidth: 120, priority: 2 },
  { key: "c", minWidth: 90, priority: 1 },
  { key: "d", minWidth: 120, priority: 3 },
];

describe("fitColumns", () => {
  it("keeps priority-1 columns and folds the rest when narrow, in original order", () => {
    expect(fitColumns(cols, 300)).toEqual({
      visible: ["a", "c"],
      hidden: ["b", "d"],
    });
    expect(fitColumns(cols, 400)).toEqual({
      visible: ["a", "b", "c"],
      hidden: ["d"],
    });
    expect(fitColumns(cols, 1000).hidden).toEqual([]);
  });
});
