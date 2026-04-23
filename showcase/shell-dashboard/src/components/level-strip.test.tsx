/**
 * Unit tests for LevelStrip — Phase 3.2.
 * Covers four badges x four tones, plus Tools n/a gate.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LevelStrip } from "./level-strip";
import type { Integration } from "@/lib/registry";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";

function row(
  key: string,
  dimension: string,
  state: StatusRow["state"],
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: {},
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

const makeIntegration = (
  slug: string,
  demos: Array<{ id: string; name: string; description: string; tags: string[] }> = [],
): Integration => ({
  slug,
  name: slug,
  category: "c",
  language: "ts",
  description: "",
  repo: "",
  backend_url: "",
  deployed: true,
  features: [],
  demos,
});

describe("LevelStrip", () => {
  it("renders four badges with correct letters", () => {
    const integration = makeIntegration("test");
    const { getByTestId } = render(
      <LevelStrip integration={integration} liveStatus={new Map()} />,
    );
    const strip = getByTestId("level-strip");
    expect(strip.children).toHaveLength(4);
    // First letters: U(p), W(ired), C(hats), T(ools)
    const letters = Array.from(strip.children).map((c) => c.textContent);
    expect(letters).toEqual(["U", "W", "C", "T"]);
  });

  it("shows green tone when dimension rows are green", () => {
    const integration = makeIntegration("test", [
      { id: "tool-rendering", name: "Tool Rendering", description: "", tags: [] },
    ]);
    const live = mapOf([
      row("health:test", "health", "green"),
      row("agent:test", "agent", "green"),
      row("chat:test", "chat", "green"),
      row("tools:test", "tools", "green"),
    ]);
    const { getByTestId } = render(
      <LevelStrip integration={integration} liveStatus={live} />,
    );
    const strip = getByTestId("level-strip");
    const chips = Array.from(strip.children);
    // All four should have green-related classes/title
    for (const chip of chips) {
      expect(chip.getAttribute("title")).toContain("green");
    }
  });

  it("shows red tone when health is red", () => {
    const integration = makeIntegration("test");
    const live = mapOf([row("health:test", "health", "red")]);
    const { getByTestId } = render(
      <LevelStrip integration={integration} liveStatus={live} />,
    );
    const strip = getByTestId("level-strip");
    const upChip = strip.children[0]!;
    expect(upChip.getAttribute("title")).toContain("red");
  });

  it("shows gray tone when no data", () => {
    const integration = makeIntegration("test");
    const { getByTestId } = render(
      <LevelStrip integration={integration} liveStatus={new Map()} />,
    );
    const strip = getByTestId("level-strip");
    const upChip = strip.children[0]!;
    expect(upChip.getAttribute("title")).toContain("no data");
  });

  it("Tools badge shows n/a when integration has no tool-rendering demo", () => {
    const integration = makeIntegration("test", [
      { id: "agentic-chat", name: "Chat", description: "", tags: [] },
    ]);
    const live = mapOf([row("tools:test", "tools", "green")]);
    const { getByTestId } = render(
      <LevelStrip integration={integration} liveStatus={live} />,
    );
    const strip = getByTestId("level-strip");
    const toolsChip = strip.children[3]!;
    expect(toolsChip.getAttribute("title")).toContain("n/a");
  });

  it("Tools badge shows real state when integration has tool-rendering demo", () => {
    const integration = makeIntegration("test", [
      { id: "tool-rendering", name: "Tool Rendering", description: "", tags: [] },
    ]);
    const live = mapOf([row("tools:test", "tools", "green")]);
    const { getByTestId } = render(
      <LevelStrip integration={integration} liveStatus={live} />,
    );
    const strip = getByTestId("level-strip");
    const toolsChip = strip.children[3]!;
    expect(toolsChip.getAttribute("title")).toContain("green");
    expect(toolsChip.getAttribute("title")).not.toContain("n/a");
  });

  it("amber tone for degraded rows", () => {
    const integration = makeIntegration("test");
    const live = mapOf([row("agent:test", "agent", "degraded")]);
    const { getByTestId } = render(
      <LevelStrip integration={integration} liveStatus={live} />,
    );
    const strip = getByTestId("level-strip");
    const wiredChip = strip.children[1]!;
    expect(wiredChip.getAttribute("title")).toContain("degraded");
  });
});
