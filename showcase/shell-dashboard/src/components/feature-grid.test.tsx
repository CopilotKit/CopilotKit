/**
 * Unit tests for the header `LiveIndicator` color-map (spec §5.7) and
 * `computeColumnTally` (§5.4 rollup + §5.3 offline handling).
 *
 * Phase 3: QA removed, smoke removed from per-cell tally. E2E uses
 * e2e_smoke dimension. Tally now counts health (once) + e2e per feature.
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

  it("counts health once + e2e per feature", () => {
    const live: LiveStatusMap = new Map();
    live.set("e2e_smoke:i1/f1", row("e2e_smoke:i1/f1", "e2e_smoke", "red"));
    live.set("e2e_smoke:i1/f2", row("e2e_smoke:i1/f2", "e2e_smoke", "green"));
    live.set("health:i1", row("health:i1", "health", "green"));
    const t = computeColumnTally(integration, features, live);
    // health (integration): green → +1g
    // f1: e2e=red (+1r)
    // f2: e2e=green (+1g)
    // Total: 2 green, 0 amber, 1 red.
    expect(t).toEqual({ green: 2, amber: 0, red: 1, unknown: false });
  });

  it("health red contributes exactly one red to the column tally", () => {
    const live: LiveStatusMap = new Map();
    live.set("health:i1", row("health:i1", "health", "red"));
    const t = computeColumnTally(integration, features, live);
    expect(t).toEqual({ green: 0, amber: 0, red: 1, unknown: false });
  });

  it("missing health row contributes zero (does not count as red)", () => {
    const live: LiveStatusMap = new Map();
    live.set(
      "e2e_smoke:i1/f1",
      row("e2e_smoke:i1/f1", "e2e_smoke", "green"),
    );
    const t = computeColumnTally(integration, features, live);
    expect(t).toEqual({ green: 1, amber: 0, red: 0, unknown: false });
  });

  it("returns unknown=true when connection is error", () => {
    const live: LiveStatusMap = new Map();
    live.set(
      "e2e_smoke:i1/f1",
      row("e2e_smoke:i1/f1", "e2e_smoke", "green"),
    );
    const t = computeColumnTally(integration, features, live, "error");
    expect(t.unknown).toBe(true);
    expect(t.green).toBe(0);
    expect(t.red).toBe(0);
  });

  it("returns zeros with unknown=false when no rows", () => {
    const t = computeColumnTally(integration, features, new Map());
    expect(t).toEqual({ green: 0, amber: 0, red: 0, unknown: false });
  });
});
