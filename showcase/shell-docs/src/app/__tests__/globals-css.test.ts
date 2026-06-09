import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  new URL("../globals.css", import.meta.url),
  "utf8",
);

describe("globals.css mobile docs layout", () => {
  it("collapses the Fumadocs grid to one content column on mobile", () => {
    expect(globalsCss).toContain(
      "grid-template-columns: minmax(0, 1fr) !important;",
    );
  });
});

describe("globals.css docs headings", () => {
  it("keeps heading anchors in block-level heading rows", () => {
    expect(globalsCss).toContain(
      ".reference-content .docs-heading {\n  display: flex;",
    );
    expect(globalsCss).not.toContain(
      ".reference-content .docs-heading {\n  display: inline-flex;",
    );
  });
});
