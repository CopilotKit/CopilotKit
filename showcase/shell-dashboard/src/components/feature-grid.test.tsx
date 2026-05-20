/**
 * Unit tests for the header `LiveIndicator` color-map (spec §5.7) and
 * `computeColumnTally` (§5.4 rollup + §5.3 offline handling).
 *
 * Tallies now derive from `buildCellModel().chipColor`, matching what
 * Coverage-tab cells actually render. Health is no longer counted
 * separately — the cell model incorporates all relevant signals.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LiveIndicator, computeColumnTally } from "./feature-grid";
import type { Integration, Feature } from "@/lib/registry";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";

describe("LiveIndicator", () => {
  it("renders live → green solid dot", () => {
    const { getByTestId } = render(<LiveIndicator status="live" />);
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-status")).toBe("live");
    expect(el.getAttribute("data-tone")).toBe("green");
  });

  it("renders connecting → amber pulse dot", () => {
    const { getByTestId } = render(<LiveIndicator status="connecting" />);
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-status")).toBe("connecting");
    expect(el.getAttribute("data-tone")).toBe("amber");
    expect(el.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders error → red solid dot labeled offline", () => {
    const { getByTestId } = render(<LiveIndicator status="error" />);
    const el = getByTestId("live-indicator");
    expect(el.getAttribute("data-status")).toBe("error");
    expect(el.getAttribute("data-tone")).toBe("red");
    expect(el.textContent).toContain("offline");
  });
});

function row(key: string, dim: string, state: StatusRow["state"]): StatusRow {
  return {
    id: key,
    key,
    dimension: dim,
    state,
    signal: {},
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
  };
}

describe("computeColumnTally", () => {
  const demo = (id: string) => ({
    id,
    name: id,
    description: "",
    tags: [],
  });
  const integration: Integration = {
    slug: "i1",
    name: "i1",
    category: "c",
    language: "ts",
    description: "",
    repo: "",
    backend_url: "https://x",
    deployed: true,
    features: ["f1", "f2"],
    demos: [demo("f1"), demo("f2")],
  };
  const features: Feature[] = [
    { id: "f1", name: "f1", category: "c", description: "" },
    { id: "f2", name: "f2", category: "c", description: "" },
  ];

  it("counts by chipColor — green D3 only → green chip", () => {
    const live: LiveStatusMap = new Map();
    // f1: D3=green → achievedDepth=3, ceilingDepth=3 → chipColor=green
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    // f2: D3=green → achievedDepth=3, ceilingDepth=3 → chipColor=green
    live.set("e2e:i1/f2", row("e2e:i1/f2", "e2e", "green"));
    const t = computeColumnTally(integration, features, live);
    expect(t).toEqual({ green: 2, amber: 0, red: 0, unknown: false });
  });

  it("red D3 → red chip (tests exist but fail), counted as red", () => {
    const live: LiveStatusMap = new Map();
    // f1: D3=red → achievedDepth=0, ceilingDepth=3 → chipColor=red
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "red"));
    // f2: D3=green → chipColor=green
    live.set("e2e:i1/f2", row("e2e:i1/f2", "e2e", "green"));
    const t = computeColumnTally(integration, features, live);
    // f1 red (tests exist but all fail), f2 green
    expect(t).toEqual({ green: 1, amber: 0, red: 1, unknown: false });
  });

  it("health row alone does not contribute to tally", () => {
    const live: LiveStatusMap = new Map();
    live.set("health:i1", row("health:i1", "health", "red"));
    const t = computeColumnTally(integration, features, live);
    // No D3 rows → all cells gray → nothing counted
    expect(t).toEqual({ green: 0, amber: 0, red: 0, unknown: false });
  });

  it("features without demos are gray (unwired), not counted", () => {
    const live: LiveStatusMap = new Map();
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    // integration only has demo for f1, not f2 — but test fixture has
    // demos for both. Use a modified integration.
    const partialInt: Integration = {
      ...integration,
      demos: [demo("f1")],
    };
    const t = computeColumnTally(partialInt, features, live);
    // f1: wired + D3=green → green; f2: unwired → gray (skipped)
    expect(t).toEqual({ green: 1, amber: 0, red: 0, unknown: false });
  });

  it("not_supported_features are gray, not counted", () => {
    const live: LiveStatusMap = new Map();
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    live.set("e2e:i1/f2", row("e2e:i1/f2", "e2e", "green"));
    const unsupportedInt: Integration = {
      ...integration,
      not_supported_features: ["f2"],
    };
    const t = computeColumnTally(unsupportedInt, features, live);
    // f1: green; f2: unsupported → gray (skipped)
    expect(t).toEqual({ green: 1, amber: 0, red: 0, unknown: false });
  });

  it("returns unknown=true when connection is error", () => {
    const live: LiveStatusMap = new Map();
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    const t = computeColumnTally(integration, features, live, "error");
    expect(t.unknown).toBe(true);
    expect(t.green).toBe(0);
    expect(t.red).toBe(0);
  });

  it("returns zeros with unknown=false when no rows", () => {
    const t = computeColumnTally(integration, features, new Map());
    expect(t).toEqual({ green: 0, amber: 0, red: 0, unknown: false });
  });

  it("amber chip from D3=green + D4=green + D5 missing (gap=1)", () => {
    const live: LiveStatusMap = new Map();
    // f1: D3=green, D4(chat)=green → achievedDepth=4
    // D5 key mapped but no row → exists=true, status=null → ceilingDepth=5
    // gap = 5-4 = 1 → amber
    live.set("e2e:i1/f1", row("e2e:i1/f1", "e2e", "green"));
    live.set("chat:i1", row("chat:i1", "chat", "green"));
    // Use a feature ID with a D5 mapping to get ceilingDepth=5
    const mappedFeatures: Feature[] = [
      {
        id: "agentic-chat",
        name: "Agentic Chat",
        category: "c",
        description: "",
      },
    ];
    const mappedInt: Integration = {
      ...integration,
      features: ["agentic-chat"],
      demos: [demo("agentic-chat")],
    };
    const mappedLive: LiveStatusMap = new Map();
    mappedLive.set(
      "e2e:i1/agentic-chat",
      row("e2e:i1/agentic-chat", "e2e", "green"),
    );
    mappedLive.set("chat:i1", row("chat:i1", "chat", "green"));
    const t = computeColumnTally(mappedInt, mappedFeatures, mappedLive);
    // D3=green, D4=green (chat only, no tools), D5 mapped but no row →
    // ceilingDepth=5, achievedDepth=4, gap=1 → amber
    expect(t).toEqual({ green: 0, amber: 1, red: 0, unknown: false });
  });
});
