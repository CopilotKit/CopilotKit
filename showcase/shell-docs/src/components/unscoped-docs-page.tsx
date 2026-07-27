// UnscopedDocsPage — server component for `/<slug>` URLs where the
// first segment isn't a registered integration slug (e.g. `/quickstart`,
// `/concepts/architecture`).
//
// The Built-in Agent docs are served at the ROOT surface: when BIA (the
// default framework, `docs_mode: authored`) has a page for the slug
// under `integrations/built-in-agent/`, that page renders here BIA-scoped
// — exactly what `/built-in-agent/<slug>` used to serve before the prefix
// was retired. Agnostic slugs (no BIA override) render the root MDX.
//
// Either way the sidebar is the SAME unified tree (`buildRootSurfaceNav`):
// the BIA IA with the agnostic root sections folded in. This is what
// keeps the sidebar stable as you move between a BIA page and an agnostic
// page at the root — without it, the two IAs swap and the whole sidebar
// reshuffles.
//
// Shared between `app/[[...slug]]/page.tsx` and the
// `app/[framework]/[[...slug]]/page.tsx` fall-through (when the first
// URL segment isn't a registered integration).

import React from "react";
import { notFound } from "next/navigation";
import { DocsPageView } from "@/components/docs-page-view";
import { buildRootSurfaceNav } from "@/lib/docs-render";
import { getDocsFolder, ROOT_FRAMEWORK } from "@/lib/registry";
import { resolveRootSurfaceContent } from "@/lib/root-surface-content";

export async function UnscopedDocsPage({ slugPath }: { slugPath: string }) {
  // The legacy `/integrations/<framework>/<slug>` URL scheme is dead.
  // Refuse to render a doc page from `loadDoc("integrations/...")` here
  // so the legacy URL surfaces as a 404 (middleware redirects cover the
  // real traffic) rather than rendering with a stray, unscoped sidebar.
  if (slugPath.startsWith("integrations/")) notFound();

  // One sidebar for the entire root surface (BIA IA + folded-in agnostic
  // sections), so navigating between BIA and agnostic pages never swaps it.
  const docsFolder = getDocsFolder(ROOT_FRAMEWORK);
  const navTree = buildRootSurfaceNav(docsFolder);

  const content = resolveRootSurfaceContent(slugPath);
  if (!content) notFound();

  return (
    <DocsPageView
      slugPath={slugPath}
      contentSlugPath={content.contentSlugPath}
      slugHrefPrefix=""
      frameworkOverride={content.frameworkOverride}
      navTree={navTree}
    />
  );
}
