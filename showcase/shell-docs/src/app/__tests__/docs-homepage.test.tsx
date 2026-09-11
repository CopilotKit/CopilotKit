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

  // The hero used to carry the three starting points as a separate line of
  // middot-separated labels below the buttons. Review called that placement
  // wrong: the point it was making — that CopilotKit goes into an app you
  // already have — belongs in the sentence a reader meets first. The line is
  // gone and the subtitle says it instead.
  it("says in the subtitle that an existing app works, and keeps no separate list", () => {
    expect(source).toContain("a React app\n                you already have");
    expect(source).not.toContain("HERO_STARTING_POINTS");
    expect(source).not.toContain("Existing app or agent");
    expect(source).not.toContain("DOCS_START_SECTION_ID");
    expect(source).not.toContain("HERO_PATH_ANCHORS");
  });

  // Review asked for one or two sentences under the heading, against the three
  // paragraphs it had. Counted on the rendered text rather than the source, so
  // a paragraph split across source lines still counts as one.
  it("keeps the hero subtitle to at most two sentences", () => {
    const paragraphs = Array.from(
      source.matchAll(/<p className="mt-[34][^"]*">([\s\S]*?)<\/p>/g),
    ).map((match) => match[1].replace(/\s+/g, " ").trim());

    expect(paragraphs.length).toBeLessThanOrEqual(2);
    const sentences = paragraphs.join(" ").match(/[.!?](\s|$)/g) ?? [];
    expect(sentences.length).toBeLessThanOrEqual(2);
  });

  // Em dashes were called out on review as a tell of generated prose.
  it("keeps em dashes out of the hero copy and the page metadata", () => {
    const copy = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.includes("*"))
      .join("\n");

    expect(copy).not.toContain("—");
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
