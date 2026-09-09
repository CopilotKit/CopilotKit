import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import * as lucide from "lucide-react";

import {
  COPILOTKIT_CAPABILITIES,
  INTELLIGENCE_CAPABILITIES,
  agentPicks,
  frontendPicks,
  scopedHref,
} from "../homepage-map";
import { getDocsMode, getIntegrations } from "@/lib/registry";
import { FRONTEND_OPTIONS } from "@/lib/frontend-options";

const CONTENT_DOCS_ROOT = path.join(process.cwd(), "src/content/docs");

/** A capability href `/foo/bar` is served by either `foo/bar.mdx` or
 *  `foo/bar/index.mdx`. */
function contentFileExists(href: string): boolean {
  const relative = href.replace(/^\//, "");
  const flat = path.join(CONTENT_DOCS_ROOT, `${relative}.mdx`);
  const indexed = path.join(CONTENT_DOCS_ROOT, relative, "index.mdx");
  return existsSync(flat) || existsSync(indexed);
}

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

  // A capability href is not fed through any content pipeline (search index,
  // llms.txt) that would otherwise catch a typo'd or dead destination — this
  // is the only check standing between a broken tile and the homepage.
  it("resolves every non-absolute capability href to a real content file", () => {
    for (const cap of all) {
      if (/^https?:\/\//.test(cap.href)) continue;
      expect(contentFileExists(cap.href), cap.href).toBe(true);
    }
  });

  // The tile is named for the pattern the docs page is named for. "Approvals"
  // described only one of the things `/human-in-the-loop` covers.
  it("names the human-in-the-loop capability after its own docs page", () => {
    const titles = COPILOTKIT_CAPABILITIES.map((cap) => cap.title);

    expect(titles).toContain("Human in the loop");
    expect(titles).not.toContain("Approvals");

    const hitl = COPILOTKIT_CAPABILITIES.find(
      (cap) => cap.title === "Human in the loop",
    );
    expect(hitl?.href).toBe("/human-in-the-loop");
    expect(hitl?.icon).toBe("User");
  });

  it("lists exactly the documented frontends, with React pointing at the quickstart", () => {
    const picks = frontendPicks();
    expect(picks.map((p) => p.id)).toEqual(FRONTEND_OPTIONS.map((o) => o.id));
    expect(picks.find((p) => p.id === "react")?.href).toBe("/quickstart");
    expect(picks.find((p) => p.id === "vue")?.href).toBe("/vue");
  });

  // Slack and Teams are frontends in the registry but are managed channels
  // that require Intelligence. Listing them unqualified in the
  // "bring your own" block would mislead.
  it("marks only Slack and Teams as requiring Intelligence", () => {
    const picks = frontendPicks();
    expect(picks.filter((p) => p.note).map((p) => p.id)).toEqual([
      "slack",
      "teams",
    ]);
  });

  it("puts the built-in agent first and points it at the root quickstart", () => {
    const picks = agentPicks();
    expect(picks[0]?.id).toBe("built-in-agent");
    expect(picks[0]?.href).toBe("/quickstart");
  });

  it("lists every visible integration and links each at its own surface", () => {
    const picks = agentPicks();
    const visible = getIntegrations().filter(
      (integration) => getDocsMode(integration.slug) !== "hidden",
    );
    expect(picks).toHaveLength(visible.length);
    // langroid carries docs_mode: hidden in the registry today — linking it
    // would land on a 404.
    expect(picks.map((p) => p.id)).not.toContain("langroid");
    expect(picks.find((p) => p.id === "mastra")?.href).toBe("/mastra");
    for (const pick of picks) {
      expect(pick.href).toMatch(/^\//);
      expect(pick.name.length).toBeGreaterThan(0);
    }
  });

  // Each pick carries what its logo needs, so `PickGrid` can render one
  // without knowing anything about frontends or the registry.
  it("gives every frontend pick the icon its registry entry declares", () => {
    const picks = frontendPicks();

    for (const option of FRONTEND_OPTIONS) {
      const pick = picks.find((candidate) => candidate.id === option.id);
      expect(pick?.logo, option.id).toEqual({
        kind: "frontend",
        icon: option.icon,
      });
    }
  });

  it("gives every agent pick its registry slug and logo fallback", () => {
    const bySlug = new Map(
      getIntegrations().map((integration) => [integration.slug, integration]),
    );

    for (const pick of agentPicks()) {
      expect(pick.logo.kind, pick.id).toBe("framework");
      if (pick.logo.kind !== "framework") continue;
      expect(pick.logo.slug).toBe(pick.id);
      expect(pick.logo.fallbackSrc).toBe(bySlug.get(pick.id)?.logo);
    }
  });

  // Partners signed off on this order; guard one known adjacent pair so a
  // regression here fails loudly instead of silently reshuffling the grid.
  // ag2/agno is chosen because the registry's own (unsorted) order happens
  // to put them in the opposite sequence, so this assertion only holds once
  // the display-order sort actually runs.
  it("keeps the partner-agreed display order", () => {
    const ids = agentPicks().map((p) => p.id);
    expect(ids.indexOf("ag2")).toBeLessThan(ids.indexOf("agno"));
  });
});
