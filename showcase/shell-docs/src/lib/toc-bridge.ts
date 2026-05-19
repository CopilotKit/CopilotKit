// Bridge shell-docs's TocHeading shape into Fumadocs's `TOCItemType`
// so `<DocsPage toc={...}>` can render the right-rail TOC for the same
// headings shell-docs's hand-rolled `DocsToc` was rendering.
//
// shell-docs's TocHeading.slug already matches the `id` attribute the
// heading renders with (the same `slugify()` is used at heading-render
// time inside DocsPageView). So `url: "#" + slug` is a stable anchor.

import type { TableOfContents } from "fumadocs-core/server";
import type { TocHeading } from "@/lib/toc";

export function tocHeadingsToFumadocs(headings: TocHeading[]): TableOfContents {
  return headings.map((h) => ({
    title: h.text,
    url: `#${h.slug}`,
    depth: h.depth,
  }));
}
