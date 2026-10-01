import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocsLandingNext } from "../docs-landing-next";

describe("DocsLandingNext", () => {
  it("uses responsive backend columns", () => {
    const markup = renderToStaticMarkup(<DocsLandingNext />);
    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("sm:grid-cols-2");
    expect(markup).toContain("lg:grid-cols-3");
    expect(markup).not.toContain("pr-20");
  });
});
