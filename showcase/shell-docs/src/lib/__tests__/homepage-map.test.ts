import { describe, expect, it } from "vitest";
import * as lucide from "lucide-react";

import {
  COPILOTKIT_CAPABILITIES,
  agentPicks,
  frontendPicks,
} from "../homepage-map";
import { getDocsMode, getIntegrations } from "@/lib/registry";
import { FRONTEND_OPTIONS } from "@/lib/frontend-options";

describe("homepage map data", () => {
  it("gives the block six capabilities so the three-per-row grid has no orphan", () => {
    expect(COPILOTKIT_CAPABILITIES).toHaveLength(6);
  });

  // Every icon is the one its destination page already declares. A name that
  // is not a real lucide export renders nothing at all, silently.
  it("names only icons that lucide-react actually exports", () => {
    for (const cap of COPILOTKIT_CAPABILITIES) {
      expect(lucide, `icon for ${cap.title}`).toHaveProperty(cap.icon);
    }
  });

  it("gives every capability a non-empty title and body", () => {
    for (const cap of COPILOTKIT_CAPABILITIES) {
      expect(cap.title.length).toBeGreaterThan(0);
      expect(cap.body.length).toBeGreaterThan(0);
    }
  });

  it("uses distinct titles within the capability block", () => {
    const titles = COPILOTKIT_CAPABILITIES.map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  // Mirrored into the wizard's URL query string, so a duplicate or empty id
  // would silently collide two feature selections into one.
  it("gives every capability a unique, non-empty id", () => {
    const ids = COPILOTKIT_CAPABILITIES.map((c) => c.id);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The tile is named for the pattern the docs page is named for. "Approvals"
  // described only one of the things human-in-the-loop covers.
  it("names the human-in-the-loop capability after its own docs page", () => {
    const titles = COPILOTKIT_CAPABILITIES.map((cap) => cap.title);

    expect(titles).toContain("Human in the loop");
    expect(titles).not.toContain("Approvals");

    const hitl = COPILOTKIT_CAPABILITIES.find(
      (cap) => cap.title === "Human in the loop",
    );
    expect(hitl?.id).toBe("hitl");
    expect(hitl?.icon).toBe("User");
  });

  it("lists exactly the documented frontends minus the managed channels", () => {
    const picks = frontendPicks();
    const nonChannelIds = FRONTEND_OPTIONS.filter(
      (o) => o.id !== "slack" && o.id !== "teams",
    ).map((o) => o.id);

    expect(picks.map((p) => p.id)).toEqual(nonChannelIds);
    expect(picks.map((p) => p.id)).not.toContain("slack");
    expect(picks.map((p) => p.id)).not.toContain("teams");
  });

  it("puts the built-in agent first", () => {
    const picks = agentPicks();
    expect(picks[0]?.id).toBe("built-in-agent");
  });

  it("lists every visible integration", () => {
    const picks = agentPicks();
    const visible = getIntegrations().filter(
      (integration) => getDocsMode(integration.slug) !== "hidden",
    );
    expect(picks).toHaveLength(visible.length);
    // langroid carries docs_mode: hidden in the registry today — listing it
    // would offer a pick with no docs behind it.
    expect(picks.map((p) => p.id)).not.toContain("langroid");
    for (const pick of picks) {
      expect(pick.name.length).toBeGreaterThan(0);
    }
  });

  // Each pick carries what its logo needs, so `PickGrid` can render one
  // without knowing anything about frontends or the registry.
  it("gives every frontend pick the icon its registry entry declares", () => {
    const picks = frontendPicks();

    for (const option of FRONTEND_OPTIONS) {
      if (option.id === "slack" || option.id === "teams") continue;
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

  // Step 1's tiles fill their frame with a logo, a name, and this summary —
  // an empty one would render as a card with a hole in it.
  it("gives every frontend pick a non-empty summary", () => {
    for (const pick of frontendPicks()) {
      expect(pick.summary, pick.id).toBeTruthy();
      expect(pick.summary!.length, pick.id).toBeGreaterThan(0);
    }
  });

  // Density is the point for the nineteen backends — a summary line would
  // fight the compact row layout `PickGrid` gives them.
  it("gives no agent pick a summary", () => {
    for (const pick of agentPicks()) {
      expect(pick.summary, pick.id).toBeUndefined();
    }
  });

  // The registry's `react` summary describes the docs site's framework
  // switcher, not the frontend, and would read as nonsense on a wizard
  // tile — it must be overridden. Every other frontend must keep reading
  // straight from the registry, derived here (not hardcoded) so a copy
  // edit in the registry can't silently drift out of step with this test.
  it("overrides only the react summary, leaving every other frontend reading the registry's own value", () => {
    const picks = frontendPicks();
    const reactOption = FRONTEND_OPTIONS.find((o) => o.id === "react")!;
    const reactPick = picks.find((p) => p.id === "react")!;

    expect(reactPick.summary).not.toBe(reactOption.summary);

    for (const option of FRONTEND_OPTIONS) {
      if (
        option.id === "react" ||
        option.id === "slack" ||
        option.id === "teams"
      ) {
        continue;
      }
      const pick = picks.find((p) => p.id === option.id)!;
      expect(pick.summary, option.id).toBe(option.summary);
    }
  });
});
