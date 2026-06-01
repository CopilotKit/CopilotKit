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

// Recent timestamp so green e2e rows are not treated as stale by the
// staleness downgrade in cell-model.ts (which compares against Date.now()).
const FRESH_OBSERVED_AT = new Date().toISOString();

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
    observed_at: FRESH_OBSERVED_AT,
    transitioned_at: FRESH_OBSERVED_AT,
    fail_count: 0,
    first_failure_at: null,
  };
}

function makeIntegration(slug: string, demoIds: string[]): Integration {
  return {
    slug,
    name: slug,
    category: "python",
    language: "python",
    description: "",
    repo: "",
    backend_url: `https://${slug}.example.com`,
    deployed: true,
    features: demoIds,
    demos: demoIds.map((id) => ({
      id,
      name: id,
      description: "",
      tags: [],
      route: `/${id}`,
    })),
  } as Integration;
}

function makeFeature(id: string, name: string): Feature {
  return {
    id,
    name,
    description: "",
    category: "core",
    kind: "primary",
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

  it("green D6 cells land in green bucket", () => {
    // Use feature IDs with a D5 mapping (agentic-chat, tool-rendering) so the
    // verification ladder is contiguous to D5. Green requires an intact
    // ladder: a green D6 cannot paint green over a missing/red D5.
    const integration = makeIntegration("my-int", [
      "agentic-chat",
      "tool-rendering",
    ]);
    const features = [
      makeFeature("agentic-chat", "Feature A"),
      makeFeature("tool-rendering", "Feature B"),
    ];

    // Both features: green D3 + green D5 + green D6 → chipColor=green.
    const liveStatus: LiveStatusMap = new Map([
      [
        "e2e:my-int/agentic-chat",
        makeRow("e2e:my-int/agentic-chat", "e2e", "green"),
      ],
      [
        "e2e:my-int/tool-rendering",
        makeRow("e2e:my-int/tool-rendering", "e2e", "green"),
      ],
      [
        "d5:my-int/agentic-chat",
        makeRow("d5:my-int/agentic-chat", "d5", "green"),
      ],
      [
        "d5:my-int/tool-rendering",
        makeRow("d5:my-int/tool-rendering", "d5", "green"),
      ],
      ["d6:my-int", makeRow("d6:my-int", "d6", "green")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    expect(result.green).toEqual([
      { label: "Feature A", dimension: "e2e", featureId: "agentic-chat" },
      { label: "Feature B", dimension: "e2e", featureId: "tool-rendering" },
    ]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([]);
  });

  it("red D3 → red chip, green D3 without D5/D6 → gray (excluded)", () => {
    const integration = makeIntegration("my-int", ["feat-a", "feat-b"]);
    const features = [
      makeFeature("feat-a", "Feature A"),
      makeFeature("feat-b", "Feature B"),
    ];

    // feat-a: D3=red → chipColor=red (d1d4GateFails)
    // feat-b: D3=green but no D5/D6 → chipColor=gray (D6-ceiling)
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
    expect(result.green).toEqual([]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([
      { label: "Feature A", dimension: "e2e", featureId: "feat-a" },
    ]);
  });

  it("features without demos are gray (unwired) and excluded", () => {
    // Integration only has a demo for agentic-chat, not tool-rendering.
    const integration = makeIntegration("partial", ["agentic-chat"]);
    const features = [
      makeFeature("agentic-chat", "Feature 1"),
      makeFeature("tool-rendering", "Feature 2"),
    ];

    // agentic-chat: green D3 + green D5 + green D6 → green (intact ladder).
    const liveStatus: LiveStatusMap = new Map([
      [
        "e2e:partial/agentic-chat",
        makeRow("e2e:partial/agentic-chat", "e2e", "green"),
      ],
      [
        "d5:partial/agentic-chat",
        makeRow("d5:partial/agentic-chat", "d5", "green"),
      ],
      ["d6:partial", makeRow("d6:partial", "d6", "green")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    // agentic-chat: wired + intact green ladder → green; tool-rendering:
    // unwired → gray.
    expect(result.green).toEqual([
      { label: "Feature 1", dimension: "e2e", featureId: "agentic-chat" },
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

  it("green D3+D4 + red D5 → red bucket with dimension 'health'", () => {
    // Exercises the feature-grid `dimension:"health"` branch: a D5 row that
    // exists with a non-null, non-green status classifies the failure as a
    // live-conversation ("health") failure, not a page-load ("e2e") one. The
    // broken D5 ladder makes chipColor red.
    const integration = makeIntegration("h-int", ["agentic-chat"]);
    const features = [makeFeature("agentic-chat", "Feature A")];
    const liveStatus: LiveStatusMap = new Map([
      [
        "e2e:h-int/agentic-chat",
        makeRow("e2e:h-int/agentic-chat", "e2e", "green"),
      ],
      // chat green → D4 green (tools absent, worst-state skips it)
      ["chat:h-int", makeRow("chat:h-int", "chat", "green")],
      // d5 red → ladder broken at D5 → chipColor red, dimension health
      ["d5:h-int/agentic-chat", makeRow("d5:h-int/agentic-chat", "d5", "red")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    expect(result.green).toEqual([]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([
      { label: "Feature A", dimension: "health", featureId: "agentic-chat" },
    ]);
  });

  it("green D3 + red D4 → red bucket with dimension 'health'", () => {
    // A red D4 (real-time chat/tools) row exists with a non-null, non-green
    // status → the failing D1-D4 gate paints the chip red, and the
    // `dimension:"health"` branch classifies it as a live-roundtrip failure.
    const integration = makeIntegration("h2-int", ["agentic-chat"]);
    const features = [makeFeature("agentic-chat", "Feature A")];
    const liveStatus: LiveStatusMap = new Map([
      [
        "e2e:h2-int/agentic-chat",
        makeRow("e2e:h2-int/agentic-chat", "e2e", "green"),
      ],
      // chat red → D4 red → gate fails → chipColor red, dimension health
      ["chat:h2-int", makeRow("chat:h2-int", "chat", "red")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    expect(result.green).toEqual([]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([
      { label: "Feature A", dimension: "health", featureId: "agentic-chat" },
    ]);
  });

  it("not_supported_features are gray and excluded", () => {
    const integration = {
      ...makeIntegration("ns-int", ["agentic-chat", "tool-rendering"]),
      not_supported_features: ["tool-rendering"],
    };
    const features = [
      makeFeature("agentic-chat", "Feature A"),
      makeFeature("tool-rendering", "Feature B"),
    ];

    // agentic-chat: green D3 + green D5 + green D6 → green (intact ladder).
    const liveStatus: LiveStatusMap = new Map([
      [
        "e2e:ns-int/agentic-chat",
        makeRow("e2e:ns-int/agentic-chat", "e2e", "green"),
      ],
      [
        "e2e:ns-int/tool-rendering",
        makeRow("e2e:ns-int/tool-rendering", "e2e", "green"),
      ],
      [
        "d5:ns-int/agentic-chat",
        makeRow("d5:ns-int/agentic-chat", "d5", "green"),
      ],
      ["d6:ns-int", makeRow("d6:ns-int", "d6", "green")],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    // agentic-chat: intact green ladder → green; tool-rendering: unsupported
    // → gray → excluded.
    expect(result.green).toEqual([
      { label: "Feature A", dimension: "e2e", featureId: "agentic-chat" },
    ]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([]);
  });
});
