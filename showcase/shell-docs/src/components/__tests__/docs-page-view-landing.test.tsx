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

/** Find the first `DocsContentHeader` element in the tree and return its props. */
function findContentHeaderProps(node: unknown):
  | {
      ancestorBreadcrumbs?: unknown[];
      hideHeading?: boolean;
      children?: React.ReactNode;
    }
  | undefined {
  if (!React.isValidElement(node)) return undefined;
  const type = node.type as { name?: string } | string;
  if (typeof type !== "string" && type.name === "DocsContentHeader") {
    return node.props as ReturnType<typeof findContentHeaderProps>;
  }
  let found: ReturnType<typeof findContentHeaderProps>;
  React.Children.forEach(
    (node.props as { children?: React.ReactNode }).children,
    (child) => {
      if (!found) found = findContentHeaderProps(child);
    },
  );
  return found;
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

  // The breadcrumb trail and the page heading belong to ordinary docs pages.
  // On a framework landing page the trail stacks a second, quieter framework
  // name directly above the hero's own icon + framework-name lockup, and the
  // heading repeats what the hero already says. Both are expressed through
  // the shared `DocsContentHeader`: empty ancestors render no trail, and
  // `hideHeading` drops the H1. Both pairs of assertions run against the same
  // component so the "ordinary page" case proves the guard is a landing-page
  // switch and not a deletion.
  it("renders the breadcrumb trail and the heading on an ordinary docs page", async () => {
    const tree = await DocsPageView({
      slugPath: "quickstart",
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
      navTree: [],
    });

    const header = findContentHeaderProps(tree);
    expect(header).toBeDefined();
    expect(header?.ancestorBreadcrumbs?.length).toBeGreaterThan(0);
    expect(header?.hideHeading).toBe(false);
  });

  it("renders no breadcrumb trail and no heading when landingPage is set", async () => {
    const tree = await DocsPageView({
      slugPath: "",
      contentSlugPath: "integrations/mastra/index",
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
      landingPage: true,
      navTree: [],
    });

    const header = findContentHeaderProps(tree);
    expect(header).toBeDefined();
    expect(header?.ancestorBreadcrumbs).toEqual([]);
    expect(header?.hideHeading).toBe(true);
    // Every part suppressed, so the header itself renders nothing and the
    // hero keeps the offset the container's `pt-0` gives it.
    expect(header?.children).toBe(false);
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
