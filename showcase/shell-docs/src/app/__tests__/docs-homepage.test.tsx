import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The homepage is a server component wired into the docs layout, so mounting
// it in a unit test would pull in the whole shell. These assertions read the
// route's source instead: they are about composition, which is exactly what
// this file is responsible for.
const source = readFileSync(
  join(process.cwd(), "src/app/[[...slug]]/page.tsx"),
  "utf8",
);

describe("the docs homepage route", () => {
  it("renders the product map", () => {
    expect(source).toContain("<DocsProductMap />");
  });

  // All five component files this loop names are deleted, so reintroducing
  // one is a compile error long before this test runs — this loop is a weak
  // net by nature, not the assertion actually guarding the composition.
  // `not.toContain("space-y-12")` below is what does that.
  it("no longer renders any of the superseded sections", () => {
    for (const gone of [
      "DocsBuildWith",
      "DocsIntelligenceAdds",
      "DocsLayerDiagram",
      "DocsLandingNext",
      "DocsStart",
    ]) {
      expect(source, gone).not.toContain(gone);
    }
  });

  // Guards against the old section stack creeping back under a new name.
  it("does not reintroduce the old section stack", () => {
    expect(source).not.toContain("space-y-12");
  });

  // The hero's three starting points used to be anchors at a Start section
  // that duplicated the hero. That section is gone, so they are plain text.
  // Asserting the literal `#start` here would be vacuous — that string
  // never appeared even in the old markup, which built its href as
  // `` `#${DOCS_START_SECTION_ID}` ``. Assert the actual removed identifiers
  // instead, plus the absence of a `<Link` in the starting-points paragraph.
  it("keeps the three starting points as text, not as links to a dead anchor", () => {
    expect(source).toContain("New project");
    expect(source).toContain("Existing app or agent");
    expect(source).not.toContain("DOCS_START_SECTION_ID");
    expect(source).not.toContain("HERO_PATH_ANCHORS");

    const startingPointsMarkup = source.slice(
      source.indexOf("HERO_STARTING_POINTS.map"),
      source.indexOf("</p>", source.indexOf("HERO_STARTING_POINTS.map")),
    );
    expect(startingPointsMarkup).not.toContain("<Link");
  });

  // The middot separators between the three starting points must stay out
  // of the accessibility tree, or a screen reader announces "middle dot"
  // between each label.
  it("hides the starting-points separators from screen readers", () => {
    const startingPointsMarkup = source.slice(
      source.indexOf("HERO_STARTING_POINTS.map"),
      source.indexOf("</p>", source.indexOf("HERO_STARTING_POINTS.map")),
    );
    expect(startingPointsMarkup).toContain("aria-hidden");
  });

  it("keeps the hero's single primary action and its telemetry surface", () => {
    expect(source).toContain("HeroOnboardingPromptButton");
    expect(source).toContain("docs_landing_hero");
  });

  it("keeps the title and description aligned with the hero copy", () => {
    expect(source).toContain(
      "CopilotKit: give your app an agent your users can use",
    );
  });
});
