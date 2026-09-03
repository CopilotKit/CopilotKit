import React from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { DocsPage } from "fumadocs-ui/page";
import { describe, expect, it } from "vitest";
import { DocsContentHeader } from "@/components/docs-content-header";
import { DocsPageView } from "@/components/docs-page-view";

function findElementByType<Props>(
  node: ReactNode,
  type: React.ElementType,
): ReactElement<Props> | null {
  if (!React.isValidElement(node)) {
    return null;
  }

  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) {
    return element as ReactElement<Props>;
  }

  for (const child of React.Children.toArray(element.props.children)) {
    const match = findElementByType<Props>(child, type);
    if (match) {
      return match;
    }
  }

  return null;
}

async function renderDocsPage(slugPath: string) {
  const page = await DocsPageView({
    slugPath,
    slugHrefPrefix: "",
    navTree: [],
  });
  const docsPage = findElementByType<ComponentProps<typeof DocsPage>>(
    page,
    DocsPage,
  );

  expect(docsPage).not.toBeNull();
  return docsPage!;
}

describe("DocsPageView table of contents", () => {
  it("hides the tablet TOC popover when the page opts out of the TOC", async () => {
    const page = await renderDocsPage("intelligence/overview");

    expect(page.props.toc).toEqual([]);
    expect(page.props.tableOfContentPopover).toEqual({ enabled: false });
    expect(page.props.full).toBe(true);

    const header = findElementByType<
      ComponentProps<typeof DocsContentHeader>
    >(page, DocsContentHeader);
    expect(header?.props.ancestorBreadcrumbs).toEqual([]);
  });

  it("keeps the tablet TOC popover for pages with headings", async () => {
    const page = await renderDocsPage("channels/persistence-and-scaling");

    expect(page.props.toc).not.toEqual([]);
    expect(page.props.tableOfContentPopover).toEqual({ enabled: true });
  });
});
