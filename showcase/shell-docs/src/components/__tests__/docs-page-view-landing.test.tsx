import { describe, expect, it } from "vitest";
import React from "react";

import { DocsPageView } from "../docs-page-view";

/** Walk a returned element tree and collect the type names React was given. */
function componentNames(node: unknown, out: string[] = []): string[] {
  if (!React.isValidElement(node)) return out;
  const type = node.type as { name?: string } | string;
  out.push(typeof type === "string" ? type : (type.name ?? "anonymous"));
  React.Children.forEach(
    (node.props as { children?: React.ReactNode }).children,
    (child) => componentNames(child, out),
  );
  return out;
}

describe("DocsPageView landing mode", () => {
  it("renders the page-tools row on an ordinary docs page", async () => {
    const tree = await DocsPageView({
      slugPath: "quickstart",
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
      navTree: [],
    });

    expect(componentNames(tree)).toContain("DocsPageTools");
  });

  it("renders no page-tools row when landingPage is set", async () => {
    const tree = await DocsPageView({
      slugPath: "",
      contentSlugPath: "integrations/mastra/index",
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
      landingPage: true,
      navTree: [],
    });

    expect(componentNames(tree)).not.toContain("DocsPageTools");
  });
});
