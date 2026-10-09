/**
 * `UI` / `BE` / `1P` / `D6` tell you WHAT a mark applies to only if you already
 * know the abbreviation, and the mark itself says nothing on hover. Both now
 * carry the glyph's canonical legend line.
 *
 * The line is composed by `glyphTitle()` from the SAME `GLYPHS` table the
 * legend renders. Nothing here asserts hand-written prose: a literal string in
 * this file would be the second copy that lets the two drift, which is exactly
 * how the old legend came to describe states the code never emitted.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { GLYPHS, GLYPH_LIST, glyphTitle } from "@/lib/glyphs";
import { Badge, GlyphMark } from "@/components/badges";

afterEach(cleanup);

describe("rung label + mark hover text", () => {
  it("the rung LABEL carries its glyph's legend line", () => {
    render(
      <Badge name="UI" state={{ tone: "gray", label: GLYPHS.gated.mark }} />,
    );
    expect(screen.getByText("UI").getAttribute("title")).toBe(
      glyphTitle(GLYPHS.gated.mark),
    );
  });

  it("the bare MARK carries the same line", () => {
    const { container } = render(
      <GlyphMark label={GLYPHS.noData.mark} tone="gray" />,
    );
    expect(
      container
        .querySelector("[data-glyph-form='bare']")
        ?.getAttribute("title"),
    ).toBe(glyphTitle(GLYPHS.noData.mark));
  });

  it("every glyph in the vocabulary has a line, and it is built from the table", () => {
    for (const spec of GLYPH_LIST) {
      expect(glyphTitle(spec.mark)).toBe(
        `${spec.mark} ${spec.term} — ${spec.legend}`,
      );
    }
  });

  it("a mark outside the vocabulary claims no meaning", () => {
    expect(glyphTitle("U")).toBeUndefined();
  });

  it("an explicit title still wins over the default line", () => {
    const { container } = render(
      <GlyphMark
        label={GLYPHS.fail.mark}
        tone="red"
        title="probe #42 failed"
      />,
    );
    expect(
      container
        .querySelector("[data-glyph-form='bare']")
        ?.getAttribute("title"),
    ).toBe("probe #42 failed");
  });
});
