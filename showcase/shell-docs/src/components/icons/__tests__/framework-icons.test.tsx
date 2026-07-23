import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FrameworkLogo } from "../framework-icons";

describe("FrameworkLogo", () => {
  it("renders the Deep Agents mark from the framework icon registry", () => {
    const markup = renderToStaticMarkup(<FrameworkLogo slug="deepagents" />);

    expect(markup).toContain("<svg");
    expect(markup).toContain('viewBox="0 0 98 98"');
    expect(markup).toContain("M72.5361 42.2004");
  });
});
