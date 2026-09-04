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

  // The breadcrumb trail and the divider under the page chrome belong to
  // ordinary docs pages. On a framework landing page they stack a second,
  // quieter framework name plus a full-width rule directly above the hero's
  // own icon + framework-name lockup. Both pairs of assertions run against
  // the same component so the "ordinary page" case proves the guard is a
  // landing-page switch and not a deletion.
  it("renders the breadcrumb trail and the divider on an ordinary docs page", async () => {
    const tree = await DocsPageView({
      slugPath: "quickstart",
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
      navTree: [],
    });

    const names = componentNames(tree);
    expect(names).toContain("nav");
    expect(names).toContain("hr");
  });

  it("renders no breadcrumb trail and no divider when landingPage is set", async () => {
    const tree = await DocsPageView({
      slugPath: "",
      contentSlugPath: "integrations/mastra/index",
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
      landingPage: true,
      navTree: [],
    });

    const names = componentNames(tree);
    expect(names).not.toContain("nav");
    expect(names).not.toContain("hr");
  });
});
