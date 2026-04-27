/**
 * Unit tests for PackagesSection — Phase 3.7 + depth column.
 * Verifies N rows rendered from registry, each with a LevelStrip and DepthChip.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { PackagesSection } from "./packages-section";
import type { LiveStatusMap } from "@/lib/live-status";

// Mock registry to return a known set of packages
vi.mock("@/lib/registry", () => ({
  getPackages: () => [
    { slug: "agno", name: "Agno" },
    { slug: "mastra", name: "Mastra" },
    { slug: "crewai-crews", name: "CrewAI Crews" },
  ],
  getIntegrations: () => [],
  getFeatures: () => [],
  getFeatureCategories: () => [],
}));

const emptyLiveStatus: LiveStatusMap = new Map();

describe("PackagesSection", () => {
  it("renders N rows given N packages", () => {
    const { getByTestId, getAllByTestId } = render(
      <PackagesSection liveStatus={emptyLiveStatus} connection="live" />,
    );
    const section = getByTestId("packages-section");
    expect(section).toBeDefined();
    // Each package row has a LevelStrip with data-testid="level-strip"
    const strips = getAllByTestId("level-strip");
    expect(strips).toHaveLength(3);
  });

  it("renders package names", () => {
    const { getByText } = render(
      <PackagesSection liveStatus={emptyLiveStatus} connection="live" />,
    );
    expect(getByText("Agno")).toBeDefined();
    expect(getByText("Mastra")).toBeDefined();
    expect(getByText("CrewAI Crews")).toBeDefined();
  });

  it("renders slug identifiers", () => {
    const { getByText } = render(
      <PackagesSection liveStatus={emptyLiveStatus} connection="live" />,
    );
    expect(getByText("agno")).toBeDefined();
    expect(getByText("mastra")).toBeDefined();
    expect(getByText("crewai-crews")).toBeDefined();
  });

  it("renders depth chips for each package", () => {
    const { getAllByTestId } = render(
      <PackagesSection liveStatus={emptyLiveStatus} connection="live" />,
    );
    const chips = getAllByTestId("depth-chip");
    expect(chips).toHaveLength(3);
    // With empty liveStatus, all should show D0
    for (const chip of chips) {
      expect(chip.getAttribute("data-depth")).toBe("0");
    }
  });

  it("renders Depth column header", () => {
    const { getByText } = render(
      <PackagesSection liveStatus={emptyLiveStatus} connection="live" />,
    );
    expect(getByText("Depth")).toBeDefined();
  });

  it("renders the UWCT legend in the L1-L4 Status header", () => {
    const { getByTestId } = render(
      <PackagesSection liveStatus={emptyLiveStatus} connection="live" />,
    );
    const legend = getByTestId("packages-uwct-legend");
    expect(legend.textContent).toBe("(U=Up, W=Wired, C=Chats, T=Tools)");
  });
});
