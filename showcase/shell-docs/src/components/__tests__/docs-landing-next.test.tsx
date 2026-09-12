import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DocsLandingNext } from "../docs-landing-next";

vi.mock("../stored-framework-highlight", () => ({
  StoredFrameworkHighlight: () => null,
}));

describe("DocsLandingNext", () => {
  it("uses container-sized backend cards instead of viewport-only columns", () => {
    const markup = renderToStaticMarkup(<DocsLandingNext />);

    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain(
      "sm:grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]",
    );
    expect(markup).not.toContain("lg:grid-cols-3");
    expect(markup).not.toContain("pr-20");
  });

  // Section-level chrome (heading + supporting line) centres like the rest
  // of the homepage below the hero.
  it("centres the section heading and its supporting line", () => {
    const markup = renderToStaticMarkup(<DocsLandingNext />);

    expect(markup).toContain(
      "mx-auto mb-5 flex max-w-2xl flex-col items-center text-center",
    );
  });

  // The important guard: each card's own logo/name/description stays
  // left-aligned. Over-centring the cards to "match" the heading above is
  // the likely regression, and it's invisible to a test that only checks
  // the things that should centre — so isolate the grid markup (everything
  // from the cards' own wrapper onward) and assert no centring class ever
  // reaches it.
  it("does not centre the backend cards' own content", () => {
    const markup = renderToStaticMarkup(<DocsLandingNext />);

    const gridStart = markup.indexOf("grid-cols-1 gap-2.5");
    expect(gridStart).toBeGreaterThan(-1);
    const cardsMarkup = markup.slice(gridStart);
    expect(cardsMarkup).not.toContain("text-center");
  });
});
