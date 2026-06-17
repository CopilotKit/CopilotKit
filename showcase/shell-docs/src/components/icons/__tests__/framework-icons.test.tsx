import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FrameworkLogo } from "../framework-icons";

describe("FrameworkLogo", () => {
  it("renders the LangChain mark for DeepAgents", () => {
    const markup = renderToStaticMarkup(<FrameworkLogo slug="deepagents" />);

    expect(markup).toContain("<svg");
    expect(markup).toContain('viewBox="0 0 128 128"');
    expect(markup).toContain("M40.1024 85.0722");
  });
});
