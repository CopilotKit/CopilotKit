import { describe, it, expect, vi } from "vitest";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";
import type { Integration, Feature } from "@/lib/registry";

// Mock registry module — registry.json is generated at build time and
// not available in the test environment.
vi.mock("@/lib/registry", () => ({
  getIntegrations: vi.fn(() => []),
  getFeatures: vi.fn(() => []),
  getFeatureCategories: vi.fn(() => []),
}));

import { computeColumnTallyDetail } from "@/components/feature-grid";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeRow(
  key: string,
  dimension: string,
  state: StatusRow["state"],
): StatusRow {
  return {
    id: key,
    key,
    dimension,
    state,
    signal: null,
    observed_at: "2026-04-28T00:00:00Z",
    transitioned_at: "2026-04-28T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
  };
}

function makeIntegration(slug: string, demoIds: string[]): Integration {
  return {
    slug,
    name: slug,
    language: "python",
    backend_url: `https://${slug}.example.com`,
    docs_url: "",
    source_url: "",
    demos: demoIds.map((id) => ({
      id,
      route: `/${id}`,
      command: "",
    })),
  } as Integration;
}

function makeFeature(id: string, name: string): Feature {
  return {
    id,
    name,
    description: "",
    category: "core",
    kind: "standard",
  } as Feature;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe("computeColumnTallyDetail", () => {
  it("returns unknown: true with empty arrays when connection is error", () => {
    const integration = makeIntegration("test-int", ["feat-1"]);
    const features = [makeFeature("feat-1", "Feature 1")];
    const liveStatus: LiveStatusMap = new Map();

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "error",
    );

    expect(result).toEqual({
      green: [],
      amber: [],
      red: [],
      unknown: true,
    });
  });

  it("green D3 cells land in green bucket", () => {
    const integration = makeIntegration("my-int", ["feat-a", "feat-b"]);
    const features = [
      makeFeature("feat-a", "Feature A"),
      makeFeature("feat-b", "Feature B"),
    ];

    // Both features have green D3 → achievedDepth=3, ceilingDepth=3 → green chip
    const liveStatus: LiveStatusMap = new Map([
      ["e2e:my-int/feat-a", makeRow("e2e:my-int/feat-a", "e2e", "green")],
      ["e2e:my-int/feat-b", makeRow("e2e:my-int/feat-b", "e2e", "green")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    expect(result.green).toEqual([
      { label: "Feature A", dimension: "e2e", featureId: "feat-a" },
      { label: "Feature B", dimension: "e2e", featureId: "feat-b" },
    ]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([]);
  });

  it("red D3 cells are gray (achievedDepth=0) and excluded", () => {
    const integration = makeIntegration("my-int", ["feat-a", "feat-b"]);
    const features = [
      makeFeature("feat-a", "Feature A"),
      makeFeature("feat-b", "Feature B"),
    ];

    // feat-a: D3=red → achievedDepth=0, ceilingDepth=3 → gray (skipped)
    // feat-b: D3=green → green chip
    const liveStatus: LiveStatusMap = new Map([
      ["e2e:my-int/feat-a", makeRow("e2e:my-int/feat-a", "e2e", "red")],
      ["e2e:my-int/feat-b", makeRow("e2e:my-int/feat-b", "e2e", "green")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    expect(result.green).toEqual([
      { label: "Feature B", dimension: "e2e", featureId: "feat-b" },
    ]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([]);
  });

  it("features without demos are gray (unwired) and excluded", () => {
    // Integration only has demo for feat-1, not feat-2
    const integration = makeIntegration("partial", ["feat-1"]);
    const features = [
      makeFeature("feat-1", "Feature 1"),
      makeFeature("feat-2", "Feature 2"),
    ];

    const liveStatus: LiveStatusMap = new Map([
      ["e2e:partial/feat-1", makeRow("e2e:partial/feat-1", "e2e", "green")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    // Only feat-1 appears (has a demo); feat-2 is unwired → gray → excluded
    expect(result.green).toEqual([
      { label: "Feature 1", dimension: "e2e", featureId: "feat-1" },
    ]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([]);
  });

  it("health-only data produces no tally items (health not in cell model)", () => {
    const integration = makeIntegration("health-only", []);
    const features: Feature[] = [];

    const liveStatus: LiveStatusMap = new Map([
      ["health:health-only", makeRow("health:health-only", "health", "red")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    // No features → no cells → nothing counted
    expect(result.green).toEqual([]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([]);
    expect(result.unknown).toBe(false);
  });

  it("not_supported_features are gray and excluded", () => {
    const integration = {
      ...makeIntegration("ns-int", ["feat-a", "feat-b"]),
      not_supported_features: ["feat-b"],
    };
    const features = [
      makeFeature("feat-a", "Feature A"),
      makeFeature("feat-b", "Feature B"),
    ];

    const liveStatus: LiveStatusMap = new Map([
      ["e2e:ns-int/feat-a", makeRow("e2e:ns-int/feat-a", "e2e", "green")],
      ["e2e:ns-int/feat-b", makeRow("e2e:ns-int/feat-b", "e2e", "green")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    // feat-a: green; feat-b: unsupported → gray → excluded
    expect(result.green).toEqual([
      { label: "Feature A", dimension: "e2e", featureId: "feat-a" },
    ]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([]);
  });
});
