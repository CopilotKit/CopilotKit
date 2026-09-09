import { describe, expect, it } from "vitest";
import * as lucide from "lucide-react";

import {
  COPILOTKIT_CAPABILITIES,
  INTELLIGENCE_CAPABILITIES,
  agentPicks,
  frontendPicks,
  scopedHref,
} from "../homepage-map";

describe("homepage map data", () => {
  const all = [...COPILOTKIT_CAPABILITIES, ...INTELLIGENCE_CAPABILITIES];

  it("gives each block six capabilities so the three-per-row grid has no orphan", () => {
    expect(COPILOTKIT_CAPABILITIES).toHaveLength(6);
    expect(INTELLIGENCE_CAPABILITIES).toHaveLength(6);
  });

  // Every icon is the one its destination page already declares. A name that
  // is not a real lucide export renders nothing at all, silently.
  it("names only icons that lucide-react actually exports", () => {
    for (const cap of all) {
      expect(lucide, `icon for ${cap.title}`).toHaveProperty(cap.icon);
    }
  });

  it("gives every capability a non-empty title, body and href", () => {
    for (const cap of all) {
      expect(cap.title.length).toBeGreaterThan(0);
      expect(cap.body.length).toBeGreaterThan(0);
      expect(cap.href).toMatch(/^(\/|https:\/\/)/);
    }
  });

  it("uses distinct titles and distinct hrefs within the whole map", () => {
    expect(new Set(all.map((c) => c.title)).size).toBe(all.length);
    expect(new Set(all.map((c) => c.href)).size).toBe(all.length);
  });

  // The root surface serves ROOT_FRAMEWORK, so its pages take no prefix.
  it("prefixes hrefs for a non-default framework and leaves the default alone", () => {
    expect(scopedHref("/generative-ui", "built-in-agent")).toBe(
      "/generative-ui",
    );
    expect(scopedHref("/generative-ui", "mastra")).toBe(
      "/mastra/generative-ui",
    );
  });

  it("never prefixes an absolute URL", () => {
    const external = "https://www.copilotkit.ai/copilotkit-intelligence";
    expect(scopedHref(external, "mastra")).toBe(external);
  });

  it("lists every documented frontend, with React pointing at the quickstart", () => {
    const picks = frontendPicks();
    const ids = picks.map((p) => p.id);
    expect(ids).toContain("react");
    expect(ids).toContain("vue");
    expect(ids).toContain("angular");
    expect(ids).toContain("react-native");
    expect(picks.find((p) => p.id === "react")?.href).toBe("/quickstart");
    expect(picks.find((p) => p.id === "vue")?.href).toBe("/vue");
  });

  // Slack and Teams are frontends in the registry but are managed channels
  // that require Intelligence. Listing them unqualified in the
  // "bring your own" block would mislead.
  it("marks the frontends that require Intelligence", () => {
    const picks = frontendPicks();
    expect(picks.find((p) => p.id === "slack")?.note).toBe(
      "needs Intelligence",
    );
    expect(picks.find((p) => p.id === "teams")?.note).toBe(
      "needs Intelligence",
    );
    expect(picks.find((p) => p.id === "react")?.note).toBeUndefined();
  });

  it("puts the built-in agent first and points it at the root quickstart", () => {
    const picks = agentPicks();
    expect(picks[0]?.id).toBe("built-in-agent");
    expect(picks[0]?.href).toBe("/quickstart");
  });

  it("lists every visible integration and links each at its own surface", () => {
    const picks = agentPicks();
    expect(picks.length).toBeGreaterThanOrEqual(15);
    expect(picks.find((p) => p.id === "mastra")?.href).toBe("/mastra");
    for (const pick of picks) {
      expect(pick.href).toMatch(/^\//);
      expect(pick.name.length).toBeGreaterThan(0);
    }
  });
});
