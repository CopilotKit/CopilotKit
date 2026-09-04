import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QuickstartIntelligenceCta } from "../quickstart-intelligence-cta";

describe("QuickstartIntelligenceCta", () => {
  it("hands a completed sample chat off to Intelligence", () => {
    const markup = renderToStaticMarkup(<QuickstartIntelligenceCta />);

    expect(markup).toContain("Your sample chat is running");
    expect(markup).toContain("persistent threads");
    expect(markup).toContain("Explore Intelligence");
    expect(markup).toContain('href="/intelligence/overview"');
  });
});
