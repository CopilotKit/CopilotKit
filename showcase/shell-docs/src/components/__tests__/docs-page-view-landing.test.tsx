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

/** Find the first element in the tree whose className contains `marker`. */
function findByClassName(node: unknown, marker: string): string | undefined {
  if (!React.isValidElement(node)) return undefined;
  const props = node.props as {
    className?: string;
    children?: React.ReactNode;
  };
  if (typeof props.className === "string" && props.className.includes(marker)) {
    return props.className;
  }
  let found: string | undefined;
  React.Children.forEach(props.children, (child) => {
    if (!found) found = findByClassName(child, marker);
  });
  return found;
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

  // The content container's top padding is part of the same suppressed-chrome
  // switch: on an ordinary docs page it clears space for the breadcrumb trail
  // and title that render there, but a landing page's own hero already
  // supplies that space, so the container must not double it up. This mirrors
  // the `pt-0` recipe the data-driven framework-root path
  // (`app/[framework]/[[...slug]]/page.tsx`'s `FrameworkRootShell`) already
  // uses for the same suppressed chrome.
  it("has no top padding on the content container when landingPage is set", async () => {
    const tree = await DocsPageView({
      slugPath: "",
      contentSlugPath: "integrations/mastra/index",
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
      landingPage: true,
      navTree: [],
    });

    const className = findByClassName(tree, "docs-inner-content");
    expect(className).toBeDefined();
    expect(className).toContain("pt-0");
    expect(className).not.toContain("pt-2");
    expect(className).not.toContain("md:pt-3");
    expect(className).not.toContain("xl:pt-4");
  });

  it("keeps the top padding on the content container on an ordinary docs page", async () => {
    const tree = await DocsPageView({
      slugPath: "quickstart",
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
      navTree: [],
    });

    const className = findByClassName(tree, "docs-inner-content");
    expect(className).toBeDefined();
    expect(className).toContain("pt-2");
    expect(className).toContain("md:pt-3");
    expect(className).toContain("xl:pt-4");
  });
});
