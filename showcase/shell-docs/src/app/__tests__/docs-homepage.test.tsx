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

  it("no longer renders any of the superseded sections", () => {
    for (const gone of [
      "DocsBuildWith",
      "DocsIntelligenceAdds",
      "DocsLayerDiagram",
      "DocsStart",
      "LandingSampleTabs",
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
  it("keeps the three starting points as text, not as links to a dead anchor", () => {
    expect(source).toContain("New project");
    expect(source).toContain("Existing app or agent");
    expect(source).not.toContain("#start");
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
