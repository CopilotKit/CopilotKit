import { describe, it, expect } from "vitest";

import { parseAbRecords, AbReportInputError } from "./cli-ab-report.js";
import { computeAbReport } from "./ab-report.js";

const EDGE = {
  ab_pair_id: "p1",
  arm: "edge",
  test_id: "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
  slug: "langgraph-python",
  demo: "agentic-chat",
  outcome: "timeout",
  edge_interference_signal: true,
};
const INTERNAL = { ...EDGE, arm: "internal", outcome: "ok" };

describe("parseAbRecords — collector-JSON glue", () => {
  it("parses a well-formed array into records the engine can diff", () => {
    const records = parseAbRecords(JSON.stringify([EDGE, INTERNAL]));
    expect(records).toHaveLength(2);
    const report = computeAbReport(records);
    expect(report.pairs[0]!.divergence).toBe("edge-only-failure");
    expect(report.edge_interference_suspected).toBe(1);
  });

  it("treats empty/whitespace input as an empty record set", () => {
    expect(parseAbRecords("")).toEqual([]);
    expect(parseAbRecords("   \n ")).toEqual([]);
  });

  it("rejects a non-array top-level value", () => {
    expect(() => parseAbRecords("{}")).toThrow(AbReportInputError);
  });

  it("rejects invalid JSON with a clear error", () => {
    expect(() => parseAbRecords("not json")).toThrow(/not valid JSON/);
  });

  it("rejects an out-of-enum arm naming the offending index", () => {
    const bad = JSON.stringify([EDGE, { ...INTERNAL, arm: "sideways" }]);
    expect(() => parseAbRecords(bad)).toThrow(
      /record 1.*invalid arm "sideways"/,
    );
  });

  it("rejects an out-of-enum outcome", () => {
    const bad = JSON.stringify([{ ...EDGE, outcome: "maybe" }]);
    expect(() => parseAbRecords(bad)).toThrow(/invalid outcome "maybe"/);
  });

  it("rejects a missing required string field", () => {
    const { slug: _omitted, ...noSlug } = EDGE;
    expect(() => parseAbRecords(JSON.stringify([noSlug]))).toThrow(
      /field "slug" must be a string/,
    );
  });

  it("rejects a non-boolean edge_interference_signal", () => {
    const bad = JSON.stringify([{ ...EDGE, edge_interference_signal: "yes" }]);
    expect(() => parseAbRecords(bad)).toThrow(
      /edge_interference_signal" must be a boolean/,
    );
  });

  it("rejects a non-object record", () => {
    expect(() => parseAbRecords("[42]")).toThrow(/expected a JSON object/);
  });
});
