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
});
