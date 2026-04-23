/**
 * Unit tests for PackagesSection — Phase 3.7.
 * Verifies N rows rendered from registry, each with a LevelStrip.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { PackagesSection } from "./packages-section";

// Mock useLiveStatus to avoid PB connection in tests
vi.mock("@/hooks/useLiveStatus", () => ({
  useLiveStatus: () => ({
    rows: [],
    status: "live" as const,
    error: null,
  }),
}));

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

describe("PackagesSection", () => {
  it("renders N rows given N packages", () => {
    const { getByTestId, getAllByTestId } = render(<PackagesSection />);
    const section = getByTestId("packages-section");
    expect(section).toBeDefined();
    // Each package row has a LevelStrip with data-testid="level-strip"
    const strips = getAllByTestId("level-strip");
    expect(strips).toHaveLength(3);
  });

  it("renders package names", () => {
    const { getByText } = render(<PackagesSection />);
    expect(getByText("Agno")).toBeDefined();
    expect(getByText("Mastra")).toBeDefined();
    expect(getByText("CrewAI Crews")).toBeDefined();
  });

  it("renders slug identifiers", () => {
    const { getByText } = render(<PackagesSection />);
    expect(getByText("agno")).toBeDefined();
    expect(getByText("mastra")).toBeDefined();
    expect(getByText("crewai-crews")).toBeDefined();
  });
});
