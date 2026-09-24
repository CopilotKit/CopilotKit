import { describe, expect, it } from "vitest";
import {
  resolveSubagentDepth,
  resolveSubagentLineDepth,
} from "./subagent-depth";

describe("subagent activity hierarchy", () => {
  const tree = new Map([
    ["analyst", {}],
    ["researcher", { parentSubagentRunId: "analyst" }],
    ["crawler", { parentSubagentRunId: "researcher" }],
  ]);

  it("preserves nested parent depth instead of flattening every child", () => {
    expect(resolveSubagentDepth(tree, "analyst")).toBe(0);
    expect(resolveSubagentDepth(tree, "researcher")).toBe(1);
    expect(resolveSubagentDepth(tree, "crawler")).toBe(2);
  });

  it("places activity below the subagent heading and results below tools", () => {
    expect(resolveSubagentLineDepth(tree, "analyst", "tool")).toBe(1);
    expect(resolveSubagentLineDepth(tree, "researcher", "tool")).toBe(2);
    expect(resolveSubagentLineDepth(tree, "researcher", "result")).toBe(3);
  });

  it("repairs line depth when parent lineage becomes known later", () => {
    const late = new Map<string, { parentSubagentRunId?: string }>();

    expect(resolveSubagentLineDepth(late, "researcher", "text")).toBe(1);

    late.set("analyst", {});
    late.set("researcher", { parentSubagentRunId: "analyst" });

    expect(resolveSubagentLineDepth(late, "researcher", "text")).toBe(2);
  });

  it("bounds malformed parent cycles instead of hanging the projection", () => {
    const cycle = new Map([
      ["a", { parentSubagentRunId: "b" }],
      ["b", { parentSubagentRunId: "a" }],
    ]);

    expect(resolveSubagentDepth(cycle, "a")).toBe(2);
  });
});
